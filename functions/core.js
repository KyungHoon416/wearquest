'use strict';
const crypto = require('node:crypto');
const existingSecurity = require('./src/security');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const roles = {
  superadmin: ['read','pii','members','points','products','orders','support','policies','settings','admins','providers','games'],
  operations: ['read','pii','products','orders'],
  support: ['read','pii','members','support'],
  viewer: ['read']
};
const transitions = {received:['preparing','cancelled'],preparing:['shipped','cancelled'],shipped:['delivered'],delivered:[],cancelled:[]};
class ApiError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
function requirePermission(admin,permission){if(!admin || admin.status!=='active'||!roles[admin.role]?.includes(permission))throw new ApiError(403,'FORBIDDEN','이 작업을 수행할 권한이 없습니다.');}
function balanceAfter(balance,delta){if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(delta)||!delta||Math.abs(delta)>100000||balance+delta<0||!Number.isSafeInteger(balance+delta))throw new ApiError(400,'INVALID_POINTS','포인트 수량 또는 잔액을 확인해주세요.');return balance+delta;}
function transition(from,to){if(!transitions[from]?.includes(to))throw new ApiError(409,'INVALID_TRANSITION','허용되지 않는 주문 상태 변경입니다.');}
function hash(value){return existingSecurity.hash(value);}
function random(){return existingSecurity.random();}
async function passwordRecord(password){const salt=random();return {salt,hash:(await scrypt(password,salt,64)).toString('hex')};}
async function verifyPassword(password,record){const derived=await scrypt(password,record?.salt||'invalid-account',64);const expected=Buffer.from(record?.hash||'00'.repeat(64),'hex');return expected.length===derived.length&&crypto.timingSafeEqual(derived,expected);}
function kstDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function redact(data){const {password,salt,hash:passwordHash,csrf,token,sessionToken,secret,clientSecret,...safe}=data;return safe;}
module.exports={roles,transitions,ApiError,requirePermission,balanceAfter,transition,hash,random,passwordRecord,verifyPassword,kstDay,redact};
