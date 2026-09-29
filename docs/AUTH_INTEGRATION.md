# WEAR QUEST 인증 연결

## Firebase 연결 추가 (2026-09-29)

Google 로그인용 Firebase Auth 어댑터와 Firestore 프로필 저장 코드를 추가했습니다. 웹 앱/서울 Firestore DB 생성, 규칙 배포, Google 공급자 활성화와 공개 설정 반영을 완료했습니다. 실제 사용자 로그인 완료는 확인이 필요합니다. 최신 연결 절차와 이미지 설계는 [Firebase 백엔드 문서](FIREBASE_BACKEND.md)를 참조하세요. 아래 HTTPS API 계약은 기존 어댑터/다른 공급자를 위한 참고이며 Firebase Google 로그인은 해당 API를 사용하지 않습니다.

## 현재 구현 상태
- 첫 로그인 화면: 구글 / 카카오 / 네이버 / Apple / 기타 로그인 선택.
- 기타 로그인: 아이디 또는 이메일 + 비밀번호, 비밀번호 표시 전환 및 회원가입 링크.
- 회원가입: 아이디 / 이메일 / 닉네임 / 비밀번호 / 비밀번호 확인 / 약관 확인.
- Google, Kakao, Naver, Apple 및 추가 공급자 확장 UI.
- 입력 검증, 전송 중 중복 방지, 오류 및 완료 메시지, 세션 조회와 로그아웃 연결 코드.
- `dist/auth-config.js`의 `apiBase`는 비어 있다. Google은 별도의 Firebase 어댑터로 실제 인증하며, 아이디 가입/다른 공급자는 아직 미연결이다.
- 앱이 비밀번호나 인증 토큰을 직접 저장하지 않는다. Firebase SDK는 Google 세션을 탭 단위로 관리한다. 미연결 아이디 가입은 전송하지 않는다.
- 게임·포인트 localStorage는 게스트 체험 기록이며 인증 계정이나 서버 원장과 연동하지 않았다.

## 연결 전에 필요한 결정
사용할 인증 서버/Firebase 프로젝트와 운영 도메인을 확정한다. Sites의 ChatGPT 로그인을 일반 회원 계정으로 대체 사용하지 않는다. 공개 계정 인증은 외부 서버가 책임진다. 이 저장소에는 인증 서버나 OAuth secret이 포함되어 있지 않다.

## 프런트엔드가 기대하는 HTTPS API
모든 응답은 JSON. 브라우저 요청은 credentials: include. 세션 쿠키는 HttpOnly, Secure이고 서버는 CSRF 및 Origin을 검증해야 한다. 크로스 오리진에서는 허용된 정확한 프런트엔드 origin만 CORS 허용하고 적합한 SameSite 정책을 적용한다. API를 별도 사이트에 두면 브라우저의 제3자 쿠키 제한도 검토해야 하므로 가능하면 동일 사이트 도메인 구조를 사용한다.

| 경로 | 동작 |
| --- | --- |
| GET /session | `{ "user": null, "csrfToken": "..." }` 또는 인증된 user `{id, username, nickname, email}`. 익명 세션에도 CSRF 제공. Cache-Control: no-store. |
| POST /register | `{username,email,nickname,password,termsAccepted,privacyAccepted}`. 서버 검증 및 비밀번호 해싱, 이메일 인증 메일 전송 후 2xx. UI는 이메일 인증 후 로그인 안내. |
| POST /login | `{identifier,password}`. 세션 고정 방지를 위해 쿠키 회전 후 2xx. 이후 /session으로 로그인 검증. |
| POST /logout | 서버 세션 폐기 + 쿠키 만료 후 2xx. |
| GET /oauth/{provider}/start | 서버가 provider별 OAuth 시작. state/nonce/PKCE 및 고정 허용 callback 검증. 로그인 성공 시 세션을 설정하고 등록된 앱 주소 #account로 복귀. 이메일 인증 없는 계정 자동 병합 금지. |

POST 요청에 X-CSRF-Token 사용. 서버는 클라이언트 검증에 의존하지 말고 아이디/이메일 중복, 정규화, 비밀번호 정책, 동의 문서 버전, 요청 제한 및 인증 오류 메시지를 처리한다. 프런트에서 인식하는 오류 코드: INVALID_CREDENTIALS, USERNAME_TAKEN, EMAIL_TAKEN, RATE_LIMITED, EMAIL_NOT_VERIFIED.

비밀번호는 서버에서 검증된 인증 서비스 또는 적절한 비밀번호 해싱 라이브러리로 처리한다. 비밀번호를 직접 저장하는 브라우저 데모 구현은 하지 않는다. 회원가입 완료를 활성화하기 전에 실제 약관과 개인정보 처리방침, 이메일 인증 및 계정 복구/탈퇴 정책을 확정한다.

## SNS 설정
각 제공자 개발자 콘솔에서 앱 생성, client ID, secret/서명키 및 승인된 callback 설정이 필요하다. secret과 Apple private key는 서버의 비밀 설정에만 보관한다. Google/Kakao/Naver/Apple 버튼은 설정된 인증 서버로 이동한다. 자체 OAuth callback 또는 토큰 검증은 현재 클라이언트에 구현하지 않는다.

추가 공급자는 auth-config.js의 additionalProviders에 `{id:'provider-id',label:'서비스명'}`을 추가하고 서버에도 동일한 공급자를 등록한다. 기타 로그인 버튼은 아이디·비밀번호 화면으로 이동한다. 추가 공급자는 별도 UI 확장이 필요하다.

## 하이브리드 앱
현재 어댑터는 웹 브라우저 세션 계약이다. 스토어 앱 실제 인증에는 iOS/Android용 공급자 등록, 외부 브라우저 기반 OAuth, Universal Links/App Links 콜백, 네이티브 세션 복귀를 별도로 구현해야 한다. WebView에서 SNS 로그인이 완료된다고 가정하면 안 된다. Capacitor 기본 WebView/정적 파일은 서버 쿠키 인증과 별도 검증이 필요하다.
