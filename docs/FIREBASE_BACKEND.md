# Firebase 백엔드 연결과 이미지 저장 설계

## 현재 상태

- 대상: `wearquest-9a45f`, Hosting 주소: `https://wearquest-9a45f.web.app`.
- 2026-09-29 웹 앱 WearQuest Web과 서울(asia-northeast3) 기본 Firestore DB 생성 완료. 삭제 보호 활성화.
- Google Firebase Auth 공급자 활성화, Hosting 두 도메인 허용, 공개 SDK 설정 반영 완료.
- Firestore 규칙 배포 완료. 에뮬레이터에서 본인 프로필 생성/조회/갱신 허용, 타인/비로그인 조회 및 포인트 주입/잔액 변경/프로필 삭제 거부 검증.
- 인증 UI 어댑터 테스트 5개 통과. 실제 사용자 Google 동의 화면을 통한 로그인 완료와 운영 프로필 생성은 사용자 확인 필요.
- auth 배포는 최신 Firebase CLI를 임시 경로에 설치해 사용. 기존 전역 CLI 14.3.1은 auth 배포를 지원하지 않음.
- Storage는 설계 및 규칙 파일만 준비. 버킷 생성/이미지 업로드 UI/이미지 처리 서버는 미구현.
- 포인트, 게임, 체험 주문은 기존 기기 저장소 그대로이며 계정의 실제 잔액으로 이관하지 않음.

## 인증

Google OAuth 검증과 세션은 Firebase Authentication에서 처리한다. 별도 서버에 Google 비밀번호나 OAuth secret을 전달하는 구조가 아니다. 웹 팝업 로그인, 탭 단위 세션 유지, 로그아웃, 세션 복원과 오류 메시지를 구현했다. SDK가 세션을 관리하며 애플리케이션은 토큰을 직접 저장하지 않는다.

로그인 성공 시 `users/{uid}` 프로필을 트랜잭션으로 생성/갱신한다. 사용자 이름은 표시 정보이며 권한 판정에 쓰지 않는다. 이메일 등 인증 정보의 기준은 Firebase Auth다. DB 오류가 나도 이미 완료된 인증을 실패로 위장하지 않고 프로필 저장 오류를 별도로 표시한다.

카카오·네이버는 각 공급자 OAuth를 서버에서 검증하고 Firebase Custom Token을 발급하는 방식이 필요하다. Apple은 Firebase 공급자 설정과 Apple 개발자 설정이 필요하다. 현재 이 세 가지 및 이메일/아이디 가입은 활성화하지 않았다. Capacitor 네이티브 로그인은 별도 구현 대상이며 웹 팝업 경로를 사용하지 않는다.

## Firestore 구조

| 경로 | 목적 | 쓰기 주체 |
| --- | --- | --- |
| `users/{uid}` | `displayName`, `createdAt`, `updatedAt` | 본인, 허용 필드만 |
| `users/{uid}/wallet/current` | 서버 기준 포인트 잔액 | 신뢰된 서버만 |
| `users/{uid}/ledger/{eventId}` | 적립/차감, 사유, 발생일, 멱등 키 | 신뢰된 서버만 |
| `users/{uid}/orders/{orderId}` | 주문 요약, 상태, 상품 스냅샷 | 신뢰된 서버만 |
| `users/{uid}/images/{imageId}` | `storagePath`, 크기, MIME, 처리 상태 | 신뢰된 서버만 |
| `products/{productId}` | 상품명, 이미지 경로, 가격, `published` | 관리자 서버만 |

사용자 데이터 읽기는 본인만 가능하다. 상품은 `published == true`인 문서만 공개하며 목록 조회에도 동일한 필터가 필요하다. 그 외 경로는 기본 거부한다. 현재 연결 코드가 실제로 쓰는 컬렉션은 `users`뿐이다. 나머지는 후속 서버 기능을 위한 예약 구조다. Firestore 컬렉션은 첫 문서 저장 시 만들어지므로 가짜 사용자/주문으로 빈 컬렉션을 채우지 않는다.

