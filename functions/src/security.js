'use strict';
const crypto = require('node:crypto');
const random = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function equal(a,b){return typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function cookieToken(header=''){const m=header.match(/(?:^|;\s*)__session=([A-Za-z0-9_-]{43})(?:;|$)/);return m?.[1]||null;}
function validSession(data,now=Date.now()){return Boolean(data&&data.expiresAt?.toMillis()>now);}
function validMutation(origin,allowed,csrf,expected){return origin===allowed&&equal(csrf,expected);}
function publicUser(id,data){return {id,username:data.username||'',nickname:data.nickname||'회원',email:data.email||'',onboardingRequired:!data.termsAcceptedAt};}
module.exports={random,hash,equal,cookieToken,validSession,validMutation,publicUser};
