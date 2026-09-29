# WEAR QUEST 관리자 운영

## 주소와 현재 상태

대시보드 포인트 합계는 `pointTransactions(type ASC, createdAt ASC, delta ASC)` 복합 인덱스를 사용한다. 날짜 범위 집계의 암묵적 정렬은 ASC이므로 목록 조회용 DESC 인덱스와 구분해야 한다. 인덱스 배포 후에는 READY 상태 및 운영 대시보드의 실제 응답까지 확인한다. 에뮬레이터 테스트만으로 운영 인덱스 누락을 검증할 수 없다.

- 사용자: https://wearquest-9a45f.web.app
- 관리자: https://wearquest-admin-9a45f.web.app
- 관리자 API: Cloud Functions 2세대 `adminApi`, `asia-northeast3`, Node 22.
- 관리자 10개 메뉴와 서버 API 배포. 사용자 명시적 승인으로 최초 최고관리자 `admin` 발급 완료(2026-09-29). 임시 비밀번호는 발급 후 24시간 내 변경 필수. 공개 가입/하드코딩 운영 비밀번호 없음.
- 관리자 브라우저는 Firebase SDK를 사용하지 않으며 `/api/admin/*` 서버 API만 호출.
- 원격 저장소 `f5509a8`의 기존 자체 OAuth 소스를 `functions/src/`로 가져왔다. `src/security.js`의 해시·토큰 생성 로직을 재사용하고 `sessions`에 `scope: admin`을 추가해 관리자 세션을 구분한다. 기존 사용자 세션의 userId만으로 관리자 권한이 생기지 않는다.
- 기존 `users`, `wallets`, `media`와 서울 이미지 버킷 `wearquest-9a45f-media`를 재사용. 실제 결제 계정이나 버킷을 새로 만들지 않았다.
- 사용자 웹앱의 기존 Firebase Google 로그인은 유지. 원격의 자체 Google OAuth는 OAuth secret/redirect 및 전환 검증이 남아 있어 활성화하지 않았다. 요청한 전체 사용자 인증의 Firebase Auth 제거까지 완료된 상태는 아니다.

## 구현된 업무

| 메뉴 | 구현 내용 | 범위 / 남은 사항 |
|---|---|---|
| 대시보드 | KST 기간, 회원/출석/미션/지급 구분, 원장 집계, 주문 상태/문의 집계, 최근 로그 | 서버에 존재하는 데이터만 집계. 기기 내 체험 기록은 미포함. 출석/미션 수집 서버는 별도 작업 |
| 회원·출석 | 정확히 일치 검색, 필터/커서 페이지네이션, 상세/최근 31개 출석, 원장/주문/문의 연결, 정지 사유/로그 | 직접 Firestore 접근은 정지 시 차단. 기존 Firebase 인증 계정 자체 폐기는 하지 않음 |
| 간편로그인 | 공개 설정/순서/활성 UI, callback 복사, 서버 준비 검사 | 자체 OAuth 제공자 검증 전 활성화 거부. 기존 Firebase Google 상태와 분리. 비밀키 입력/조회 기능 없음 |
| 포인트 | 서버 원장 조회, 관리자 지급/차감, 사유·확인, 멱등키, 잔액/원장/감사로그 트랜잭션 | 일일 미션 적립 API는 미구현. 출석으로 포인트를 자동 생성하지 않음 |
| 상품 | 상품·옵션·재고·상태·이미지 순서 저장, 테스트 이미지 표기, 이미지 업로드/디코딩/WebP, 미리보기 | 기존 옵션은 삭제 대신 재고 0 사용. 이미지 삭제 API는 참조 확인. UI의 이미지 제거는 상품 연결 해제이며 파일 영구 삭제가 아님 |
| 주문·배송 | 상태 전환, 배송정보, 취소 원자적 환급/재고 복원, 배송지 변경 이력 | 기존 주문 데이터 대상으로 작동. 신규 실제 사용자 주문 생성/결제는 아직 미구현 |
| 공지·문의 | 공지 게시/숨김/고정, 문의 답변과 내부 메모 분리, 답변 이력 | 공개 공지는 사용자 사이트 연결. 사용자 문의 접수와 본인 답변 조회 UI는 자체 인증 전환 후 작업 필요 |
| 설정 | 고객센터·광고 구좌 메타데이터, 운영 변경 이력, 역할 수정/회수, 본인 권한 변경 금지, 마지막 최고관리자 보호 | 신규 계정은 운영자 CLI. 일일1P/주문일+30일 정책은 조회 및 고정값으로 유지. 광고 SDK는 미연결 |
| 약관·정책 | 4종 정책, 버전 유니크, 초안/게시, 시행일, 검토 확인, 게시 버전 불변 | 사용자 사이트는 시행일이 도래한 게시 버전 표시. 법률 검토 자체를 대신하지 않음 |
| 로그 | 작업자/유형/결과/기간 조회, 요청 ID, 변경과 같은 DB 트랜잭션 기록 | 원장·감사로그의 수정/삭제 API 없음. 전체 배송지는 제한된 주문 이력에만 저장 |

## 계정·세션·권한

