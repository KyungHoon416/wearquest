/* Firebase is the managed authentication backend; Firestore rules enforce ownership. */
(() => {
  const config = window.WEARQUEST_FIREBASE_CONFIG || {};
  const configured = Boolean(config.enabled && config.apiKey && config.appId);
  let servicesPromise;
  function services() {
    if (!configured) return Promise.reject(new Error('Firebase 연결 준비 중입니다.'));
    if (!servicesPromise) servicesPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')
    ]).then(async ([appSDK, authSDK, dbSDK]) => {
      const { enabled, googleEnabled, ...publicConfig } = config;
      const app = appSDK.initializeApp(publicConfig);
      const auth = authSDK.getAuth(app);
      auth.languageCode = 'ko';
      // Persist only for this browser tab. The SDK manages tokens, never app code.
      await authSDK.setPersistence(auth, authSDK.browserSessionPersistence);
      return { auth, db: dbSDK.getFirestore(app), authSDK, dbSDK };
    }).catch(error => { servicesPromise = undefined; throw error; });
    return servicesPromise;
  }
  function userView(user) {
    return user ? { id: user.uid, nickname: user.displayName || '회원', email: user.email || '' } : null;
  }
  async function syncProfile(user) {
    const { auth, db, dbSDK } = await services();
    if (!user || auth.currentUser?.uid !== user.uid) return;
    const ref = dbSDK.doc(db, 'users', user.uid);
    await dbSDK.runTransaction(db, async tx => {
      const snapshot = await tx.get(ref);
      const data = {
        displayName: (user.displayName || '회원').slice(0, 80),
        updatedAt: dbSDK.serverTimestamp()
      };
      if (!snapshot.exists()) data.createdAt = dbSDK.serverTimestamp();
      tx.set(ref, data, { merge: true });
    });
  }
  function errorMessage(error) {
    return ({
      'auth/popup-closed-by-user': '로그인 창을 닫았어요. 다시 시도해주세요.',
      'auth/popup-blocked': '팝업을 허용한 뒤 다시 로그인해주세요.',
      'auth/cancelled-popup-request': '이미 로그인 창이 열려 있어요.',
      'auth/unauthorized-domain': '이 주소의 로그인 설정이 아직 완료되지 않았어요.',
      'auth/operation-not-allowed': 'Google 로그인 연결 준비 중입니다.',
      'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
      'auth/account-exists-with-different-credential': '기존에 가입한 로그인 방식으로 로그인해주세요.'
    })[error?.code] || '로그인을 처리하지 못했어요. 잠시 후 다시 시도해주세요.';
  }
  window.WearQuestFirebase = Object.freeze({
    configured,
    googleEnabled: configured && config.googleEnabled === true,
    errorMessage,
    async observe(onUser, onProfileError) {
      const { auth, authSDK } = await services();
      return authSDK.onAuthStateChanged(auth, user => {
        onUser(userView(user));
        if (user) syncProfile(user).catch(() => {
          if (auth.currentUser?.uid === user.uid) onProfileError();
        });
      });
    },
    async idToken() { const {auth}=await services(); return auth.currentUser ? auth.currentUser.getIdToken() : null; },
    async signInGoogle() {
      if (!this.googleEnabled) throw new Error('Google 로그인 연결 준비 중입니다.');
      if (window.Capacitor?.isNativePlatform?.()) {
        throw new Error('앱 내 Google 로그인은 준비 중입니다. 웹사이트에서 로그인해주세요.');
      }
      const { auth, authSDK } = await services();
      const provider = new authSDK.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return userView((await authSDK.signInWithPopup(auth, provider)).user);
    },
    async signOut() {
      const { auth, authSDK } = await services();
      await authSDK.signOut(auth);
    }
  });
})();
