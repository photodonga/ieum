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
- 기존 공개 URL: https://photodonga.github.io/ieum/ (배포 기준 `main`)
- CMS 이관용 브랜치: `refactor/cms-handoff-20261017` (**공개판과 분리**, 미배포)
- 진입점: `index.html`; 스타일: `styles/app.css`; 앱 제어: `src/app.js`
- 이미지 계산: `src/composite-geometry.js`, `src/crop-geometry.js`, `src/transform-math.js`
- 원근 보정: `src/perspective-renderer.js`; 사진 이력 상태: `src/photo-state.js`
- 출력 어댑터: `src/canvas-encoder.js`, `src/browser-download.js`
- 테스트: `npm ci` 후 `npx playwright install chromium`, 이어서 `npm test`
- 테스트 구성: ESLint → Node 단위 테스트 → Chromium Playwright 스모크/다운로드 검증
- ES 모듈을 사용하므로 `file://`로 열지 말고 HTTP 정적 서버를 사용해야 합니다.
- CI 워크플로: `.github/workflows/test.yml`; 원본 `main`을 `.baseline`에 체크아웃해 픽셀 비교를 수행합니다.
- 상세 의존성 및 리팩터링 범위: `docs/REFACTORING_MAP.md`

## 현재 모듈화의 경계
**모듈화가 완료됐다는 의미는 아닙니다.** UI, 이미지 파일 저장소, 캔버스 합성 흐름, 사진 편집 상태의 상당 부분은 여전히 `src/app.js`에서 함께 관리합니다. 분리된 모듈은 기존 계산 및 플랫폼 호출의 일부입니다. CMS API 호출, 권한 검사, 메타데이터 보존, 송고 처리는 구현되지 않았습니다.

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
- **전달 범위:** 독립 실행 가능한 정적 웹앱 및 소스, 테스트, 인계 문서. CMS API 연결, 배포·병합, 실제 송고 연동은 미수행.

## 확인된 테스트 범위 (2026-10-17)
- Chromium PC·모바일 스모크 테스트: 사진 추가 순서, 미리보기, 선택, 삭제·실행 취소, 편집, 다운로드, 오류 감지.
- 원본 `main`과 비교하는 캔버스 크기·전체 픽셀 해시 검증: 가로 기본 합성, 회전·수직/수평 원근 보정, 세로 합성, 세로 합성에서 출력 1600px·간격 없음 설정. **[최종 CI 통과](https://github.com/photodonga/ieum/actions/runs/39011479037)**.
- JPEG·PNG **실제 다운로드 파일** 시그니처, 확장자, 이미지 치수, 비어 있지 않은 데이터 확인: **[CI 통과](https://github.com/photodonga/ieum/actions/runs/39009746642)**.
- Node 단위 테스트 10개: 크롭, 회전, 아핀 변환, 사진 이력 복제, Blob URL 수명, Canvas 인코딩 인수 전달. **[CI 통과](https://github.com/photodonga/ieum/actions/runs/39010798553)**.
- 테스트는 제한된 합성 샘플을 대상으로 하며 출력 파일 전체의 바이너리 동일성이나 메타데이터 보존을 보장하지 않습니다.
- **미검증:** Safari/Edge 실기기, 다수 대형 원본, 장시간 작업 메모리, ICC 색 프로파일, EXIF/IPTC, CMS 통합 및 보안.

## 이관 전 주의사항
- 단일 파일 구조로 인해 수정 영향이 넓음. 모듈 분리는 별도 브랜치에서 점진적으로 수행
- 삭제/교체 사진이 undo 이력을 위해 메모리에 남을 수 있음. 장시간 작업 메모리 검증 필요
- 캔버스 할당/인코딩 실패의 예외 처리를 보강할 필요가 있음
- 출력물 EXIF/IPTC 제거는 보도사진 송고 정책과 충돌할 수 있으므로 CMS 팀과 명시적으로 합의
- 원본 프로그램과 CMS 통합판의 이미지 픽셀/크기 비교 회귀 테스트 권장

## 인수인계 체크리스트
- [ ] CMS 연동 담당자 및 기술 스택 확인
- [ ] 사진 접근 권한·저장 API·송고 단계 확인
- [ ] 메타데이터 유지/삭제 정책 결정
- [ ] 최대 파일 수·해상도·메모리 예산 결정
- [ ] Safari/Edge 및 사내 표준 PC 환경 검증
- [x] 지정된 테스트 샘플의 합성 픽셀·JPEG/PNG 출력 기본 검증 (CI)
- [ ] 실제 취재 사진과 CMS 송고 규격으로 출력 샘플 검수

Copyright by 송은석. All Rights Reserved.
