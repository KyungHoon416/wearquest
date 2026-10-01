'use strict';
const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const {getFirestore} = require('firebase-admin/firestore');
const {createMemberApp} = require('./member-app');
const kakaoSecret = defineSecret('KAKAO_CLIENT_SECRET');
const naverSecret = defineSecret('NAVER_CLIENT_SECRET');
const applePrivateKey = defineSecret('APPLE_PRIVATE_KEY');
exports.memberApi = onRequest({region: 'asia-northeast3', secrets: [kakaoSecret, naverSecret, applePrivateKey], memory: '256MiB', maxInstances: 3, concurrency: 20, timeoutSeconds: 60, invoker: 'public'}, createMemberApp({db: getFirestore(), getSecret: () => kakaoSecret.value(), getNaverSecret: () => naverSecret.value(), getApplePrivateKey: () => applePrivateKey.value()}));
