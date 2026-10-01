'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {CLIENT_ID,clientSecret,verifyIdentity}=require('../apple-auth');
const ec=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...rsa.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'};
const request=async url=>{assert.equal(url,'https://appleid.apple.com/auth/keys');return {ok:true,json:async()=>({keys:[jwk]})};};
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const claims=()=>({iss:'https://appleid.apple.com',aud:CLIENT_ID,sub:'apple-user',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce:'test-nonce'});
function token(data,header={alg:'RS256',kid:'test'},key=rsa.privateKey){const body=enc(header)+'.'+enc(data);return body+'.'+crypto.sign('sha256',Buffer.from(body),key).toString('base64url');}
test('Apple client secret uses supplied team/client/key IDs and a valid short-lived ES256 signature',()=>{
 const jwt=clientSecret(ec.privateKey.export({type:'pkcs8',format:'pem'})),parts=jwt.split('.');
 const header=JSON.parse(Buffer.from(parts[0],'base64url')),body=JSON.parse(Buffer.from(parts[1],'base64url'));
 assert.equal(header.kid,'98A6S8N55L');assert.equal(header.alg,'ES256');assert.equal(body.iss,'R848ZS47Z6');assert.equal(body.sub,CLIENT_ID);assert.equal(body.exp-body.iat,300);
 assert.ok(crypto.verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key:ec.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
});
test('Apple validates signature, issuer, audience, expiry and browser nonce',async()=>{
 assert.equal((await verifyIdentity(token(claims()),'test-nonce',request)).sub,'apple-user');
 for(const overrides of [{iss:'https://evil.test'},{aud:'another-client'},{exp:1},{iat:9999999999},{nonce:'wrong'},{sub:''}]) await assert.rejects(verifyIdentity(token({...claims(),...overrides}),'test-nonce',request));
 await assert.rejects(verifyIdentity(token(claims(),{alg:'none',kid:'test'}),'test-nonce',request));
 await assert.rejects(verifyIdentity(token(claims(),{alg:'RS256',kid:'unknown'}),'test-nonce',request));
 const other=crypto.generateKeyPairSync('rsa',{modulusLength:2048});await assert.rejects(verifyIdentity(token(claims(),undefined,other.privateKey),'test-nonce',request));
});
