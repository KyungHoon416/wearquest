'use strict';
const express = require('express');
const apple = require('./apple-auth');
const {z} = require('zod');
const {passwordRecord, verifyPassword} = require('./core');
const {Timestamp} = require('firebase-admin/firestore');
const {random, hash, equal, cookieToken, validSession, validMutation, publicUser} = require('./src/security');
const ORIGIN = 'https://wearquest-9a45f.web.app';
const MEMBER_ORIGINS = new Set([ORIGIN, 'https://wearquest-9a45f.firebaseapp.com']);
const CALLBACK = ORIGIN + '/api/auth/oauth/kakao/callback';
const CLIENT_ID = 'e92efbad146120b5b6d3ee78a2f6d37a';
const fail = (status, code) => Object.assign(new Error(code), {status, code});
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const expiry = ms => Timestamp.fromMillis(Date.now() + ms);

function createMemberApp({db, getSecret, getNaverSecret = () => '', getApplePrivateKey = () => '', request = fetch}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({limit: '16kb'}));
  app.use('/api/auth/oauth/apple/callback', express.urlencoded({extended: false, limit: '16kb', parameterLimit: 10}));
  app.use((req, res, next) => {
    res.set({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'});
    next();
  });
  async function rateLimit(req) {
    const ref = db.doc('rateLimits/' + hash('member:' + req.ip + ':' + Math.floor(Date.now() / 60000)));
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if ((data?.count || 0) >= 60) throw fail(429, 'RATE_LIMITED');
      tx.set(ref, {count: (data?.count || 0) + 1, expiresAt: expiry(120000)});
    });
  }
  function setCookie(res, token, maxAge, sameSite = 'lax') {
    res.cookie('__session', token, {httpOnly: true, secure: true, sameSite, path: '/', maxAge});
  }
  async function newSession(res, userId = null, oldRef = null, sameSite = 'lax') {
    const token = random(), maxAge = userId ? 7 * 86400000 : 30 * 60000;
    const session = {scope: 'member', userId, csrf: random(), createdAt: Timestamp.now(), expiresAt: expiry(maxAge)};
    const ref = db.doc('sessions/' + hash(token));
    const batch = db.batch();
    batch.create(ref, session);
    if (oldRef) batch.delete(oldRef);
    await batch.commit();
    setCookie(res, token, maxAge, sameSite);
    return {ref, ...session};
  }
  app.get('/api/auth/health', (_req, res) => res.json({ok: true, providers: ['kakao', 'naver', 'apple']}));
  app.use('/api/auth', wrap(async (req, res, next) => {
    await rateLimit(req);
    const token = cookieToken(req.headers.cookie);
    if (token) {
      const ref = db.doc('sessions/' + hash(token)), data = (await ref.get()).data();
      if (data?.scope === 'member' && validSession(data)) req.session = {ref, ...data};
    }
    // Apple form_post uses its own single-use, browser-bound state validation below.
    const appleCallback = req.method === 'POST' && req.path === '/oauth/apple/callback';
    if (!appleCallback && !['GET', 'HEAD'].includes(req.method) && (!MEMBER_ORIGINS.has(req.get('origin')) || !validMutation(req.get('origin'), req.get('origin'), req.get('x-csrf-token'), req.session?.csrf))) throw fail(403, 'CSRF_INVALID');
    next();
  }));
  app.get('/api/auth/session', wrap(async (req, res) => {
    let session = req.session, user = null;
    if (session?.userId) {
      const data = (await db.doc('users/' + session.userId).get()).data();
      if (data?.status !== 'active') {
        await session.ref.delete();
        res.clearCookie('__session', {httpOnly: true, secure: true, sameSite: 'lax', path: '/'});
        throw fail(403, 'ACCOUNT_UNAVAILABLE');
      }
      user = {...publicUser(session.userId, data), provider: data.provider || 'password'};
    }
    if (!session) session = await newSession(res);
    res.json({user, csrfToken: session.csrf});
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    if (req.session) await req.session.ref.delete();
    res.clearCookie('__session', {httpOnly: true, secure: true, sameSite: 'lax', path: '/'});
    res.json({ok: true});
  }));
  async function passwordLimit(key, maximum) {
    const ref = db.doc('rateLimits/' + hash('password:' + key + ':' + Math.floor(Date.now() / 900000)));
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if ((data?.count || 0) >= maximum) throw fail(429, 'RATE_LIMITED');
      tx.set(ref, {count: (data?.count || 0) + 1, expiresAt: expiry(1800000)});
    });
  }
  const usernameSchema = z.string().trim().regex(/^[A-Za-z0-9_]{4,20}$/).transform(v => v.toLowerCase());
  const registerSchema = z.object({username: usernameSchema, email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), nickname: z.string().trim().min(2).max(20), password: z.string().min(10).max(128), termsAccepted: z.literal(true), privacyAccepted: z.literal(true)}).strict();
  app.post('/api/auth/register', wrap(async (req, res) => {
    const data = registerSchema.parse(req.body);
    await passwordLimit('register-ip:' + req.ip, 8);
    const password = await passwordRecord(data.password);
    const userRef = db.collection('users').doc();
    const usernameRef = db.doc('memberIdentifiers/' + hash('username:' + data.username));
    const emailRef = db.doc('memberIdentifiers/' + hash('email:' + data.email));
    const token = random(), csrf = random(), now = Timestamp.now();
    await db.runTransaction(async tx => {
      const [username, email] = await Promise.all([tx.get(usernameRef), tx.get(emailRef)]);
      if (username.exists) throw fail(409, 'USERNAME_TAKEN');
      if (email.exists) throw fail(409, 'EMAIL_TAKEN');
      tx.create(userRef, {username: data.username, nickname: data.nickname, displayName: data.nickname, email: data.email, emailVerified: false, provider: 'password', status: 'active', createdAt: now, lastLoginAt: now, termsAcceptedAt: now, privacyAcceptedAt: now});
      // Credentials are isolated from public profiles and all client reads are denied by rules.
      tx.create(db.doc('memberCredentials/' + userRef.id), {password, createdAt: now});
      tx.create(usernameRef, {userId: userRef.id, kind: 'username'});
      tx.create(emailRef, {userId: userRef.id, kind: 'email'});
      tx.create(db.doc('wallets/' + userRef.id), {balance: 0, updatedAt: now});
      tx.create(db.doc('sessions/' + hash(token)), {scope: 'member', userId: userRef.id, csrf, createdAt: now, expiresAt: expiry(7 * 86400000)});
      if (req.session) tx.delete(req.session.ref);
    });
    setCookie(res, token, 7 * 86400000);
    res.status(201).json({ok: true, csrfToken: csrf});
  }));
  app.post('/api/auth/login', wrap(async (req, res) => {
    const data = z.object({identifier: z.string().trim().min(1).max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128)}).strict().parse(req.body);
    await passwordLimit('login-ip:' + req.ip, 30);
    await passwordLimit('login-account:' + data.identifier, 10);
    const kind = data.identifier.includes('@') ? 'email' : 'username';
    const link = (await db.doc('memberIdentifiers/' + hash(kind + ':' + data.identifier)).get()).data();
    const credential = link ? (await db.doc('memberCredentials/' + link.userId).get()).data() : null;
    const valid = await verifyPassword(data.password, credential?.password);
    const userRef = link ? db.doc('users/' + link.userId) : null;
    const user = userRef ? (await userRef.get()).data() : null;
    if (!valid || !user || user.status !== 'active' || user.provider !== 'password') throw fail(401, 'INVALID_CREDENTIALS');
    await newSession(res, userRef.id, req.session?.ref);
    await userRef.update({lastLoginAt: Timestamp.now()});
    res.json({ok: true});
  }));
  for (const provider of ['kakao', 'naver', 'apple']) {
  const isNaver = provider === 'naver', isApple = provider === 'apple';
  const clientId = isApple ? apple.CLIENT_ID : isNaver ? 'VtgY1TbI0MJzwGIhReT6' : CLIENT_ID;
  const callbackUrl = ORIGIN + '/api/auth/oauth/' + provider + '/callback';
  const secret = isApple ? getApplePrivateKey : isNaver ? getNaverSecret : getSecret;
  app.get('/api/auth/oauth/' + provider + '/start', wrap(async (req, res) => {
    if (!secret()?.trim()) throw fail(503, 'PROVIDER_NOT_CONFIGURED');
    // Canonical host keeps the state cookie on the exact registered callback host.
    if (req.get('x-forwarded-host') && req.get('x-forwarded-host') !== new URL(ORIGIN).host) return res.redirect(302, ORIGIN + '/api/auth/oauth/' + provider + '/start');
    // A fresh anonymous SameSite=None cookie binds Apple's cross-site POST to this browser.
    // The authenticated session rotates back to Lax after successful validation.
    const session = isApple ? await newSession(res, null, req.session?.ref, 'none') : req.session || await newSession(res), state = random(), nonce = random();
    await db.doc('oauthStates/' + hash(state)).create({provider, sessionId: session.ref.id, ...(isApple ? {nonce} : {}), expiresAt: expiry(10 * 60000)});
    const url = new URL(isApple ? 'https://appleid.apple.com/auth/authorize' : isNaver ? 'https://nid.naver.com/oauth2.0/authorize' : 'https://kauth.kakao.com/oauth/authorize');
    url.search = new URLSearchParams({client_id: clientId, redirect_uri: callbackUrl, response_type: 'code', state, ...(isApple ? {scope: 'email', response_mode: 'form_post', nonce} : {})}).toString();
    res.redirect(302, url.href);
  }));
  app[isApple ? 'post' : 'get']('/api/auth/oauth/' + provider + '/callback', wrap(async (req, res) => {
    try {
      const input = isApple ? req.body : req.query;
      const {state, code} = input;
      if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !req.session) throw fail(400, 'OAUTH_STATE_INVALID');
      const stateRef = db.doc('oauthStates/' + hash(state));
      const savedState = await db.runTransaction(async tx => {
        const saved = (await tx.get(stateRef)).data();
        if (!validSession(saved) || saved.provider !== provider || !equal(saved.sessionId, req.session.ref.id)) throw fail(400, 'OAUTH_STATE_INVALID');
        tx.delete(stateRef);
        return saved;
      });
      if (input.error) return res.redirect(303, ORIGIN + '/?auth_error=cancelled#login');
      if (typeof code !== 'string' || !code || code.length > 4096) throw fail(400, 'OAUTH_INVALID');
      const tokenResponse = await request(isApple ? 'https://appleid.apple.com/auth/token' : isNaver ? 'https://nid.naver.com/oauth2.0/token' : 'https://kauth.kakao.com/oauth/token', {
        method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({grant_type: 'authorization_code', client_id: clientId, client_secret: isApple ? apple.clientSecret(secret().trim()) : secret().trim(), redirect_uri: callbackUrl, code, ...(isNaver ? {state} : {})}).toString()
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || typeof tokens.access_token !== 'string' || !tokens.access_token) throw fail(502, 'OAUTH_EXCHANGE_FAILED');
      let subject, email, nickname;
      if (isApple) {
        const claims = await apple.verifyIdentity(tokens.id_token, savedState.nonce, request);
        subject = claims.sub;
        email = (claims.email_verified === true || claims.email_verified === 'true') && typeof claims.email === 'string' ? claims.email.slice(0, 254) : '';
        nickname = 'Apple 회원';
      } else {
        const profileResponse = await request(isNaver ? 'https://openapi.naver.com/v1/nid/me' : 'https://kapi.kakao.com/v2/user/me', {headers: {Authorization: 'Bearer ' + tokens.access_token}, signal: AbortSignal.timeout(10000)});
        const result = await profileResponse.json(), profile = isNaver ? result.response : result;
        const validId = isNaver ? typeof profile?.id === 'string' && profile.id.length > 0 && profile.id.length <= 256 : Number.isSafeInteger(profile?.id) && profile.id > 0;
        if (!profileResponse.ok || !validId || (isNaver && result.resultcode !== '00')) throw fail(502, 'OAUTH_PROFILE_INVALID');
        subject = String(profile.id);
        const account = profile.kakao_account || {};
        const candidateEmail = isNaver ? profile.email : account.is_email_valid === true && account.is_email_verified === true ? account.email : '';
        email = typeof candidateEmail === 'string' ? candidateEmail.slice(0, 254) : '';
        const candidateName = isNaver ? profile.nickname : account.profile?.nickname;
        nickname = typeof candidateName === 'string' && candidateName.trim() ? candidateName.slice(0, 40) : isNaver ? '네이버 회원' : '카카오 회원';
      }
      // Provider subject is the identity; never merge accounts by matching email.
      const identity = db.doc('identities/' + hash(provider + ':' + subject)), newUser = db.collection('users').doc();
      const userId = await db.runTransaction(async tx => {
        const link = (await tx.get(identity)).data();
        if (link) {
          const ref = db.doc('users/' + link.userId), user = (await tx.get(ref)).data();
          if (user?.status !== 'active') throw fail(403, 'ACCOUNT_UNAVAILABLE');
          tx.update(ref, {lastLoginAt: Timestamp.now()});
          return link.userId;
        }
        tx.create(newUser, {nickname, displayName: nickname, email, provider, status: 'active', createdAt: Timestamp.now(), lastLoginAt: Timestamp.now(), termsAcceptedAt: null});
        tx.create(identity, {provider, subject, userId: newUser.id, createdAt: Timestamp.now()});
        tx.create(db.doc('wallets/' + newUser.id), {balance: 0, updatedAt: Timestamp.now()});
        return newUser.id;
      });
      await newSession(res, userId, req.session.ref);
      res.redirect(303, ORIGIN + '/#account');
    } catch (error) {
      // Never include provider response bodies, codes, tokens or secrets in logs.
      console.warn(JSON.stringify({event: provider + '.callback.failed', code: error.status ? error.code : 'INTERNAL_ERROR'}));
      res.redirect(303, ORIGIN + '/?auth_error=' + (error.code === 'ACCOUNT_UNAVAILABLE' ? 'unavailable' : 'failed') + '#login');
    }
  }));
  }
  app.use((_req, res) => res.status(404).json({code: 'NOT_FOUND'}));
  app.use((error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({code: error instanceof z.ZodError ? 'VALIDATION' : error.status ? error.code : 'INTERNAL_ERROR'}));
  return app;
}
module.exports = {createMemberApp, CALLBACK, ORIGIN};
