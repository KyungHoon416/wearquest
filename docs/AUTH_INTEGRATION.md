# WEAR QUEST 인증 연결

## 아이디 회원가입 연결 (2026-09-30)

`memberApi`의 `/api/auth/register`, `/login`, `/session`, `/logout`에 아이디 회원가입과 자체 세션 인증을 구현했다. 가입 시 `users`, `wallets`(0P), `memberIdentifiers`(아이디·이메일 중복 잠금), `memberCredentials`(scrypt 해시), `sessions`를 한 트랜잭션으로 저장한다. 회원가입 성공 후 자동 로그인한다. 아이디와 이메일은 소문자로 정규화하며, 비밀번호는 프로필이나 응답에 포함하지 않는다. 회원 문서에 공급자 `password`가 저장돼 관리자 회원 목록에서 확인할 수 있다.

이메일은 `emailVerified: false`이며 이메일 인증·비밀번호 재설정·탈퇴는 아직 미구현이다. 미인증 이메일을 근거로 소셜 계정에 연결하거나 비밀번호를 재설정하지 않는다. 이용약관 및 개인정보 동의 시각을 저장하지만 현재 사용자 사이트 정책 문구는 별도 확정이 필요하다.

검증: 로컬 회원 API 7개, 프런트 인증 9개, 기존 보안·업무 규칙 9개 테스트 통과. 운영 DB에는 검증용 회원을 생성하지 않는다.

## Firebase 연결 추가 (2026-09-29)

Google 로그인용 Firebase Auth 어댑터와 Firestore 프로필 저장 코드를 추가했습니다. 웹 앱/서울 Firestore DB 생성, 규칙 배포, Google 공급자 활성화와 공개 설정 반영을 완료했습니다. 실제 사용자 로그인 완료는 확인이 필요합니다. 최신 연결 절차와 이미지 설계는 [Firebase 백엔드 문서](FIREBASE_BACKEND.md)를 참조하세요. 아래 HTTPS API 계약은 기존 어댑터/다른 공급자를 위한 참고이며 Firebase Google 로그인은 해당 API를 사용하지 않습니다.

## 현재 구현 상태
- 첫 로그인 화면: 구글 / 카카오 / 네이버 / Apple / 기타 로그인 선택.
- 기타 로그인: 아이디 또는 이메일 + 비밀번호, 비밀번호 표시 전환 및 회원가입 링크.
- 회원가입: 아이디 / 이메일 / 닉네임 / 비밀번호 / 비밀번호 확인 / 약관 확인.
- Google, Kakao, Naver, Apple 및 추가 공급자 확장 UI.
- 입력 검증, 전송 중 중복 방지, 오류 및 완료 메시지, 세션 조회와 로그아웃 연결 코드.
- `dist/auth-config.js`의 `apiBase`는 `/api/auth`. 아이디·카카오·네이버는 자체 회원 API, Google은 Firebase 어댑터로 인증한다. Apple은 아직 미연결이다.
- 앱이 비밀번호나 인증 토큰을 직접 저장하지 않는다. Firebase SDK는 Google 세션을 탭 단위로 관리한다. 아이디 가입 비밀번호는 HTTPS 서버로 전송해 해시 처리한다.
- 게임·포인트 localStorage는 게스트 체험 기록이며 인증 계정이나 서버 원장과 연동하지 않았다.

## 연결 전에 필요한 결정
사용할 인증 서버/Firebase 프로젝트와 운영 도메인을 확정한다. Sites의 ChatGPT 로그인을 일반 회원 계정으로 대체 사용하지 않는다. 공개 계정 인증은 외부 서버가 책임진다. 인증 서버는 `functions/member-app.js`에 있으며 OAuth secret은 Secret Manager에만 저장한다.

## 프런트엔드가 기대하는 HTTPS API
모든 응답은 JSON. 브라우저 요청은 credentials: include. 세션 쿠키는 HttpOnly, Secure이고 서버는 CSRF 및 Origin을 검증해야 한다. 크로스 오리진에서는 허용된 정확한 프런트엔드 origin만 CORS 허용하고 적합한 SameSite 정책을 적용한다. API를 별도 사이트에 두면 브라우저의 제3자 쿠키 제한도 검토해야 하므로 가능하면 동일 사이트 도메인 구조를 사용한다.

| 경로 | 동작 |
| --- | --- |
| GET /session | `{ "user": null, "csrfToken": "..." }` 또는 인증된 user `{id, username, nickname, email}`. 익명 세션에도 CSRF 제공. Cache-Control: no-store. |
| POST /register | `{username,email,nickname,password,termsAccepted,privacyAccepted}`. 서버 검증 및 비밀번호 해싱, 프로필·지갑·세션 원자 저장 후 201. UI는 자동 로그인 후 계정 화면 표시. 이메일 인증 메일은 미구현. |
| POST /login | `{identifier,password}`. 세션 고정 방지를 위해 쿠키 회전 후 2xx. 이후 /session으로 로그인 검증. |
| POST /logout | 서버 세션 폐기 + 쿠키 만료 후 2xx. |
| GET /oauth/{provider}/start | 서버가 provider별 OAuth 시작. state/nonce/PKCE 및 고정 허용 callback 검증. 로그인 성공 시 세션을 설정하고 등록된 앱 주소 #account로 복귀. 이메일 인증 없는 계정 자동 병합 금지. |

