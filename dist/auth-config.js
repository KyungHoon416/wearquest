// Public configuration only. Never put OAuth client secrets or passwords here.
window.WEARQUEST_AUTH_CONFIG = Object.freeze({
  apiBase: '', // HTTPS authentication server, e.g. https://api.your-domain.com/auth
  providers: ['google', 'kakao', 'naver', 'apple'],
  additionalProviders: [] // { id: 'provider-id', label: '서비스명' }; server must allowlist IDs
});