관리자 자체 비밀번호는 임의 salt + Node scrypt 해시만 저장한다. `sessions/{sha256(token)}`에 `scope:admin`, adminId, authVersion, CSRF, 만료시각을 기록한다. 인증 쿠키는 Firebase Hosting이 전달하는 `__session`: HttpOnly, Secure, SameSite=Strict, host-only, 최대 8시간. 최초 비밀번호는 24시간 만료 및 변경 필수. 비밀번호 변경/관리자 권한 변경 시 authVersion을 올려 기존 세션을 회수한다.

관리자/사용자 도메인은 서로 host-only 쿠키를 공유하지 않는다. 관리자 API는 관리자 두 Hosting 도메인만 Origin 허용. 변경 요청에는 정확한 Origin과 CSRF를 모두 요구한다. 사용자 공개 API는 사용자 도메인만 CORS 허용하며 개인정보를 제공하지 않는다. 와일드카드 CORS 없음.

- 최고관리자: 전체 관리자 업무.
- 상품·배송: 조회, 주문 개인정보, 상품/이미지, 배송 관리.
- 고객지원: 조회, 회원 개인정보, 회원 상태, 공지/문의.
- 조회 전용: 읽기. 회원 이메일 마스킹 및 주문 상세 개인정보 차단.

최초 계정 발급은 **사용자 승인 후** 현재 Firebase CLI에 인증된 프로젝트 운영자의 IAM으로 실행한다:

```sh
node scripts/bootstrap-admin.cjs --username kkh9172 --name '운영 관리자' --out /private/tmp/wearquest-admin-initial.txt
```

스크립트는 기존 계정이 있으면 덮어쓰지 않는다. 임시 비밀번호는 소유자 전용 0600 파일에만 저장하며 소스·로그에 출력하지 않는다. 별도 승인된 추가 계정 발급은 `--additional true --role viewer`처럼 역할을 명시한다. 이 CLI는 Hosting/Functions 번들에 포함되지 않는다. 계정 복구·비밀번호 재발급 자동화는 후속 운영 절차가 필요하다.

## 데이터 계약

- `users`: nickname(기존 자체 인증), displayName(기존 Firebase 사용자 호환), email, provider, status, createdAt.
- `wallets/{uid}`: 서버 잔액의 기준. 기존 기기 내 값이나 `users/{uid}/wallet`을 자동 이관하지 않는다.
- `pointTransactions`: 수정 불가 거래 원장. 사용자별 ledger 하위 컬렉션에도 동일 거래 기록.
- `orders`: 구매 당시 items 스냅샷과 shipping, totalPoints, 상태/일시. `addressHistory` 하위 컬렉션의 전후 배송지는 로그 목록에서 제외.
- `media`: 기존 버킷과 products/banners/games 경로. 파일 크기, MIME, 상태, productIds 참조. 실제 이미지 내용 검사, 최대 4천만 화소/8MB 입력, 1800px WebP 최적화. 브라우저 입력 경로는 받지 않는다.
- `admins`, `adminConfig`, `adminRequests`, `adminAudit`: 서버 전용. 기존 사용자 세션과 관리자 세션은 동일 `sessions` 컬렉션에서 scope로 분리.
- 회원 목록은 createdAt이 있는 문서 기준. 과거 문서에 없으면 명시적 데이터 마이그레이션 필요.
- 최대 25개 커서 페이지네이션. 검색은 정확히 일치만 지원. 브라우저에서 전체 데이터 로딩하지 않음.

## 검증

- Node 구문 검사: 사용자 앱, 관리자 앱, 관리자 서버.
- 기존 사용자 인증 어댑터: 5개.
- 관리자 순수 업무 규칙: 5개.
- Firestore emulator 통합: 7개 (비로그인/일반회원/역할/Origin/CSRF, 동시 중복 포인트, 주문 취소 환급·재고, 정책 불변/중복 버전, 제공자 준비/자기 권한 변경, 세션 회수, 위장 이미지/잘못된 경로).
- 관리자 로그인과 대시보드 실제 Chrome 로컬 확인. 로컬은 `demo-wearquest` 에뮬레이터만 사용하며 운영 계정/샘플 데이터 생성 안 함.
- 운영 `admin` 로그인 성공(200), 최초 비밀번호 변경 전 업무 접근 차단(403 PASSWORD_CHANGE_REQUIRED), 검증 세션 로그아웃(200) 확인. 로그인 화면은 390px 브라우저 모바일 에뮬레이션에서 확인했으며, 실기기 검증은 미실시.

```sh
npm run check
npm run test:auth
npm run test:admin
# Firestore emulator 127.0.0.1:8188 / project demo-wearquest 실행 후
npm run test:admin:integration
npm run test:rules
```

## 배포

최신 Firebase CLI 사용. 사용자/관리자는 `firebase.json`의 독립 Hosting site로 분리된다. Functions codebase는 admin이며 기존 미배포 `src/index.js`는 OAuth secret 없이 자동 배포하지 않는다.

```sh
firebase deploy --only functions:admin,firestore,hosting --project wearquest-9a45f
```

Functions와 Hosting 실제 배포 성공 여부는 명령 전체 종료 코드뿐 아니라 함수 상태와 HTTP 응답을 확인해야 한다. 최초 배포에서 함수는 성공했지만 아티팩트 정리 정책 미설정으로 CLI가 오류 종료했다. 자동 영구 삭제 정책은 승인 검토에서 거절되어 적용하지 않았으며 기존 보관 상태를 유지한다.
