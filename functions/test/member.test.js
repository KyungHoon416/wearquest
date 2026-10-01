'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const enabled=process.env.FIRESTORE_EMULATOR_HOST && process.env.GCLOUD_PROJECT==='demo-wearquest';
const {random,hash}=require('../src/security');
let db,server,base,profile={id:987654321,kakao_account:{profile:{nickname:'Kakao test'}}},upstreamCalls=0;
const crypto=require('node:crypto');
const appleEc=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const appleRsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
let appleNonce='';
const request=async(url,options)=>{
  upstreamCalls++;
  if(url==='https://appleid.apple.com/auth/keys')return {ok:true,json:async()=>({keys:[{...appleRsa.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]})};
  if(url==='https://appleid.apple.com/auth/token'){
    const form=new URLSearchParams(options.body);assert.equal(form.get('client_id'),'com.wearquest.wear');assert.equal(form.get('redirect_uri'),'https://wearquest-9a45f.web.app/api/auth/oauth/apple/callback');
    const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const now=Math.floor(Date.now()/1000);
    const body=enc({alg:'RS256',kid:'test'})+'.'+enc({iss:'https://appleid.apple.com',aud:'com.wearquest.wear',sub:'apple-member',nonce:appleNonce,iat:now,exp:now+300,email:'relay@privaterelay.appleid.com',email_verified:'true'});
    return {ok:true,json:async()=>({access_token:'apple-test',id_token:body+'.'+crypto.sign('sha256',Buffer.from(body),appleRsa.privateKey).toString('base64url')})};
  }
  if(url==='https://nid.naver.com/oauth2.0/token'){const body=new URLSearchParams(options.body);assert.equal(body.get('client_secret'),'naver-test-secret');assert.ok(body.get('state'));return {ok:true,json:async()=>({access_token:'naver-test-token'})};}
  if(url==='https://openapi.naver.com/v1/nid/me'){assert.equal(options.headers.Authorization,'Bearer naver-test-token');return {ok:true,json:async()=>({resultcode:'00',response:{id:'naver-subject-1',nickname:'네이버 테스트'}})};}
  if(url.includes('/oauth/token')){assert.equal(new URLSearchParams(options.body).get('client_secret'),'test-only-secret');return {ok:true,json:async()=>({access_token:'test-only-token'})};}
  assert.equal(options.headers.Authorization,'Bearer test-only-token');
  return {ok:true,json:async()=>profile};
};
before(async()=>{if(!enabled)return;const {initializeApp,getApps}=require('firebase-admin/app');if(!getApps().length)initializeApp({projectId:'demo-wearquest'});db=require('firebase-admin/firestore').getFirestore();const {createMemberApp}=require('../member-app');const app=createMemberApp({db,getSecret:()=> 'test-only-secret',getNaverSecret:()=> 'naver-test-secret',getApplePrivateKey:()=>appleEc.privateKey.export({type:'pkcs8',format:'pem'}),request});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{if(server)await new Promise(r=>server.close(r));});
async function call(path,options={}){return fetch(base+'/api/auth/'+path,{redirect:'manual',...options});}
async function start(){const response=await call('oauth/kakao/start');assert.equal(response.status,302);const url=new URL(response.headers.get('location'));assert.equal(url.origin,'https://kauth.kakao.com');assert.equal(url.searchParams.get('redirect_uri'),'https://wearquest-9a45f.web.app/api/auth/oauth/kakao/callback');return {state:url.searchParams.get('state'),cookie:response.headers.get('set-cookie').split(';')[0]};}
async function callback(s){return call('oauth/kakao/callback?state='+s.state+'&code=test-code',{headers:{Cookie:s.cookie}});}
test('callback requires the initiating browser; state is single-use; session rotates',{skip:!enabled},async()=>{
 const s=await start();const before=upstreamCalls;
 const wrong=await callback({...s,cookie:'__session='+random()});assert.match(wrong.headers.get('location'),/auth_error=failed/);assert.equal(upstreamCalls,before);
 const success=await callback(s);assert.equal(success.status,303);assert.match(success.headers.get('location'),/#account$/);const cookie=success.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,s.cookie);assert.match(success.headers.get('set-cookie'),/HttpOnly/);assert.match(success.headers.get('set-cookie'),/Secure/);assert.match(success.headers.get('set-cookie'),/SameSite=Lax/);
 const session=await (await call('session',{headers:{Cookie:cookie}})).json();assert.equal(session.user.provider,'kakao');assert.equal(session.user.email,'');assert.equal((await db.doc('wallets/'+session.user.id).get()).data().balance,0);
 const replay=await callback(s);assert.match(replay.headers.get('location'),/auth_error=failed/);assert.equal(upstreamCalls,before+2);
});
test('same Kakao identity is reused; matching email never links Google; suspension rejects',{skip:!enabled},async()=>{
 const link=(await db.doc('identities/'+hash('kakao:987654321')).get()).data();
 profile={id:987654321,kakao_account:{email:'shared@example.test',is_email_valid:true,is_email_verified:true}};
 const response=await callback(await start());const session=await (await call('session',{headers:{Cookie:response.headers.get('set-cookie').split(';')[0]}})).json();assert.equal(session.user.id,link.userId);
 await db.doc('users/google-test').set({email:'shared@example.test',provider:'google',status:'active'});
 profile={...profile,id:987654322};const next=await callback(await start());const newSession=await (await call('session',{headers:{Cookie:next.headers.get('set-cookie').split(';')[0]}})).json();assert.notEqual(newSession.user.id,'google-test');assert.equal(newSession.user.email,'shared@example.test');
 await db.doc('users/'+newSession.user.id).update({status:'suspended'});assert.match((await callback(await start())).headers.get('location'),/auth_error=unavailable/);
});
test('admin sessions cannot become member sessions; logout validates origin and CSRF',{skip:!enabled},async()=>{
 const token=random();const {Timestamp}=require('firebase-admin/firestore');await db.doc('sessions/'+hash(token)).set({scope:'admin',adminId:'test-admin',csrf:'admin-csrf',expiresAt:Timestamp.fromMillis(Date.now()+60000)});
 let r=await call('session',{headers:{Cookie:'__session='+token}});assert.equal((await r.json()).user,null);const cookie=r.headers.get('set-cookie').split(';')[0];r=await call('session',{headers:{Cookie:cookie}});const data=await r.json();
 const post=(origin,csrf)=>call('logout',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf}});
 assert.equal((await post('https://evil.example',data.csrfToken)).status,403);assert.equal((await post('https://wearquest-9a45f.web.app','wrong')).status,403);assert.equal((await post('https://wearquest-9a45f.web.app',data.csrfToken)).status,200);
});
test('cancelled or expired OAuth creates no account',{skip:!enabled},async()=>{
 const {Timestamp}=require('firebase-admin/firestore');const s=await start();const before=upstreamCalls;const r=await call('oauth/kakao/callback?state='+s.state+'&error=access_denied',{headers:{Cookie:s.cookie}});assert.match(r.headers.get('location'),/auth_error=cancelled/);
 const expired=await start();await db.doc('oauthStates/'+hash(expired.state)).update({expiresAt:Timestamp.fromMillis(1)});assert.match((await callback(expired)).headers.get('location'),/auth_error=failed/);assert.equal(upstreamCalls,before);
});

async function guest(){const r=await call('session');return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken};}
async function post(path,body,session,origin='https://wearquest-9a45f.firebaseapp.com'){return call(path,{method:'POST',headers:{Cookie:session.cookie,Origin:origin,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});}
const signup={username:'TestMember',email:'member@example.test',nickname:'테스트 회원',password:'Local-test-password!2026',termsAccepted:true,privacyAccepted:true};
let passwordUser;
test('password signup is atomic under duplicate requests and keeps credentials private',{skip:!enabled},async()=>{
 const a=await guest(),b=await guest();const results=await Promise.all([post('register',signup,a),post('register',signup,b)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const r=results.find(r=>r.status===201);const cookie=r.headers.get('set-cookie').split(';')[0];const session=await (await call('session',{headers:{Cookie:cookie}})).json();passwordUser=session.user.id;
 assert.equal(session.user.provider,'password');assert.equal(session.user.username,'testmember');assert.equal(JSON.stringify(session).includes(signup.password),false);
 const profile=(await db.doc('users/'+passwordUser).get()).data();assert.equal(profile.emailVerified,false);assert.ok(profile.termsAcceptedAt);assert.ok(profile.privacyAcceptedAt);assert.equal(profile.password,undefined);
 assert.equal((await db.doc('wallets/'+passwordUser).get()).data().balance,0);
 const credential=(await db.doc('memberCredentials/'+passwordUser).get()).data();assert.notEqual(credential.password.hash,signup.password);assert.ok(await require('../core').verifyPassword(signup.password,credential.password));
 assert.equal((await db.collection('users').where('username','==','testmember').get()).size,1);
});
test('signup rejects invalid input, extra privileges and duplicate normalized email',{skip:!enabled},async()=>{
 const s=await guest();assert.equal((await post('register',{...signup,username:'newuser1',termsAccepted:false},s)).status,400);
 assert.equal((await post('register',{...signup,username:'newuser1',role:'superadmin'},s)).status,400);
 assert.equal((await post('register',{...signup,username:'newuser1',password:'short'},s)).status,400);
 assert.equal((await post('register',{...signup,username:'newuser1',email:'MEMBER@example.test'},s)).status,409);
 assert.equal((await post('register',signup,{...s,csrf:'wrong'})).status,403);
 assert.equal((await db.collection('users').where('username','==','newuser1').get()).size,0);
});
test('password login accepts normalized ID/email, rejects bad credentials and suspended accounts',{skip:!enabled},async()=>{
 for(const identifier of ['TESTMEMBER','MEMBER@example.test']){
  const s=await guest();const r=await post('login',{identifier,password:signup.password},s);assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,s.cookie);
  const current=await (await call('session',{headers:{Cookie:cookie}})).json();assert.equal(current.user.id,passwordUser);
  assert.equal((await post('logout',{}, {cookie,csrf:current.csrfToken})).status,200);
 }
 const s=await guest();assert.equal((await post('login',{identifier:'testmember',password:'wrong-password'},s)).status,401);
 assert.equal((await post('login',{identifier:'missing-member',password:'wrong-password'},s)).status,401);
 await db.doc('users/'+passwordUser).update({status:'suspended'});assert.equal((await post('login',{identifier:'testmember',password:signup.password},s)).status,401);
});


test('Naver state cannot be used by Kakao; successful callback persists a separate member and wallet',{skip:!enabled},async()=>{
 const start=await call('oauth/naver/start');assert.equal(start.status,302);const url=new URL(start.headers.get('location'));assert.equal(url.origin,'https://nid.naver.com');assert.equal(url.searchParams.get('client_id'),'VtgY1TbI0MJzwGIhReT6');assert.equal(url.searchParams.get('redirect_uri'),'https://wearquest-9a45f.web.app/api/auth/oauth/naver/callback');
 const state=url.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
 const wrong=await call('oauth/kakao/callback?state='+state+'&code=test',{headers:{Cookie:cookie}});assert.match(wrong.headers.get('location'),/auth_error=failed/);
 const ok=await call('oauth/naver/callback?state='+state+'&code=test',{headers:{Cookie:cookie}});assert.match(ok.headers.get('location'),/#account$/);const session=await (await call('session',{headers:{Cookie:ok.headers.get('set-cookie').split(';')[0]}})).json();assert.equal(session.user.provider,'naver');assert.equal(session.user.nickname,'네이버 테스트');assert.equal(session.user.email,'');assert.equal((await db.doc('wallets/'+session.user.id).get()).data().balance,0);
 const replay=await call('oauth/naver/callback?state='+state+'&code=test',{headers:{Cookie:cookie}});assert.match(replay.headers.get('location'),/auth_error=failed/);
});

 test('Apple form POST requires browser state, validates nonce, creates member/wallet and rotates to Lax',{skip:!enabled},async()=>{
  const start=await call('oauth/apple/start');assert.equal(start.status,302);const url=new URL(start.headers.get('location'));assert.equal(url.origin,'https://appleid.apple.com');assert.equal(url.searchParams.get('response_mode'),'form_post');assert.match(start.headers.get('set-cookie'),/SameSite=None/);
  appleNonce=url.searchParams.get('nonce');const state=url.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
  const callback=c=>call('oauth/apple/callback',{method:'POST',headers:{Cookie:c,Origin:'https://appleid.apple.com','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({state,code:'apple-code'}).toString()});
  const before=upstreamCalls;assert.match((await callback('__session='+random())).headers.get('location'),/auth_error=failed/);assert.equal(upstreamCalls,before);
  const ok=await callback(cookie);assert.match(ok.headers.get('location'),/#account$/);assert.match(ok.headers.get('set-cookie'),/SameSite=Lax/);
  const session=await (await call('session',{headers:{Cookie:ok.headers.get('set-cookie').split(';')[0]}})).json();assert.equal(session.user.provider,'apple');assert.equal(session.user.email,'relay@privaterelay.appleid.com');assert.equal((await db.doc('wallets/'+session.user.id).get()).data().balance,0);
  assert.match((await callback(cookie)).headers.get('location'),/auth_error=failed/);
 });
