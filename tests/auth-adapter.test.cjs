const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(firebase, options = {}) {
  const messages = [], routes = [];
  const message = { textContent: '', classList: { toggle() {} } };
  const header = {};
  const context = vm.createContext({
    window: { WEARQUEST_AUTH_CONFIG: { apiBase: '', providers: ['google'], ...options.config }, WearQuestFirebase: firebase, location: { origin:'https://wearquest-9a45f.web.app', search:'', assign: url => routes.push(url) } },
    document: { getElementById: () => message, querySelector: () => header },
    toast: text => messages.push(text), go: route => routes.push(route),
    route: 'home', render() {}, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch:options.fetch
  });
  vm.runInContext(fs.readFileSync('dist/auth.js', 'utf8'), context);
  return { context, message, header, messages, routes, run: code => vm.runInContext(code, context) };
}

test('Google login updates account; unsupported providers do not call Firebase', async () => {
  let calls = 0;
  const state = setup({ googleEnabled: true, signInGoogle: async () => { calls++; return { id: 'u1' }; } });
  await state.run("startSocial('kakao')");
  assert.equal(calls, 0);
  await state.run("startSocial('google')");
  assert.equal(calls, 1);
  assert.equal(state.run('authUser.id'), 'u1');
  assert.deepEqual(state.routes, ['account']);
});

test('popup failure never fabricates a session and releases busy state', async () => {
  const state = setup({ googleEnabled: true, signInGoogle: async () => { throw { code: 'auth/popup-blocked' }; }, errorMessage: () => '팝업 차단' });
  await state.run("startSocial('google')");
  assert.equal(state.run('authUser'), null);
  assert.equal(state.run('authBusy'), false);
  assert.equal(state.message.textContent, '팝업 차단');
});

test('unconfigured login does not send credentials or navigate', async () => {
  const state = setup({ configured: false, googleEnabled: false });
  await state.run("startSocial('google')");
  assert.equal(state.routes.length, 0);
  assert.match(state.message.textContent, /연결 전/);
});

test('failed sign-out retains the authenticated account', async () => {
  const state = setup({ configured: true, signOut: async () => { throw new Error('offline'); } });
  state.run("authUser={id:'u1'}");
  await state.run('logoutAuth({disabled:false})');
  assert.equal(state.run('authUser.id'), 'u1');
  assert.equal(state.routes.length, 0);
});

test('successful sign-out clears account without using legacy CSRF backend', async () => {
  const state = setup({ configured: true, signOut: async () => {} });
  state.run("authUser={id:'u1'}");
  await state.run('logoutAuth({disabled:false})');
  assert.equal(state.run('authUser'), null);
  assert.deepEqual(state.routes, ['login']);
});


test('Kakao redirect uses configured same-origin server; Google stays on Firebase', async () => {
  const state=setup({googleEnabled:true},{config:{apiBase:'/api/auth',providers:['kakao']}});
  await state.run("startSocial('kakao')");
  assert.deepEqual(state.routes,['https://wearquest-9a45f.web.app/api/auth/oauth/kakao/start']);
});

test('member cookie session takes precedence over an old Firebase session', async () => {
  let observed=false;
  const state=setup({configured:true,observe:async()=>{observed=true;}},{config:{apiBase:'/api/auth',providers:['kakao']},fetch:async()=>({ok:true,json:async()=>({user:{id:'kakao-user',provider:'kakao'},csrfToken:'csrf'})})});
  await state.run('initializeAuth()');
  assert.equal(state.run('authUser.id'),'kakao-user');
  assert.equal(state.run('authBackend'),'server');
  assert.equal(observed,false);
});

test('Kakao logout clears server session and any old Firebase session', async () => {
  const calls=[];let signedOut=false;
  const state=setup({configured:true,signOut:async()=>{signedOut=true;}},{config:{apiBase:'/api/auth'},fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url.endsWith('/session')?{user:{id:'kakao-user'},csrfToken:'csrf'}:{ok:true}};}});
  state.run("authUser={id:'kakao-user'};authBackend='server'");
  await state.run('logoutAuth({disabled:false})');
  assert.equal(signedOut,true);
  assert.equal(calls[1].url,'https://wearquest-9a45f.web.app/api/auth/logout');
  assert.equal(calls[1].opts.headers['X-CSRF-Token'],'csrf');
  assert.equal(state.run('authUser'),null);
});

test('password signup sends consent and opens account after the server session is established', async () => {
  const state=setup({configured:false},{config:{apiBase:'/api/auth'}});
  const fields={signupId:{value:'newmember'},signupEmail:{value:'member@example.test'},signupName:{value:'회원'},signupPassword:{value:'test-password-123'},signupConfirm:{value:'test-password-123'},agreeTerms:{checked:true},agreePrivacy:{checked:true},authMessage:{textContent:'',classList:{toggle(){}}}};
  state.context.document.getElementById=id=>fields[id];
  state.context.form={reportValidity:()=>true,querySelector:()=>({disabled:false,textContent:''}),querySelectorAll:()=>[],reset(){}};
  state.run("var calls=[];var registered=false;authRequest=async(path,payload)=>{calls.push({path,payload});if(path==='/register'){registered=true;return {ok:true}}return {csrfToken:'csrf',user:registered?{id:'member-id'}:null};}");
  await state.run("submitAuth({preventDefault(){},currentTarget:form},'signup')");
  assert.equal(state.run("calls.find(x=>x.path==='/register').payload.termsAccepted"),true);
  assert.equal(state.run('authUser.id'),'member-id');
  assert.equal(state.run('authBackend'),'server');
  assert.deepEqual(state.routes,['account']);
  assert.ok(state.messages.includes('회원가입이 완료됐어요.'));
});
