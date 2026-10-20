# 이음(Ieum) — 개발팀 인수인계 안내

## 목적
이음은 여러 장의 사진을 가로 또는 세로로 이어 하나의 JPG/PNG 이미지로 만드는 브라우저 기반 편집 도구입니다. 이 문서는 CMS 개발팀 전달 직전 단계의 독립 실행판과 기술 검토 사항을 설명합니다. **CMS 내부 구조, 인증 방식, 저장 API는 아직 확인되지 않았습니다.**

## 현재 구현
- 사진 여러 장 추가, 순서 변경, 삭제, 교체, 실행 취소/재실행
- 가로/세로 합성, 비율 및 간격, 크롭·회전·기울기·선명도 등 편집
- 미리보기 저해상도 렌더링과 최종 원본 해상도 출력 분리
- JPG/PNG 저장, PC·모바일 인터페이스, 시스템 다크모드 대응
- 브라우저 내 처리; 출력물에는 EXIF/IPTC 정보가 포함되지 않음

## 실행 및 개발팀 검토 브랜치
- 공개 URL: https://photodonga.github.io/ieum/ (리팩터링 버전을 `main`에 병합한 정식판)
- 리팩터링 작업 이력 보관 브랜치: `refactor/cms-handoff-20261017` (현재 정식판과 분리된 개발 이력)
- 진입점: `index.html`; 스타일: `styles/app.css`; 앱 제어: `src/app.js`
- 이미지 계산: `src/composite-geometry.js`, `src/crop-geometry.js`, `src/transform-math.js`
- 원근 보정: `src/perspective-renderer.js`; 사진 이력 상태: `src/photo-state.js`
- 출력 어댑터: `src/canvas-encoder.js`, `src/browser-download.js`
- 테스트: Node.js 22 환경에서 `npm ci` 후 `npx playwright install chromium`, 이어서 `npm test`. `package-lock.json`으로 설치 버전을 고정합니다.
- 테스트 구성: ESLint → Node 단위 테스트 → Chromium Playwright 스모크/다운로드 검증
- ES 모듈을 사용하므로 `file://`로 열지 말고 HTTP 정적 서버를 사용해야 합니다.
- CI 워크플로: `.github/workflows/test.yml`; 현재 `.baseline`은 `main`을 체크아웃합니다. 브랜치·PR에서는 현재 `main` 대비 픽셀을 비교하지만, `main`에 직접 푸시한 경우에는 자기 자신과 비교하므로 회귀 검증으로서 의미가 없습니다. `.baseline`을 고정된 기준 커밋/태그로 변경하는 작업은 후속 과제입니다.
- 상세 의존성 및 리팩터링 범위: `docs/REFACTORING_MAP.md`

## 현재 모듈화의 경계
**모듈화가 완료됐다는 의미는 아닙니다.** UI, 이미지 파일 저장소, 캔버스 합성 흐름, 사진 편집 상태의 상당 부분은 여전히 `src/app.js`에서 함께 관리합니다. 분리된 모듈은 기존 계산 및 플랫폼 호출의 일부입니다. CMS API 호출, 권한 검사, 메타데이터 보존, 송고 처리는 구현되지 않았습니다.

### 향후 분리 과제 (이번 정리 작업에서는 미수정)
- `src/app.js`는 약 95KB 규모로 UI 이벤트 처리, 사진 편집 상태, 캔버스 렌더링·저장 흐름이 집중되어 있습니다.
- 향후 CMS 통합 또는 기능 확장 시 UI 이벤트/상태 관리/합성 오케스트레이션의 단계적 분리를 검토합니다.
- **이번 저장소 정리에서는 `src/app.js` 및 동작 코드를 수정하지 않습니다.** 기존 UI·기능·출력 픽셀 결과를 유지하며, 분리 작업은 별도 변경과 회귀 검증으로 진행해야 합니다.

## CMS 통합 검토
권장 순서:
1. CMS의 이미지 선택·권한·저장·송고·메타데이터 정책을 확인
2. 이음의 이미지 합성 코어를 UI와 분리하는 기술 검토
3. 입력 계약(Blob/File 또는 CMS 제공 이미지), 출력 계약(Blob, MIME, 픽셀 크기, 파일명, 오류)을 합의
4. 인증 및 저장은 CMS에서 담당하고 이음은 편집/합성에 집중하도록 경계 설정
5. 기존 독립 실행판을 회귀 테스트 기준으로 유지

