const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(firebase) {
  const messages = [], routes = [];
  const message = { textContent: '', classList: { toggle() {} } };
  const header = {};
  const context = vm.createContext({
    window: { WEARQUEST_AUTH_CONFIG: { apiBase: '', providers: ['google'] }, WearQuestFirebase: firebase },
    document: { getElementById: () => message, querySelector: () => header },
    toast: text => messages.push(text), go: route => routes.push(route),
    route: 'home', render() {}, URL
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
