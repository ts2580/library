# @trstyq/bookshelf

도서·권 관리, 알라딘 검색·등록, 중고 재고 조회를 제공하는 Bookshelf 웹과 백그라운드 워커입니다. Node.js 22 이상이 필요합니다. 빌드된 앱을 포함하므로 설치 후 별도로 빌드하지 않습니다.

```bash
npm install -g @trstyq/bookshelf@4.2.0
mkdir my-bookshelf
cd my-bookshelf
bookshelf
```

기본 주소는 `http://localhost:25647`입니다. `bookshelf`는 웹과 워커를 함께 실행하며 `Ctrl+C`로 둘 다 종료합니다. 최초 계정 생성 시 현재 폴더에 아래 `.env`를 작성하고 실행한 뒤 `/signup`에 접속합니다. 첫 계정이 관리자이며, 생성 후 `REGISTRATION=false`로 바꾸고 재시작합니다.

```dotenv
REGISTRATION=true
BOOKSHELF_DATA_DIR=./data
```

전역 설치 없이 실행할 수도 있습니다.

```bash
npx --yes @trstyq/bookshelf@4.2.0
```

`.env`는 명령을 실행한 폴더에서 읽습니다. 기본 DB·표지·업로드·백업은 그 폴더의 `data/`에 저장하므로 업데이트 시 보존합니다. `--data-dir`와 환경변수의 상대 경로도 실행한 폴더 기준입니다. 기존 데이터를 연결할 때는 먼저 앱을 종료하고 백업한 뒤 같은 데이터 경로를 지정합니다. DB 스키마는 시작할 때 자동으로 갱신합니다.

```bash
bookshelf --port 25649 --hostname 127.0.0.1 --data-dir ./data
bookshelf web
bookshelf worker
bookshelf db:migrate
bookshelf --version
bookshelf --help
```

웹과 워커를 따로 실행할 때는 같은 `.env`와 데이터 경로를 사용하고 DB당 워커 하나만 실행합니다. 포트는 `--port` → `PORT` → `25647`, 바인드 주소는 `--hostname` → `HOSTNAME` → `0.0.0.0` 순서로 적용합니다.

SQLite 네이티브 모듈은 설치한 운영체제·아키텍처·Node.js 버전에 맞춰 설치됩니다. 사전 빌드 바이너리가 없는 환경에는 Python 3·make·C++ 컴파일러가 필요합니다. npm 12에서는 `npm install -g --allow-scripts=better-sqlite3 @trstyq/bookshelf@4.2.0` 또는 `npx --yes --allow-scripts=better-sqlite3 @trstyq/bookshelf@4.2.0`로 SQLite 설치 스크립트를 허용합니다. 프로젝트에 설치할 때는 최상위 `package.json`의 `allowScripts`에 `"better-sqlite3": true`를 지정합니다. 다른 운영체제의 `node_modules`를 복사하지 않습니다.

알라딘은 공개 페이지를 조회하며 별도 API 키가 필요 없습니다. 요청 간격과 운영·이전 절차는 [프로젝트 README](https://github.com/ts2580/library#readme)를 참고하세요.

저장소에서는 `npm run package:npm`으로 현재 버전을 빌드·패키징하고 `npm run test:npm -- <tgz 경로>`로 별도 설치·웹·워커 실행을 검증합니다. 발행 대상은 `temp/npm/<버전>/trstyq-bookshelf-<버전>.tgz`이며 `npm publish <tgz 경로> --access public --tag latest`로 발행합니다.

릴리스 빌드는 변경 사항이 없는 커밋에서 실행합니다. 미커밋 코드 검증은 `npm run package:npm -- --local`로 빌드한 후 `temp/npm/local/<버전>/`의 tarball을 `test:npm`에 전달합니다. 로컬 패키지에는 `private: true`와 작업 트리 출처를 기록합니다. 설치 검증은 시스템 임시 디렉터리에서 실행하며 로그·스크린샷·검증 결과는 `temp/npm-verify-*/`에 남습니다.
