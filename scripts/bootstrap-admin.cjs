#!/usr/bin/env node
// Operator-only provisioning via an already verified Firebase CLI identity.
// This script is not shipped in Hosting or exposed as an HTTP route.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {passwordRecord,hash}=require('../functions/core');
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>{if(x.startsWith('--'))a.push([x.slice(2),all[i+1]]);return a;},[]));
(async()=>{
 if(!/^[a-zA-Z0-9_.@-]{3,100}$/.test(args.username||'')||!args.name||!args.out)throw Error('Usage: node scripts/bootstrap-admin.cjs --username USER --name NAME --out /private/tmp/initial-admin.txt');
 if(!path.resolve(args.out).startsWith('/private/tmp/')&&!path.resolve(args.out).startsWith('/tmp/'))throw Error('Credential output must be outside the repository in /private/tmp.');
 const auth=require(process.env.FIREBASE_CLI_AUTH_MODULE||'/usr/local/lib/node_modules/firebase-tools/lib/auth.js');
 const account=auth.getGlobalDefaultAccount();if(!account?.user?.email||!account.tokens?.refresh_token)throw Error('Run firebase login with the authorized project operator first.');
 const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase']);
 const database='projects/wearquest-9a45f/databases/(default)';
 async function api(method,suffix,body){const r=await fetch('https://firestore.googleapis.com/v1/'+database+suffix,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error?.message||'Firestore request failed');return result;}
 function value(v){if(v instanceof Date)return {timestampValue:v.toISOString()};if(typeof v==='string')return {stringValue:v};if(typeof v==='boolean')return {booleanValue:v};if(typeof v==='number')return {integerValue:String(v)};return {mapValue:{fields:fields(v)}};}
 function fields(v){return Object.fromEntries(Object.entries(v).map(([k,v])=>[k,value(v)]));}
 const role=args.additional==='true'?(args.role||'viewer'):'superadmin';if(!['superadmin','operations','support','viewer'].includes(role))throw Error('Invalid role');
 const id=hash(args.username.toLowerCase()),password=crypto.randomBytes(24).toString('base64url'),record=await passwordRecord(password);
 const credentialText=`WEAR QUEST 관리자 최초 로그인\nURL: https://wearquest-admin-9a45f.web.app\n아이디: ${args.username}\n임시 비밀번호: ${password}\n\n24시간 안에 로그인하고 비밀번호를 변경하세요. 변경 후 이 파일을 삭제하세요.\n`;
 const handle=fs.openSync(args.out,'wx',0o600);fs.writeFileSync(handle,credentialText);fs.closeSync(handle);
 let transaction;
 try{
  ({transaction}=await api('POST','/documents:beginTransaction',{options:{readWrite:{}}}));
  const existing=await api('POST','/documents:runQuery',{transaction,structuredQuery:{from:[{collectionId:'admins'}],limit:1}});
  if(existing.some(r=>r.document)&&args.additional!=='true')throw Error('An administrator already exists. Use the separately authorized --additional true operator procedure.');
  const guardPath=database+'/documents/adminConfig/adminGuard';
  const docs=await api('POST','/documents:batchGet',{transaction,documents:[guardPath,database+'/documents/admins/'+id]});
  if(docs.some(r=>r.found?.name===database+'/documents/admins/'+id))throw Error('Account already exists; refusing to overwrite credentials.');
  const guard=docs.find(r=>r.found?.name===guardPath)?.found;
  const time=new Date();
  const writes=[
   {update:{name:database+'/documents/admins/'+id,fields:fields({username:args.username.toLowerCase(),displayName:args.name,role,status:'active',password:record,authVersion:1,forcePasswordChange:true,bootstrapExpiresAt:new Date(Date.now()+86400000),createdAt:time})},currentDocument:{exists:false}},
   {update:{name:guardPath,fields:fields({version:Number(guard?.fields?.version?.integerValue||0)+1})}},
   {update:{name:database+'/documents/adminAudit/'+crypto.randomUUID(),fields:fields({createdAt:time,actor:'verified-operator',actorName:account.user.email,action:'admin.bootstrap',target:id,summary:'운영자 IAM 인증으로 최초 계정 발급. 24시간 만료 및 비밀번호 변경 필수.',result:'success',requestId:crypto.randomUUID()})},currentDocument:{exists:false}}
  ];
  await api('POST','/documents:commit',{transaction,writes});
 }catch(e){if(transaction)await api('POST','/documents:rollback',{transaction}).catch(()=>{});fs.unlinkSync(args.out);throw e;}
 console.log('Initial administrator provisioned. Credentials saved with owner-only permissions at '+args.out);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
