# 이음 (Ieum)

여러 장의 사진을 가로 또는 세로로 이어 하나의 JPG/PNG 이미지로 만드는 브라우저 기반 사진 편집 도구입니다. 사진 순서 변경, 비율·간격 설정, 개별 사진 조정, 미리보기 및 이미지 저장을 지원합니다.

- 공개판: https://photodonga.github.io/ieum/
- 개발팀 인수인계: [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md)
- 코드 구조와 리팩터링 범위: [docs/REFACTORING_MAP.md](docs/REFACTORING_MAP.md)

## 로컬 실행

별도 앱 빌드 없이 정적 HTTP 서버로 실행합니다. ES 모듈을 사용하므로 `index.html`을 `file://` 주소로 직접 열면 안 됩니다.

```sh
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000/ 을 엽니다. Python이 없다면 다른 정적 HTTP 서버를 사용해도 됩니다.

## 개발 환경 및 테스트

Node.js 22 기준입니다. `package-lock.json`에 고정된 의존성을 `npm ci`로 설치합니다.

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test`는 ESLint, Node 단위 테스트, Playwright Chromium 스모크·다운로드 검증을 실행합니다. Linux 환경에서는 Playwright 브라우저 시스템 의존성 설치가 추가로 필요할 수 있습니다.

CMS API·인증·저장·송고 연동은 구현되어 있지 않습니다. 통합 검토 범위와 출력물 EXIF/IPTC 주의사항은 인수인계 문서를 참고하세요.

Copyright by 송은석. All Rights Reserved.