실제 포인트 서비스에는 서버 발급 게임 세션, 완료 검증, 한국시간 날짜 기준 일일 적립 유니크 키, 원장과 잔액의 원자적 트랜잭션이 필요하다. 주문은 재고·가격·잔액을 서버에서 확인하고 주문 생성과 포인트 차감을 하나의 트랜잭션으로 처리해야 한다. 브라우저의 `state.points`나 `localStorage` 값은 증빙으로 받지 않는다.

## 이미지 Storage 구조

| 경로 | 공개 여부 | 운영 방식 |
| --- | --- | --- |
| `users/{uid}/avatar/original` | 본인 전용 | 고정 슬롯, JPEG/PNG/WebP, 최대 5MB |
| `public/products/{productId}/{fileName}` | 공개 읽기 | 서버가 검증한 상품 이미지만 게시 |

파일 바이트는 Storage에, 검색/연결용 메타데이터는 Firestore에 둔다. 비공개 파일에는 공개 다운로드 토큰 URL을 저장하지 않고 Storage 경로를 저장한다. 메타데이터는 파일 처리 성공 후 서버가 기록한다.

후속 이미지 처리 서버는 실제 디코딩으로 MIME 위조/손상 파일을 검사하고 EXIF를 제거하며 썸네일/WebP 변환을 수행한다. 현재 규칙의 MIME 검사는 파일 내용 검증을 대신하지 않는다. 이미지 개수 증가 기능을 열기 전 사용자별 업로드 제한, App Check, 정리 작업을 추가한다. 원본 삭제/변환 실패/교체 시 오래된 객체와 문서 정리도 구현해야 한다.

프로젝트에는 이미 결제가 활성화되어 있음을 읽기 조회로 확인했다. 이번 작업에서 요금제 변경이나 결제 계정 연결은 수행하지 않았다. Storage 버킷 생성과 이미지 업로드는 이번 구상 범위에서 실행하지 않았다. SDK의 storageBucket 값만으로 버킷 실재 여부를 판단하지 않는다.

## 설정 재현과 남은 확인

1. 승인 후 Firebase 웹 앱과 Firestore 기본 DB 생성. 제안 리전은 서울이며 생성 후 리전 변경 불가.
2. 웹 앱의 공개 SDK 설정을 `dist/firebase-config.js`에 반영. 서비스 계정 키나 OAuth secret은 포함 금지.
3. Firebase Authentication에서 Google 공급자를 켜고 지원 이메일 및 Hosting 도메인 허용 확인.
4. Emulator에서 보안 규칙을 검증한 뒤 `firebase deploy --only firestore:rules,firestore:indexes --project wearquest-9a45f` 실행.
5. `enabled`, `googleEnabled`를 true로 전환하고 Hosting 배포. 실제 Google 계정으로 팝업 로그인 → 프로필 생성 → 새로고침 → 로그아웃 검증.
6. 이미지 저장소가 필요할 때 버킷 생성, `storageBucket` 설정, 규칙 검증/배포와 업로드 기능 구현을 진행.

공식 참고: [Google 인증](https://firebase.google.com/docs/auth/web/google-signin), [Firestore 보안](https://firebase.google.com/docs/firestore/security/get-started), [Storage 시작](https://firebase.google.com/docs/storage/web/start).

## 로컬 검증

`npm run test:auth` 실행. Firestore 규칙은 Java 21과 Firestore emulator v1.19.8을 사용해 `127.0.0.1:8188`, 프로젝트 `demo-wearquest`, `--rules firestore.rules`로 시작한 뒤 `npm run test:rules` 실행. 규칙 테스트는 고정된 로컬 에뮬레이터에만 요청하며 운영 DB에 테스트 문서를 쓰지 않는다.
