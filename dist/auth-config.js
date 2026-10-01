// Public configuration only. Never put OAuth client secrets or passwords here.
window.WEARQUEST_AUTH_CONFIG = Object.freeze({
  apiBase: '/api/auth', // Same-origin member session API; Google retains its Firebase adapter.
  providers: ['kakao', 'naver', 'apple'],
  additionalProviders: [] // { id: 'provider-id', label: '서비스명' }; server must allowlist IDs
});
