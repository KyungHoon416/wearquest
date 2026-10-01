'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {hash,random,kstDay}=require('../core');
const {Timestamp}=require('firebase-admin/firestore');
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8188'&&process.env.GCLOUD_PROJECT==='demo-wearquest';
let db,server,adminServer,base,adminBase,cookie,adminCookie,viewerCookie;
const origin='https://wearquest-9a45f.web.app';
before(async()=>{
 if(!enabled)return;
 const {app}=require('../index');db=require('firebase-admin/firestore').getFirestore();
 const {createMemberApp}=require('../member-app');
 const member=createMemberApp({db,getSecret:()=>'',verifyFirebaseToken:async token=>{if(token!=='valid-google')throw Error();return {uid:'games-google',name:'Google member',firebase:{sign_in_provider:'google.com'}};}});
 server=member.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 adminServer=app.listen(0,'127.0.0.1');await new Promise(r=>adminServer.once('listening',r));adminBase='http://127.0.0.1:'+adminServer.address().port;
 cookie=random();await db.doc('users/games-member').set({status:'active',provider:'apple'});await db.doc('sessions/'+hash(cookie)).set({scope:'member',userId:'games-member',csrf:'game-csrf',expiresAt:Timestamp.fromMillis(Date.now()+3600000)});
 for(const role of ['superadmin','viewer']){const t=random(),id='games-'+role;await db.doc('admins/'+id).set({status:'active',role,authVersion:1,displayName:role});await db.doc('sessions/'+hash(t)).set({scope:'admin',adminId:id,authVersion:1,csrf:'game-csrf',expiresAt:Timestamp.fromMillis(Date.now()+3600000)});if(role==='superadmin')adminCookie=t;else viewerCookie=t;}
});
after(async()=>{for(const s of [server,adminServer])if(s)await new Promise(r=>s.close(r));});
async function req(path,body,opts={}){const r=await fetch((opts.admin?adminBase+'/api/admin/':base+'/api/auth/games/')+path,{method:body?'POST':'GET',headers:{'X-Forwarded-For':'192.0.2.31',Origin:opts.admin?'https://wearquest-admin-9a45f.web.app':origin,Cookie:'__session='+(opts.cookie??(opts.admin?adminCookie:cookie)),'X-CSRF-Token':opts.csrf??'game-csrf','Content-Type':'application/json',...(opts.token?{Authorization:'Bearer '+opts.token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
let playId;
test('games require login and CSRF and reject arbitrary game IDs or forged fields',{skip:!enabled},async()=>{
 assert.equal((await req('start',{gameId:'game-01',requestId:crypto.randomUUID()},{cookie:''})).status,403);
 assert.equal((await req('start',{gameId:'game-01',requestId:crypto.randomUUID()},{csrf:'wrong'})).status,403);
 assert.equal((await req('start',{gameId:'game-99',requestId:crypto.randomUUID()})).status,400);
 assert.equal((await req('start',{gameId:'game-01',requestId:crypto.randomUUID(),uid:'another-member'})).status,400);
});
test('concurrent retries count one start; daily participants deduplicate across games',{skip:!enabled},async()=>{
 const body={gameId:'game-01',requestId:crypto.randomUUID()};const results=await Promise.all([req('start',body),req('start',body)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].data.playId,results[1].data.playId);playId=results[0].data.playId;
 assert.equal((await req('start',{...body,gameId:'game-02'})).status,409);
 await req('start',{gameId:'game-02',requestId:crypto.randomUUID()});
 const day=kstDay(),total=(await db.doc('gameDailyTotals/'+day).get()).data();assert.equal(total.started,2);assert.equal(total.participants,1);assert.equal((await db.doc('gameDailyStats/'+day+'_game-01').get()).data().participants,1);
});
test('completion is idempotent, duration is server measured, no points awarded',{skip:!enabled},async()=>{
 const before=(await db.collection('pointTransactions').where('uid','==','games-member').get()).size;const results=await Promise.all([req('finish',{playId,result:'completed'}),req('finish',{playId,result:'completed'})]);assert.deepEqual(results.map(r=>r.status),[200,200]);
 const row=(await db.doc('gamePlays/'+playId).get()).data();assert.equal(row.status,'completed');assert.ok(row.durationMs>=0);assert.equal((await db.doc('gameDailyTotals/'+kstDay()).get()).data().completed,1);assert.equal((await db.collection('pointTransactions').where('uid','==','games-member').get()).size,before);
 assert.equal((await req('finish',{playId,result:'abandoned'})).status,409);
 const history=await req('history');assert.equal(history.status,200);assert.equal(history.data.items.length,2);assert.ok(history.data.items.every(p=>p.uid==='games-member'));
});
test('admin control enforces permission and logs changes; stopped games reject starts but allow existing finish',{skip:!enabled},async()=>{
 const b={enabled:false,reason:'test maintenance'};
 assert.equal((await req('games/game-02',b,{admin:true,cookie:viewerCookie})).status,403);
 assert.equal((await req('games/game-02',b,{admin:true})).status,200);
 assert.equal((await req('start',{gameId:'game-02',requestId:crypto.randomUUID()})).status,409);
 const existing=(await db.collection('gamePlays').where('gameId','==','game-02').get()).docs[0];assert.equal((await req('finish',{playId:existing.id,result:'abandoned'})).status,200);
 assert.equal((await db.collection('adminAudit').where('action','==','game.settings').get()).size,1);
 const stats=await req('games?day='+kstDay(),null,{admin:true});assert.equal(stats.status,200);assert.equal(stats.data.items.length,20);assert.equal(stats.data.total.abandoned,1);
 assert.equal((await req('game-plays?day='+kstDay()+'&uid=games-member&gameId=game-01',null,{admin:true})).data.items.length,1);
 assert.equal((await req('games?day=2026-02-31',null,{admin:true})).status,400);
});
test('Google ID tokens are verified, own history isolated and suspended accounts denied',{skip:!enabled},async()=>{
 const t=random();await db.doc('sessions/'+hash(t)).set({scope:'member',userId:null,csrf:'game-csrf',expiresAt:Timestamp.fromMillis(Date.now()+3600000)});
 const body={gameId:'game-03',requestId:crypto.randomUUID()};assert.equal((await req('start',body,{cookie:t,token:'forged'})).status,401);
 const result=await req('start',body,{cookie:t,token:'valid-google'});assert.equal(result.status,200);assert.equal((await db.doc('users/games-google').get()).data().provider,'google');
 assert.equal((await req('finish',{playId:result.data.playId,result:'completed'})).status,404);
 const h=await req('history',null,{cookie:t,token:'valid-google'});assert.equal(h.data.items.length,1);assert.equal(h.data.items[0].uid,'games-google');
 await db.doc('users/games-google').update({status:'suspended'});assert.equal((await req('history',null,{cookie:t,token:'valid-google'})).status,403);
});
