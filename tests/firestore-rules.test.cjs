const test = require('node:test');
const assert = require('node:assert/strict');
const base='http://127.0.0.1:8188/v1/projects/demo-wearquest/databases/(default)/documents';
const root='projects/demo-wearquest/databases/(default)/documents';
function token(uid){const now=Math.floor(Date.now()/1000);return [Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,user_id:uid,aud:'demo-wearquest',iss:'https://securetoken.google.com/demo-wearquest',iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'google.com'}})).toString('base64url'),''].join('.');}
async function request(path,uid,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(uid?{Authorization:'Bearer '+token(uid)}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();return {status:r.status,data:d};}
const uid='owner-'+Date.now();
function profile(extra={}){return {writes:[{update:{name:root+'/users/'+uid,fields:{displayName:{stringValue:'Tester'},...extra}},updateTransforms:['createdAt','updatedAt'].map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}]};}
test('Firestore ownership and authoritative fields',async()=>{
 assert.equal((await request(':commit',uid,'POST',profile())).status,200,'owner can create valid profile');
 assert.equal((await request('/users/'+uid,uid)).status,200,'owner can read');
 assert.equal((await request('/users/'+uid,'other')).status,403,'other user cannot read');
 assert.equal((await request('/users/'+uid,null)).status,403,'guest cannot read');
 assert.equal((await request('/users/'+uid,uid,'PATCH',{fields:{displayName:{stringValue:'Hacker'},points:{integerValue:'100'}}})).status,403,'balance injection rejected');
 assert.equal((await request('/users/'+uid+'/wallet/current',uid,'PATCH',{fields:{points:{integerValue:'100'}}})).status,403,'wallet writes rejected');
 assert.equal((await request('/users/'+uid,uid,'DELETE')).status,403,'profile delete rejected');
 const old=(await request('/users/'+uid,uid)).data.fields.createdAt;
 const update={writes:[{update:{name:root+'/users/'+uid,fields:{displayName:{stringValue:'Updated'},createdAt:old}},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]};
 assert.equal((await request(':commit',uid,'POST',update)).status,200,'valid profile update succeeds');
});
