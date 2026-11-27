# Bookshelf 4.3.0-rc.1

알라딘 재고 조회용 전용 브라우저를 Firefox로 전환합니다. Linux 개발 환경에서는 프로젝트 폴더에서 `npm run dev:aladin`으로 웹, 워커, Firefox, noVNC를 함께 실행할 수 있습니다.

## 접속 설정

- `.env`의 `ALADIN_BROWSER_OWNER`에 Bookshelf 사용자명을 지정하고 `ALADIN_BROWSER_VNC_PASSWORD`에 noVNC 접속 암호를 지정합니다.
- 리버스 프록시를 이용하면 `ALADIN_BROWSER_PUBLIC_URL`에 공개 도메인을 지정합니다. 앱이 HTTPS의 `/aladin-browser/` 경로와 WebSocket 주소를 구성합니다. 기본 호스트 바인딩은 `127.0.0.1:7900`이며 `ALADIN_BROWSER_BIND_IP`와 `ALADIN_BROWSER_VNC_PORT`로 변경할 수 있습니다.
- 프로필에서 연결 상태를 표시하거나 브라우저를 열 때 실제 창을 확인합니다. 세션이 만료된 경우 **전용 브라우저 연결**로 새 창을 열 수 있습니다. 처음 열리는 창은 원격 화면 크기에 맞춰지며 noVNC는 접속 기기의 화면에 맞게 표시합니다.

## 4.2.0에서 업데이트

DB 스키마는 12입니다. Docker 사용자는 RC 이미지가 발행된 뒤 웹과 워커를 같은 버전으로 올리고, 전용 브라우저를 사용하면 이 버전의 `docker-compose.aladin.yml`을 함께 적용합니다. 프로필에서 Firefox에 다시 연결해 알라딘에 로그인합니다. 로컬 설치에 필요한 패키지와 실행 명령은 [README](../README.md#로컬-실행)에 있습니다.

## 알려진 제한

개발 LXC에서 Firefox 창 연결과 알라딘 공개 상품 조회를 확인했습니다. 같은 LXC의 일반 Firefox에서도 계정 로그인 실패가 재현됐습니다. 접속 경로가 원인인지는 확인되지 않았으며, 이 RC에서 해당 환경의 인증 재고 조회는 미검증 상태입니다.
