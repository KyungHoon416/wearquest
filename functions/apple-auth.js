'use strict';
const crypto = require('node:crypto');
const {equal} = require('./src/security');
const CLIENT_ID = 'com.wearquest.wear';
const TEAM_ID = 'R848ZS47Z6';
const KEY_ID = '98A6S8N55L';
const ISSUER = 'https://appleid.apple.com';
const invalid = () => Object.assign(new Error('OAUTH_TOKEN_INVALID'), {status: 400, code: 'OAUTH_TOKEN_INVALID'});
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function clientSecret(pem) {
  const now = Math.floor(Date.now() / 1000);
  const input = encode({alg: 'ES256', kid: KEY_ID}) + '.' + encode({iss: TEAM_ID, sub: CLIENT_ID, aud: ISSUER, iat: now, exp: now + 300});
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw invalid();
  return input + '.' + crypto.sign('sha256', Buffer.from(input), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url');
}
async function verifyIdentity(token, nonce, request) {
  if (typeof token !== 'string' || token.length > 16384) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(v => !/^[A-Za-z0-9_-]+$/.test(v))) throw invalid();
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw invalid();
  const response = await request(ISSUER + '/auth/keys', {signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw invalid();
  const keys = (await response.json()).keys;
  const jwk = Array.isArray(keys) && keys.find(k => k.kid === header.kid && k.kty === 'RSA' && k.alg === 'RS256' && k.use === 'sig');
  if (!jwk || !crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({key: jwk, format: 'jwk'}), Buffer.from(parts[2], 'base64url'))) throw invalid();
  const data = JSON.parse(Buffer.from(parts[1], 'base64url')), now = Math.floor(Date.now() / 1000);
  if (data.iss !== ISSUER || data.aud !== CLIENT_ID || !Number.isFinite(data.exp) || data.exp <= now || !Number.isFinite(data.iat) || data.iat > now + 60 || !equal(data.nonce, nonce) || typeof data.sub !== 'string' || !data.sub || data.sub.length > 256) throw invalid();
  return data;
}
module.exports = {CLIENT_ID, clientSecret, verifyIdentity};
