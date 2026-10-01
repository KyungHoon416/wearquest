'use strict';
const {z} = require('zod');
const {Timestamp, FieldValue, FieldPath} = require('firebase-admin/firestore');
const {ApiError, hash, kstDay, requirePermission} = require('./core');
const titles = ['오늘의 스타일링','옷장 메모리','컬러 매치','패션 OX 퀴즈','양말 짝 찾기','드레스 코드','세탁 마스터','계절 옷장','스니커즈 메모리','패턴 탐정','소재 연구소','옷장 순서 기억','톤온톤 챌린지','캡슐 옷장','패션 타이밍','액세서리 매치','친환경 패션','런웨이 리듬','다른 옷 찾기','나만의 컬러 감각'];
const catalog = titles.map((title,index)=>({id:'game-'+String(index+1).padStart(2,'0'),index,title,enabled:true}));
const gameId = z.enum(catalog.map(g=>g.id));
const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fail = (status,code,message)=>new ApiError(status,code,message);
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;});
const emptyStats=()=>({started:0,completed:0,abandoned:0,participants:0,durationMs:0});
const statsView=d=>Object.fromEntries(Object.keys(emptyStats()).map(k=>[k,d?.[k]||0]));
function playView(s){const d=s.data();return {id:s.id,uid:d.uid,gameId:d.gameId,title:d.title,status:d.status,createdAt:d.createdAt.toDate().toISOString(),finishedAt:d.finishedAt?.toDate().toISOString()||null,durationMs:d.durationMs??null,day:d.day};}
function attachMemberGames(app,{db,verifyFirebaseToken}) {
 app.get('/api/auth/games/catalog',wrap(async(_req,res)=>{const settings=await db.getAll(...catalog.map(g=>db.doc('games/'+g.id)));res.json({items:catalog.map((g,i)=>({...g,enabled:settings[i].data()?.enabled!==false}))});}));
 app.use('/api/auth/games',wrap(async(req,_res,next)=>{
  let uid=req.session?.userId;
  if(!uid){
   const bearer=req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
   if(!bearer||bearer.length>8192)throw fail(401,'UNAUTHENTICATED','게임 기록을 저장하려면 로그인해주세요.');
   let token;try{token=await verifyFirebaseToken(bearer);}catch{throw fail(401,'UNAUTHENTICATED','로그인이 만료됐습니다.');}
   if(token.firebase?.sign_in_provider!=='google.com')throw fail(401,'UNAUTHENTICATED','지원하지 않는 인증 방식입니다.');
   uid=token.uid;
   if(typeof uid!=='string'||uid.length>128||uid.includes('/'))throw fail(401,'UNAUTHENTICATED','회원 정보를 확인해주세요.');
   // Only verified Firebase identities may establish Google profiles here.
   await db.runTransaction(async tx=>{const ref=db.doc('users/'+uid),snapshot=await tx.get(ref),old=snapshot.data();if(old?.status&&old.status!=='active')throw fail(403,'ACCOUNT_UNAVAILABLE','이용할 수 없는 계정입니다.');if(!old||!old.provider)tx.set(ref,{provider:'google',status:'active',nickname:String(token.name||old?.displayName||'회원').slice(0,80),email:token.email_verified?String(token.email||'').slice(0,254):'',...(!old?{createdAt:Timestamp.now(),displayName:String(token.name||'회원').slice(0,80)}:{})},{merge:true});});
  }
  const user=(await db.doc('users/'+uid).get()).data();
  if(!user||user.status!=='active')throw fail(403,'ACCOUNT_UNAVAILABLE','이용할 수 없는 계정입니다.');
  req.gameUid=uid;next();
 }));
 app.post('/api/auth/games/start',wrap(async(req,res)=>{
  const body=z.object({gameId,requestId:z.string().uuid()}).strict().parse(req.body),uid=req.gameUid;
  const ref=db.doc('gamePlays/'+hash(uid+':'+body.requestId));
  const result=await db.runTransaction(async tx=>{
   const prior=await tx.get(ref);if(prior.exists){if(prior.data().gameId!==body.gameId)throw fail(409,'REQUEST_CONFLICT','요청 번호가 중복됐습니다.');return {playId:ref.id,status:prior.data().status};}
   const config=await tx.get(db.doc('games/'+body.gameId));if(config.data()?.enabled===false)throw fail(409,'GAME_DISABLED','점검 중인 게임입니다. 다른 게임을 선택해주세요.');
   const now=Timestamp.now(),day=kstDay(now.toDate()),dailyPlayer=db.doc('gameDailyPlayers/'+hash(day+':'+uid)),gamePlayer=db.doc('gameDailyParticipants/'+hash(day+':'+body.gameId+':'+uid));
   const [p,g]=await Promise.all([tx.get(dailyPlayer),tx.get(gamePlayer)]);
   const rate=db.doc('gameStartLimits/'+hash(uid+':'+Math.floor(Date.now()/60000))),limit=await tx.get(rate);
   if((limit.data()?.count||0)>=12)throw fail(429,'RATE_LIMITED','잠시 후 다시 시작해주세요.');
   tx.set(rate,{count:(limit.data()?.count||0)+1,expiresAt:Timestamp.fromMillis(Date.now()+120000)});
   tx.create(ref,{uid,gameId:body.gameId,title:catalog.find(g=>g.id===body.gameId).title,status:'started',day,createdAt:now});
   if(!p.exists)tx.create(dailyPlayer,{uid,day,createdAt:now});if(!g.exists)tx.create(gamePlayer,{uid,gameId:body.gameId,day,createdAt:now});
   tx.set(db.doc('gameDailyTotals/'+day),{started:FieldValue.increment(1),participants:FieldValue.increment(p.exists?0:1)},{merge:true});
   tx.set(db.doc('gameDailyStats/'+day+'_'+body.gameId),{started:FieldValue.increment(1),participants:FieldValue.increment(g.exists?0:1)},{merge:true});
   return {playId:ref.id,status:'started'};
  });res.json(result);
 }));
 app.post('/api/auth/games/finish',wrap(async(req,res)=>{
  const b=z.object({playId:z.string().regex(/^[a-f0-9]{64}$/),result:z.enum(['completed','abandoned'])}).strict().parse(req.body);
  const ref=db.doc('gamePlays/'+b.playId);
  const result=await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),d=snap.data();if(!d||d.uid!==req.gameUid)throw fail(404,'NOT_FOUND','플레이 기록이 없습니다.');
   if(d.status!=='started'){if(d.status!==b.result)throw fail(409,'PLAY_FINISHED','이미 종료된 게임입니다.');return {playId:ref.id,status:d.status};}
   const durationMs=Date.now()-d.createdAt.toMillis();if(b.result==='completed'&&durationMs>30*60000)throw fail(409,'PLAY_EXPIRED','게임 기록 시간이 만료됐습니다. 다시 시작해주세요.');
   const duration=Math.min(30*60000,Math.max(0,durationMs));
   tx.update(ref,{status:b.result,finishedAt:Timestamp.now(),durationMs:duration});
   const delta={[b.result]:FieldValue.increment(1),...(b.result==='completed'?{durationMs:FieldValue.increment(duration)}:{})};
   tx.set(db.doc('gameDailyTotals/'+d.day),delta,{merge:true});tx.set(db.doc('gameDailyStats/'+d.day+'_'+d.gameId),delta,{merge:true});
   return {playId:ref.id,status:b.result};
  });res.json(result);
 }));
 app.get('/api/auth/games/history',wrap(async(req,res)=>{const rows=await db.collection('gamePlays').where('uid','==',req.gameUid).orderBy('createdAt','desc').limit(30).get();res.json({items:rows.docs.map(playView)});}));
}
function attachAdminGames(app,{db,audit}) {
 app.get('/api/admin/games',wrap(async(req,res)=>{
  const day=dateSchema.parse(req.query.day||kstDay());const [settings,stats,total]=await Promise.all([db.getAll(...catalog.map(g=>db.doc('games/'+g.id))),db.getAll(...catalog.map(g=>db.doc('gameDailyStats/'+day+'_'+g.id))),db.doc('gameDailyTotals/'+day).get()]);
  res.json({day,total:statsView(total.data()),items:catalog.map((g,i)=>({...g,enabled:settings[i].data()?.enabled!==false,...statsView(stats[i].data())}))});
 }));
 app.post('/api/admin/games/:id',wrap(async(req,res)=>{
  requirePermission(req.admin,'games');const id=gameId.parse(req.params.id),b=z.object({enabled:z.boolean(),reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
  await db.runTransaction(async tx=>{const ref=db.doc('games/'+id),old=(await tx.get(ref)).data();tx.set(ref,{enabled:b.enabled,updatedAt:Timestamp.now(),updatedBy:req.admin.id},{merge:true});audit(tx,req,'game.settings',id,`${old?.enabled!==false?'운영':'중지'} → ${b.enabled?'운영':'중지'}: ${b.reason}`);});res.json({ok:true});
 }));
 app.get('/api/admin/game-plays',wrap(async(req,res)=>{
  const day=dateSchema.parse(req.query.day||kstDay());let q=db.collection('gamePlays').where('createdAt','>=',Timestamp.fromDate(new Date(day+'T00:00:00+09:00'))).where('createdAt','<',Timestamp.fromMillis(new Date(day+'T00:00:00+09:00').getTime()+86400000));
  if(req.query.gameId)q=q.where('gameId','==',gameId.parse(req.query.gameId));
  if(req.query.uid)q=q.where('uid','==',z.string().min(1).max(128).regex(/^[^/]+$/).parse(req.query.uid));
  q=q.orderBy('createdAt','desc').orderBy(FieldPath.documentId(),'desc');
  if(req.query.cursor){let c;try{c=JSON.parse(Buffer.from(String(req.query.cursor),'base64url'));}catch{throw fail(400,'CURSOR','페이지 정보가 잘못됐습니다.');}const cursor=z.object({time:z.number().finite(),id:z.string().regex(/^[a-f0-9]{64}$/)}).parse(c);q=q.startAfter(Timestamp.fromMillis(cursor.time),cursor.id);}
  const rows=await q.limit(26).get(),docs=rows.docs.slice(0,25),last=docs.at(-1);
  res.json({items:docs.map(playView),nextCursor:rows.size>25?Buffer.from(JSON.stringify({time:last.data().createdAt.toMillis(),id:last.id})).toString('base64url'):null});
 }));
}
module.exports={attachMemberGames,attachAdminGames,catalog};
