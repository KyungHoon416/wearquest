'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const {getStorage}=require('firebase-admin/storage');
const {OAuth2Client}=require('google-auth-library');
const express=require('express');
const sharp=require('sharp');
const {random,hash,equal,cookieToken,validSession,validMutation,publicUser}=require('./security');
initializeApp();
const db=getFirestore();
const googleSecret=defineSecret('GOOGLE_OAUTH_JSON');
const appOrigin=defineString('APP_ORIGIN',{default:'https://wearquest-9a45f.web.app'});
const mediaBucket=defineString('MEDIA_BUCKET',{default:'wearquest-9a45f-media'});
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'8mb'}));
app.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});next();});
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const ttl=(ms)=>Timestamp.fromMillis(Date.now()+ms);
function setSession(res,token){res.cookie('__session',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:7*86400000});}
async function newSession(res,userId=null,oldRef=null){
 const token=random(),data={userId,csrf:random(),createdAt:Timestamp.now(),expiresAt:ttl(userId?7*86400000:30*60000)};
 const ref=db.collection('sessions').doc(hash(token));
 const batch=db.batch();batch.create(ref,data);if(oldRef)batch.delete(oldRef);await batch.commit();setSession(res,token);return {ref,...data};
}
async function loadSession(req){const token=cookieToken(req.headers.cookie);if(!token)return null;const ref=db.collection('sessions').doc(hash(token));const snap=await ref.get();const data=snap.data();return validSession(data)?{ref,...data}:null;}
async function rateLimit(req,category,limit){
 const window=Math.floor(Date.now()/60000),id=hash(`${category}:${req.ip}:${window}`),ref=db.collection('rateLimits').doc(id);
 await db.runTransaction(async t=>{const d=(await t.get(ref)).data();if((d?.count||0)>=limit)throw fail(429,'RATE_LIMITED');t.set(ref,{count:(d?.count||0)+1,expiresAt:ttl(120000)});});
}
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'wearquest-api'}));
app.use('/api',async(req,res,next)=>{
 try{await rateLimit(req,'api',120);req.session=await loadSession(req);
 if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!validMutation(req.get('origin'),appOrigin.value(),req.get('x-csrf-token'),req.session?.csrf))throw fail(403,'CSRF_INVALID');
 next();}catch(e){next(e);}
});
app.get('/api/auth/session',async(req,res)=>{
 const s=req.session||await newSession(res);let user=null;
 if(s.userId){const d=(await db.doc(`users/${s.userId}`).get()).data();if(d?.status==='active')user=publicUser(s.userId,d);else{await s.ref.delete();throw fail(401,'ACCOUNT_UNAVAILABLE');}}
 res.json({user,csrfToken:s.csrf});
});
app.post('/api/auth/logout',async(req,res)=>{if(req.session)await req.session.ref.delete();res.clearCookie('__session',{httpOnly:true,secure:true,sameSite:'lax',path:'/'});res.json({ok:true});});
// Deliberately fail closed until email verification/recovery and provider credentials are configured.
app.post(['/api/auth/register','/api/auth/login'],(_req,res)=>res.status(503).json({code:'PASSWORD_LOGIN_NOT_CONFIGURED'}));
function oauthClient(){const parsed=JSON.parse(googleSecret.value());const g=parsed.web||parsed;return {client:new OAuth2Client({clientId:g.client_id,clientSecret:g.client_secret,redirectUri:appOrigin.value()+'/api/auth/oauth/google/callback'}),clientId:g.client_id};}
app.get('/api/auth/oauth/google/start',async(req,res)=>{
 await rateLimit(req,'oauth',10);
 const s=req.session||await newSession(res),state=random(),nonce=random(),verifier=random();
 await db.collection('oauthStates').doc(hash(state)).create({sessionId:s.ref.id,nonce,verifier,expiresAt:ttl(10*60000)});
 const {client,clientId}=oauthClient();
 const url=client.generateAuthUrl({scope:['openid','email','profile'],state,nonce,code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:'S256',access_type:'online',prompt:'select_account'});
 res.redirect(302,url);
});
app.get('/api/auth/oauth/google/callback',async(req,res)=>{
 const {state,code}=req.query;
 if(typeof state!=='string'||state.length>100||!req.session)throw fail(400,'OAUTH_STATE_INVALID');
 const ref=db.collection('oauthStates').doc(hash(state));
 const saved=await db.runTransaction(async t=>{const data=(await t.get(ref)).data();if(!validSession(data)||!equal(data.sessionId,req.session.ref.id))throw fail(400,'OAUTH_STATE_INVALID');t.delete(ref);return data;});
 if(typeof code!=='string'||code.length>4096){return res.redirect(302,appOrigin.value()+'/#login');}
 const {client,clientId}=oauthClient();
 const {tokens}=await client.getToken({code,codeVerifier:saved.verifier});
 if(!tokens.id_token)throw fail(401,'OAUTH_INVALID');
 const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:clientId});const p=ticket.getPayload();
 if(!p||!equal(p.nonce,saved.nonce)||!p.sub||p.email_verified!==true)throw fail(401,'OAUTH_INVALID');
 // Link only by verified provider subject, never by matching email addresses.
 const identity=db.collection('identities').doc(hash('google:'+p.sub)),newUser=db.collection('users').doc();
 const userId=await db.runTransaction(async t=>{const link=(await t.get(identity)).data();if(link){const u=(await t.get(db.doc('users/'+link.userId))).data();if(u?.status!=='active')throw fail(403,'ACCOUNT_UNAVAILABLE');t.update(db.doc('users/'+link.userId),{lastLoginAt:Timestamp.now()});return link.userId;}
 t.create(newUser,{nickname:String(p.name||'회원').slice(0,40),email:p.email,provider:'google',status:'active',createdAt:Timestamp.now(),lastLoginAt:Timestamp.now(),termsAcceptedAt:null});
 t.create(identity,{provider:'google',subject:p.sub,userId:newUser.id,createdAt:Timestamp.now()});
 t.create(db.doc('wallets/'+newUser.id),{balance:0,updatedAt:Timestamp.now()});return newUser.id;});
 await newSession(res,userId,req.session.ref);res.redirect(302,appOrigin.value()+'/#account');
});
app.get('/api/auth/oauth/:provider/start',(_req,res)=>res.status(503).json({code:'PROVIDER_NOT_CONFIGURED'}));
async function member(req,_res,next){try{if(!req.session?.userId)throw fail(401,'LOGIN_REQUIRED');const snap=await db.doc('users/'+req.session.userId).get();if(snap.data()?.status!=='active')throw fail(403,'ACCOUNT_UNAVAILABLE');req.user=snap.data();next();}catch(e){next(e);}}
async function admin(req,_res,next){try{const role=(await db.doc('adminRoles/'+req.session.userId).get()).data();if(!role?.enabled||!role.permissions?.includes('media.write'))throw fail(403,'ADMIN_REQUIRED');next();}catch(e){next(e);}}
app.get('/api/me/wallet',member,async(req,res)=>{const wallet=(await db.doc('wallets/'+req.session.userId).get()).data();res.json({balance:wallet?.balance||0});});
app.post('/api/admin/media',member,admin,async(req,res)=>{
 await rateLimit(req,'upload',10);
 const {imageBase64,category,alt}=req.body||{};
 if(!['products','banners','games'].includes(category)||typeof imageBase64!=='string'||imageBase64.length>7*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)||typeof alt!=='string'||alt.length>200)throw fail(400,'INVALID_IMAGE');
 const input=Buffer.from(imageBase64,'base64');if(input.length>5*1024*1024)throw fail(413,'IMAGE_TOO_LARGE');
 let output;try{output=await sharp(input,{limitInputPixels:25000000}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();}catch{throw fail(400,'INVALID_IMAGE');}
 const ref=db.collection('media').doc(),path=`${category}/${ref.id}.webp`,file=getStorage().bucket(mediaBucket.value()).file(path);
 await file.save(output,{resumable:false,metadata:{contentType:'image/webp',cacheControl:'private,max-age=0'}});
 try{const batch=db.batch();batch.create(ref,{path,bucket:mediaBucket.value(),category,alt,status:'draft',bytes:output.length,createdBy:req.session.userId,createdAt:Timestamp.now()});batch.create(db.collection('auditLogs').doc(),{actor:req.session.userId,action:'media.upload',target:ref.id,at:Timestamp.now()});await batch.commit();}catch(e){await file.delete().catch(()=>{});throw e;}
 res.status(201).json({id:ref.id,path,status:'draft'});
});
app.get('/api/media/:id',async(req,res)=>{
 if(!/^[A-Za-z0-9]{20}$/.test(req.params.id))throw fail(404,'NOT_FOUND');const media=(await db.doc('media/'+req.params.id).get()).data();
 if(!media||media.status!=='published')throw fail(404,'NOT_FOUND');
 res.type('webp');getStorage().bucket(media.bucket).file(media.path).createReadStream().on('error',()=>{if(!res.headersSent)res.status(404).end();else res.destroy();}).pipe(res);
});
app.use((_req,res)=>res.status(404).json({code:'NOT_FOUND'}));
app.use((error,_req,res,_next)=>{const status=error.status||500;res.status(status).json({code:error.code&&error.status?error.code:'INTERNAL_ERROR'});});
exports.api=onRequest({region:'asia-northeast3',secrets:[googleSecret],maxInstances:3,timeoutSeconds:60,memory:'512MiB',invoker:'public'},app);
