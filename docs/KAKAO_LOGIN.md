# 카카오 로그인 연결

## 현재 상태

2026-09-30: 서버·웹 연결 배포 완료. 구문 검사 및 인증 관련 테스트 21개 통과. 서울 리전 memberApi와 사용자 Hosting에 반영했다. 두 Hosting 도메인의 상태 API 200, 카카오 시작 경로 302, 최종 accounts.kakao.com 로그인 화면 응답 200 및 KOE 오류 미검출을 확인했다. 실제 사용자 로그인·동의 후 토큰 교환과 계정 생성은 사용자 확인이 남아 있다.

현재 저장된 시크릿은 이전에 채팅에 노출된 값과 동일하다. 이 사실을 안내한 후 사용자의 명시적 배포 요청으로 배포했다. 카카오에서 재발급 후 올바른 새 값 저장 및 함수 재배포가 필요하다. 값 자체는 소스나 문서에 기록하지 않는다.

## 구성

- 서울 리전 `memberApi`는 `/api/auth/**`에 연결된다. 관리자 API와 별도 함수이며 카카오 시크릿은 `KAKAO_CLIENT_SECRET`으로 바인딩한다. 동일 회원 함수는 네이버·Apple용 비밀 설정도 별도로 바인딩한다.
- REST API 키는 OAuth client ID로 서버에서 사용한다. 클라이언트 시크릿은 Secret Manager에서만 읽는다.
- 등록할 리다이렉트 URI: `https://wearquest-9a45f.web.app/api/auth/oauth/kakao/callback`
- 카카오 로그인 활성화 및 필요한 동의항목을 카카오 개발자 콘솔에서 설정한다. 이메일 동의가 없어도 가입할 수 있고 기본 닉네임으로 처리한다.
- 세션은 Secure/HttpOnly/SameSite=Lax 쿠키와 해시된 Firestore 문서에 보관한다. OAuth state는 해당 세션에 바인딩하고 10분 이내 한 번만 사용한다.
- 검증된 카카오 회원번호로 `identities`를 조회하며 다른 공급자 계정과 이메일만으로 자동 병합하지 않는다. 첫 로그인 때 `users`, `wallets`를 트랜잭션으로 생성한다.
- 기존 Firebase Google 로그인은 유지한다. 카카오 세션을 먼저 확인해 남아 있는 Google 세션이 화면을 덮어쓰지 않게 한다. 로그아웃은 서버 세션과 남은 Google 세션을 정리한다.
- 카카오 토큰은 사용자 정보 조회에만 사용하며 브라우저, 데이터베이스, 로그에 저장하지 않는다. 로그아웃은 서비스 로그아웃이며 카카오계정 전체 로그아웃/연결 해제가 아니다.
- 사용자 약관 동의 시점은 자동 기록하지 않는다. 게임·포인트 동기화, 네이티브 앱 내 카카오 로그인 및 자체 Google OAuth 전환은 이번 범위에 포함하지 않는다.

## 검증 및 배포

1. 카카오에서 재발급한 실제 클라이언트 시크릿을 `firebase functions:secrets:set KAKAO_CLIENT_SECRET --project wearquest-9a45f`의 입력 프롬프트에 저장한다.
2. 카카오 콘솔에서 활성화 및 위 콜백 URI를 확인한다.
3. `npm run check`, `node --test tests/auth-adapter.test.cjs functions/test/core.test.js functions/test/security.test.js`.
4. 로컬 Firestore emulator(8188, demo-wearquest) 실행 후 `npm run test:kakao`. 운영에 테스트 사용자를 생성하지 않는다.
5. `firebase deploy --only functions:admin:memberApi --project wearquest-9a45f` 후 사용자 Hosting 배포. 관리자 callback 표기 수정은 다음 관리자 함수 배포에 반영된다.
6. 실제 OAuth 인가 화면, 사용자 본인의 로그인·동의 후 계정 표시 및 로그아웃 확인. 에뮬레이터에서 카카오 응답은 테스트 더블을 사용하므로 실제 카카오 로그인 성공을 대신하지 않는다.

공식 문서: https://developers.kakao.com/docs/ko/kakaologin/rest-api
