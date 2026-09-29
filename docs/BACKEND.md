# WEAR QUEST 백엔드

Firebase Authentication을 사용하지 않는 Google OAuth + 서버 세션 구현.
현재 배포 대상: wearquest-9a45f. 리전: asia-northeast3.

## 적용 현황
- functions/src: Cloud Functions 2세대 API 구현. Google OAuth state/nonce/PKCE, Google 공식 라이브러리 ID 토큰 검증.
- Firestore: 생성 요청 권한 부족(403). 실제 DB 연동 테스트 미완료.
- 이미지 버킷: wearquest-9a45f-media 생성 완료. 서울 리전, 균일 IAM, 공개 접근 차단. 아직 이미지 업로드 없음.
- Secret Manager 등록과 Functions 배포 CLI 시도는 Failed to authenticate로 중단됨. OAuth secret 등록 미완료, 서버 배포 미완료. 서비스 계정 REST 인증은 성공했지만 CLI 인증은 실패했음.
- 브라우저 인증 설정(apiBase)은 아직 비활성. 서버 배포 및 OAuth callback 등록 후 활성화.
- 기존 게스트 포인트는 서버 잔액으로 이관하지 않음. 실제 포인트 적립/주문 서버화는 다음 작업이며 현재 API는 조회만 제공.
- 아이디/비밀번호 및 카카오/네이버/Apple은 자격증명·메일 발송 연결 전 명시적 503. 가입 성공을 가장하지 않음.
- 네이티브 앱 OAuth 복귀/App Links는 별도 작업. 현재 구현은 HTTPS 웹용.

## 컬렉션
| 경로 | 필드 / 목적 |
| --- | --- |
| users/{id} | nickname, email, status, provider, createdAt, lastLoginAt, termsAcceptedAt |
| identities/{sha256(provider:sub)} | provider, subject, userId; 이메일로 자동 계정 병합 금지 |
| sessions/{sha256(token)} | userId, csrf, expiresAt; 원본 세션 토큰 미저장 |
| oauthStates/{sha256(state)} | sessionId, nonce, verifier, expiresAt; 10분/1회 사용 |
| wallets/{userId} | balance, updatedAt; 신규 계정 0P |
| rateLimits/{hash} | count, expiresAt; 요청 제한 |
| adminRoles/{userId} | enabled, permissions 배열; media.write 권한은 운영자가 신뢰된 콘솔에서 부여 |
| media/{id} | bucket, path, category, alt, bytes, status(draft/published), createdBy, createdAt |
| auditLogs/{id} | actor, action, target, at |

다음 단계 설계: attendance/{userId_date}, pointTransactions/{id}, products/{id}, orders/{id}, inquiries/{id}, policies/{id}/versions/{version}. 게임 결과 검증·한국시간 일일 1P 한도·포인트 원장·재고 차감은 Firestore 트랜잭션으로 구현해야 함. 클라이언트가 제출한 잔액이나 완료 플래그를 신뢰하는 API는 만들지 않음.

## API
- GET /api/health: 프로세스 상태(데이터베이스 연결 확인 아님)
- GET /api/auth/session: 사용자 요약 + CSRF 토큰
- GET /api/auth/oauth/google/start, /callback
- POST /api/auth/logout: 세션 폐기
- GET /api/me/wallet: 본인 서버 잔액
- POST /api/admin/media: media.write 권한, Origin/CSRF 확인. JSON {imageBase64,category,alt}; 원본 5MB 제한, 최대 2500만 화소, sharp로 WebP 재인코딩/메타데이터 제거, 최대 2000px.
- GET /api/media/{id}: published 미디어만 서버를 통해 제공. 버킷은 계속 비공개.

업로드 카테고리는 products/banners/games. 원본 파일명과 사용자 입력 경로를 저장 경로에 사용하지 않음. 업로드 결과는 draft. 상품 관리자에서 검토 후 게시하는 기능은 아직 미구현.

## 운영 준비와 배포
1. 프로젝트 소유자가 Firebase 콘솔에서 기본 Firestore DB를 Native 모드/서울에 생성. 서버 전용이므로 웹 SDK 직접 접근 금지.
2. Cloud Functions/Cloud Build/Artifact Registry/Cloud Run/Secret Manager API 및 결제 상태 확인. 권한 부족이면 소유자 계정으로 배포하거나 배포 전용 계정에 필요한 최소 권한 부여. 이 코드가 IAM 권한을 자체 변경하지 않음.
3. Google 콘솔의 웹 OAuth 클라이언트 승인된 리디렉션 URI에 다음을 정확히 추가:
   https://wearquest-9a45f.web.app/api/auth/oauth/google/callback
   (기존 루트 URI만으로는 동작하지 않음.)
4. GOOGLE_OAUTH_JSON Secret Manager secret에 원본 web OAuth JSON을 저장. 서비스 계정 키는 소스/Functions 번들에 포함하지 않음. Functions 실행 중에는 기본 자격증명 사용.
5. 런타임 서비스 계정에 Firestore 데이터 접근과 wearquest-9a45f-media 버킷 객체 읽기/쓰기, 위 secret 읽기 권한 확인. adminRoles는 사용자 API로 변경 불가.
6. npm ci --prefix functions && npm test --prefix functions
7. firebase deploy --only functions:api,firestore --project wearquest-9a45f
8. 실제 로그인/로그아웃과 데이터 접근 검증 후 dist/auth-config.js의 apiBase를 https://wearquest-9a45f.web.app/api/auth, providers를 ['google']로 설정하고 firebase deploy --only hosting 실행.

Firestore TTL 인덱스 설정 포함. 만료는 요청마다 검사하므로 TTL 삭제 지연과 무관하게 인증 실패.
Firebase Hosting이 전달하는 __session 쿠키 사용(HttpOnly, Secure, SameSite=Lax). 동일 origin API rewrite 사용; 임의 CORS 허용 없음. 다른 도메인/관리자 URL은 별도 허용 정책을 적용한 뒤 연결해야 함.

현재 약관은 초안. 정식 서비스 전 Google 최초 가입 동의 화면, 이메일 회원가입 검증/복구, 회원 탈퇴, 계정 연동 정책을 추가해야 함. 최초 SNS 계정은 onboardingRequired=true이며 서비스 완료 가입으로 표시하지 않음.