POST 요청에 X-CSRF-Token 사용. 서버는 클라이언트 검증에 의존하지 말고 아이디/이메일 중복, 정규화, 비밀번호 정책, 동의 문서 버전, 요청 제한 및 인증 오류 메시지를 처리한다. 프런트에서 인식하는 오류 코드: INVALID_CREDENTIALS, USERNAME_TAKEN, EMAIL_TAKEN, RATE_LIMITED, EMAIL_NOT_VERIFIED.

비밀번호는 서버에서 검증된 인증 서비스 또는 적절한 비밀번호 해싱 라이브러리로 처리한다. 비밀번호를 직접 저장하는 브라우저 데모 구현은 하지 않는다. 후속 작업: 실제 약관·개인정보 처리방침 확정, 이메일 인증 및 계정 복구/탈퇴 기능.

## SNS 설정
각 제공자 개발자 콘솔에서 앱 생성, client ID, secret/서명키 및 승인된 callback 설정이 필요하다. secret과 Apple private key는 서버의 비밀 설정에만 보관한다. Google/Kakao/Naver/Apple 버튼은 설정된 인증 서버로 이동한다. 자체 OAuth callback 또는 토큰 검증은 현재 클라이언트에 구현하지 않는다.

추가 공급자는 auth-config.js의 additionalProviders에 `{id:'provider-id',label:'서비스명'}`을 추가하고 서버에도 동일한 공급자를 등록한다. 기타 로그인 버튼은 아이디·비밀번호 화면으로 이동한다. 추가 공급자는 별도 UI 확장이 필요하다.

## 하이브리드 앱
현재 어댑터는 웹 브라우저 세션 계약이다. 스토어 앱 실제 인증에는 iOS/Android용 공급자 등록, 외부 브라우저 기반 OAuth, Universal Links/App Links 콜백, 네이티브 세션 복귀를 별도로 구현해야 한다. WebView에서 SNS 로그인이 완료된다고 가정하면 안 된다. Capacitor 기본 WebView/정적 파일은 서버 쿠키 인증과 별도 검증이 필요하다.

## 네이버 로그인 (2026-09-30)

`NAVER_CLIENT_SECRET`은 Secret Manager에서 회원 함수에만 바인딩한다. 콜백은 `https://wearquest-9a45f.web.app/api/auth/oauth/naver/callback`이다. 네이버 인증 후 공급자별 회원번호로 `identities`를 조회하며 첫 로그인 때 회원 프로필과 0P 지갑을 생성한다. 이메일·닉네임 제공에 동의하지 않아도 기본 프로필로 가입 가능하다. 이메일로 다른 공급자 계정을 자동 병합하지 않는다. 네이버 검수 상태와 콜백 등록은 네이버 개발자센터에서 관리한다. 실제 사용자 로그인 완료 전에는 토큰 교환까지 검증 완료로 간주하지 않는다.


## Apple 웹 로그인 (2026-09-30)

Services ID는 com.wearquest.wear, Team ID는 R848ZS47Z6, Key ID는 98A6S8N55L이다. 비밀키는 Secret Manager APPLE_PRIVATE_KEY에만 저장한다. 웹 반환 URL은 https://wearquest-9a45f.web.app/api/auth/oauth/apple/callback 이다.

서버는 ES256 client secret을 생성하고 Apple의 토큰 응답을 공식 JWKS로 검증한다. issuer, audience, expiry, nonce와 일회용 browser-bound state를 검사한다. form_post를 위해 로그인 시작 시 익명 __session 쿠키를 Secure/HttpOnly/SameSite=None으로 발급하고 로그인 성공 후 새 Lax 세션으로 교체한다. Apple 콜백만 일반 CSRF 헤더 검사의 예외이며 세션과 state 검증은 필수다.

Apple subject 기준으로 users, identities, wallets를 생성한다. 이메일로 기존 계정을 자동 병합하지 않는다. email 범위만 요청하므로 최초 닉네임은 Apple 회원이고 이름 정보는 요청하지 않는다. 사용자 실제 Apple 계정의 로그인/동의는 배포 후 별도 확인이 필요하다. 서버 알림 수신과 Apple 토큰 폐기/계정 삭제는 이 변경에 포함되지 않는다.

배포 확인: memberApi 및 사용자 Hosting 배포 완료. 운영 health 200, Apple start 302와 Secure/HttpOnly/SameSite=None 확인, 잘못된 콜백 거부 확인. 반환 URL 수정 후 Apple 인증 페이지 HTTP 200 및 설정 오류 해소를 확인했다. 운영 DB 확인 당시 Apple 회원은 0명이었으며 실제 계정 로그인 후 저장은 아직 검증하지 못했다. Functions CLI는 배포 성공 이후 기존 Artifact Registry cleanup policy 미설정으로 exit 1을 반환했으며 자동 삭제 정책은 변경하지 않았다.