**주의:** 현재 이음에 CMS API 연결이 구현되어 있다는 뜻이 아닙니다. 아래는 통합 제안이지 현재 지원 API가 아닙니다.

### 제안 인터페이스 (미구현)
```ts
type ComposeInput = {
  images: Blob[];
  direction: 'horizontal' | 'vertical';
  format: 'image/jpeg' | 'image/png';
  // 비율, 간격, 개별 사진 편집 상태는 현행 UI 의미와 일치하도록 별도 명세
};
type ComposeResult = {
  blob: Blob;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
};
```

## 최종 자동 검증 결과 (2026-10-17)
- **최종 검증: 성공.** 커밋 `f6f9667bcda8931dd8b17320fa9ce6fc1bdd0ba0`, GitHub Actions [실행 39011479037](https://github.com/photodonga/ieum/actions/runs/39011479037) 및 [실행 39011477159](https://github.com/photodonga/ieum/actions/runs/39011477159) 모두 성공. 이 결과는 자동화된 검증에 한정되며 실사용 전체 환경이나 CMS 호환을 보증하지 않습니다.
- **전달 범위:** 공개 `main`에 병합된 독립 실행 정적 웹앱 및 소스, 테스트, 인계 문서. CMS API 연결과 실제 송고 연동은 미수행.
- **정식판 병합 후 CI 성공:** `aa8d9cf1ba0aad494c30b89de7fdce25f3c9ef0d` — [테스트](https://github.com/photodonga/ieum/actions/runs/39011784039), [추가 워크플로](https://github.com/photodonga/ieum/actions/runs/39011783764).

## 확인된 테스트 범위 (2026-10-17)
- Chromium PC·모바일 스모크 테스트: 사진 추가 순서, 미리보기, 선택, 삭제·실행 취소, 편집, 다운로드, 오류 감지.
- 원본 `main`과 비교하는 캔버스 크기·전체 픽셀 해시 검증: 가로 기본 합성, 회전·수직/수평 원근 보정, 세로 합성, 세로 합성에서 출력 1600px·간격 없음 설정. **[최종 CI 통과](https://github.com/photodonga/ieum/actions/runs/39011479037)**.
- JPEG·PNG **실제 다운로드 파일** 시그니처, 확장자, 이미지 치수, 비어 있지 않은 데이터 확인: **[CI 통과](https://github.com/photodonga/ieum/actions/runs/39009746642)**.
- Node 단위 테스트 10개: 크롭, 회전, 아핀 변환, 사진 이력 복제, Blob URL 수명, Canvas 인코딩 인수 전달. **[CI 통과](https://github.com/photodonga/ieum/actions/runs/39010798553)**.
- 테스트는 제한된 합성 샘플을 대상으로 하며 출력 파일 전체의 바이너리 동일성이나 메타데이터 보존을 보장하지 않습니다.
- **미검증:** Safari/Edge 실기기, 다수 대형 원본, 장시간 작업 메모리, ICC 색 프로파일, EXIF/IPTC, CMS 통합 및 보안.

## 이관 전 주의사항
- 일부 모듈은 분리됐지만 `src/app.js`에 주요 UI·상태·렌더링 흐름이 집중돼 있으므로 변경 시 회귀 테스트를 유지
- 삭제/교체 사진이 undo 이력을 위해 메모리에 남을 수 있음. 장시간 작업 메모리 검증 필요
- 캔버스 할당/인코딩 실패의 예외 처리를 보강할 필요가 있음
- 출력물 EXIF/IPTC 제거는 보도사진 송고 정책과 충돌할 수 있으므로 CMS 팀과 명시적으로 합의
- 원본 프로그램과 CMS 통합판의 이미지 픽셀/크기 비교 회귀 테스트 권장

## 코드 저작권·외부 라이선스 1차 점검 (2026-10-17)

**판정: 확인한 저장소 코드에서 명백한 무단 복제나 라이선스 위반 정황은 발견되지 않았으나, 저작권·라이선스 적합성을 최종 보증하는 감사는 아닙니다.** 외부 프로젝트와의 코드 유사도 전수 대조, npm 전체 전이 의존성 감사, SVG 아이콘 원출처 확인, 법률 검토는 수행하지 않았습니다.

| 점검 대상 | 확인된 내용 | 개발팀 후속 조치 |
| --- | --- | --- |
| 앱 런타임 JS | `src/app.js`는 저장소 내부 7개 모듈을 import하며, `package.json`에 별도 런타임 의존성이 선언돼 있지 않음 | 외부 코드 복사·차용 여부를 커밋 이력과 개발 자료로 추가 확인 |
| 개발·테스트 의존성 | `eslint`, `eslint-plugin-html`, `globals`, `playwright`가 `devDependencies`에 선언됨 | 정확한 설치 버전과 전이 의존성의 라이선스·고지 의무를 lockfile/SBOM으로 확인. 테스트 도구는 배포물과 구분 |
| 웹 폰트 | `styles/app.css`가 Google Fonts의 IBM Plex Sans KR·IBM Plex Mono를 불러옴 | 폰트의 공식 라이선스와 웹 제공 방식, 사내 외부 CDN 허용 정책 확인. 필요한 고지 여부 검토 |
| SVG 아이콘 | `index.html`과 `src/app.js`에 인라인 SVG path가 존재함 | 원출처(직접 제작·AI 생성·아이콘 라이브러리 차용)를 확인하고 외부 세트 차용 시 라이선스/저작권 고지 적용 |
| 이미지 리소스 | Git 추적 파일 목록에 별도 사진·이미지 에셋 파일이 없음 | 시연·홍보용 사진을 추가할 경우 사진별 사용권을 별도로 확인 |
| 저장소 배포 정책 | 저장소에 별도 `LICENSE` 파일이 없고 UI에 `Copyright by 송은석. All Rights Reserved.`가 표시됨 | 제3자 사용·복제·수정·재배포 허용 범위를 소유권/사내 정책과 함께 결정. 외부 구성요소의 라이선스는 별도로 준수 |

**주의:** AI가 생성한 코드라는 이유만으로 제3자 저작권 침해 위험이 자동 소멸하는 것은 아닙니다. 저작권 문구는 외부 라이브러리·아이콘의 라이선스 고지 의무를 대신하지 않습니다. 공개 저장소와 `package.json`의 `private: true`도 법적 사용허가를 뜻하지 않습니다.

**권장 마무리:** ① SVG 아이콘 출처 확인 ② npm 직접·전이 의존성 라이선스 목록 생성 ③ 폰트 라이선스/외부 CDN 정책 확인 ④ 필요 고지 파일(예: `THIRD_PARTY_NOTICES.md`) 작성 ⑤ 외부 코드 유사도 검토 후 배포 승인.

## 인수인계 체크리스트
- [ ] CMS 연동 담당자 및 기술 스택 확인
- [ ] 사진 접근 권한·저장 API·송고 단계 확인
- [ ] 메타데이터 유지/삭제 정책 결정
- [ ] 최대 파일 수·해상도·메모리 예산 결정
- [ ] Safari/Edge 및 사내 표준 PC 환경 검증
- [x] 지정된 테스트 샘플의 합성 픽셀·JPEG/PNG 출력 기본 검증 (CI)
- [ ] 실제 취재 사진과 CMS 송고 규격으로 출력 샘플 검수
- [ ] SVG 아이콘·웹 폰트 원출처 및 라이선스 확인
- [ ] npm 전이 의존성 라이선스 확인 및 필요한 제3자 고지 정리
- [ ] 외부 코드 차용·유사도 및 공개 배포 정책 최종 확인
- [x] `package-lock.json` 도입 및 CI의 `npm ci` 전환
- [ ] `.baseline`이 리팩터링 이전 고정 커밋/태그를 참조하도록 변경 (이번 작업 범위 제외)
- [ ] `src/app.js` 단계적 분리 설계 (이번 작업 범위 제외)

Copyright by 송은석. All Rights Reserved.
