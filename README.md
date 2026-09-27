# Wear Quest

패션 퀘스트 하이브리드 웹앱 체험 버전. 정적 웹 자산을 Capacitor iOS / Android 네이티브 컨테이너에 번들합니다.

## 포함 기능
- 고정 상단 포인트, 고정 하단 홈 / 게임하기 / 포인트몰 / 마이페이지
- 웹 콘텐츠 상단 광고 예약 구좌 (광고 SDK 미연결)
- 패션 게임 20개: 6가지 플레이 유형과 게임별 콘텐츠
- 한국시간 자정 기준 일일 퀘스트: 게임 3회 및 서로 다른 게임 2종 완료
- 일일 보상 최대 1P, 참여 30일이면 30P. 미참여일 자동 적립 없음
- 30P 체험 상품 교환, 포인트 차감, 신청일 +30일 수령 예정일 표시
- 로컬 기록 보존. 게스트 체험용이며 계정 간/기기 간 동기화 없음

## 웹
`dist/index.html`, `dist/style.css`, `dist/app.js`는 빌드가 필요 없는 웹 자산입니다.
`npm run check`로 JavaScript 구문 검사.

## 네이티브 앱
Capacitor 공식 문서: https://capacitorjs.com/docs

1. `npm ci`
2. `capacitor.config.json`의 `com.example.wearquest`를 본인 소유 Bundle ID로 변경하고 네이티브 프로젝트의 identifier도 일치시킵니다.
3. `npx cap sync`
4. macOS / Xcode: `npx cap open ios`
5. Android Studio: `npx cap open android`
6. 서명과 스토어 메타데이터를 설정한 후 디바이스 테스트 및 배포 빌드를 진행합니다.

웹 자산은 앱 안에 포함됩니다. production server.url을 지정하지 않습니다.
안전 영역은 CSS env(safe-area-inset-*)로 적용합니다. 하단 메뉴는 WebView 내부의 고정 웹 메뉴이며 UIKit/Compose 네이티브 탭바는 아닙니다.

## 출시 전 필수 연결
현재 실제 서비스용 백엔드는 미연결입니다. localStorage는 변조 가능하므로 현금성 보상 원장으로 사용할 수 없습니다.
- Firebase Auth 등 계정 인증
- 서버의 Asia/Seoul 날짜 및 인증 UID로 일일 보상 유니크 제약, 트랜잭션 적립과 중복 요청 방지
- 서버 검증 게임 세션 / 퀘스트 및 부정 적립 방지
- 주문, 재고, 사이즈, 배송 주소, 포인트 차감 및 주문 생성의 원자적 처리
- 실제 상품 공급 및 배송 처리. 수령 예정일과 실제 수령을 구분
- 웹 광고와 네이티브 광고 SDK를 배포 채널별로 연결. 현재 광고 요청 없음
- 개인정보 처리 및 스토어 제출 정보, 앱 서명, 실기기 QA

현 버전은 포인트를 0P부터 시작합니다. 가짜 적립이나 날짜 건너뛰기 버튼은 없습니다. 체험 교환도 실제 상품을 발송하지 않습니다.

## 이미지
Photo by Philippe Wehrli on Unsplash.
https://unsplash.com/photos/a-pair-of-jeans-a-jacket-and-a-pair-of-sneakers-are-laid-out-j2Abvzsq8z4

## 쇼핑 UI 업데이트
블랙 배경과 화이트 액션, 패션 이미지가 있는 게임 카드로 변경.
장바구니 / 상품 옵션 / 배송지 입력 / 포인트 주문 흐름 추가.
배송지 입력은 체험 목적이며 저장·전송하지 않습니다. 주문의 상품/옵션/금액 정보만 기존 로컬 저장소에 기록합니다.
추가 샘플 사진: Mediamodifier https://unsplash.com/photos/TvL5vIgwiwo , Eduardo Pastor https://unsplash.com/photos/3oejsU5OQVk , Bence Balla-Schottner https://unsplash.com/photos/knLtXELIHIM
