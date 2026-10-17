# 이음 CMS 리팩터링 작업 지도

## 상태
작업 브랜치: `refactor/cms-handoff-20261017`  
공개 `main`과 분리되어 있습니다. 이 문서는 개발팀이 변경 범위를 검토할 수 있도록 현재 의존성을 기록한 것입니다.

## 완료한 비동작 변경
1. 인라인 CSS를 `styles/app.css`로, JavaScript를 `src/app.js`로 분리했습니다.
2. 브라우저 ES 모듈을 사용하도록 `index.html`의 스크립트 로딩을 변경했습니다. 정적 HTTP 서버가 필요합니다.
3. 합성 배치·출력 크기 계산: `src/composite-geometry.js`.
4. 사진 크롭 윈도우 계산: `src/crop-geometry.js`.
5. 회전 행렬·오버스케일·아핀 행렬 계산: `src/transform-math.js`.
6. 원근 보정 메시 그리기: `src/perspective-renderer.js`.
7. 사진 편집 이력 스냅샷 복제: `src/photo-state.js`.
8. Canvas JPEG/PNG 인코딩 호출: `src/canvas-encoder.js`.
9. 브라우저 Blob 다운로드 폴백: `src/browser-download.js`.
10. `src/app.js`는 UI 이벤트, 공유 상태, 렌더링 흐름을 계속 담당합니다. **완전한 엔진/UI 분리는 아직 아닙니다.**

## 자동 검증 현황
- GitHub Actions에서 ESLint와 Chromium Playwright 스모크 테스트 실행.
- CI에서 공개 `main`을 `.baseline`에 별도로 체크아웃하고, 같은 테스트 이미지를 업로드해 캔버스 크기와 픽셀 해시를 비교.
- 기본 합성 및 사진 1장에 회전 12°, 수직 +22, 수평 −17을 함께 적용한 합성 비교까지 통과(2026-10-17, 워크플로 실행 39007765135).
- Node 단위 테스트 10개(회전·크롭·아핀·상태 복제·다운로드·인코딩)가 통과했습니다(워크플로 39009244014).
- JPEG/PNG 실제 다운로드 파일의 시그니처·치수 검사를 추가했습니다. 첫 실행에서 숨겨진 설정 버튼 클릭으로 실패해 테스트 셀렉터를 보정했으며, 보정 후 결과는 워크플로 39009705056에서 확인해야 합니다.
- **주의:** 원본 비교는 현재 고정된 샘플·설정에 한정됩니다. 메타데이터, 대용량 메모리 한계, Safari/Edge/실기기 등은 아직 별도 검증이 필요합니다.
- 로컬에서 `npm test`만 실행하면 `.baseline/index.html`이 없을 경우 원본 비교는 건너뜁니다. CI는 원본 체크아웃을 수행합니다.

## 현재 주요 함수와 책임
| 영역 | 주요 함수 (src/app.js) | 주의 |
|---|---|---|
| 사진 디코딩/썸네일 | `decodeImageFile`, `makeThumb` | ImageBitmap/Image 폴백 |
| 사진 목록/이력 | `addFiles`, `snapshotPhotos`, `pushHistory`, `restoreSnapshot` | store 및 photos 상태 공유 |
| 이미지 회전/크롭 | `getEffectiveImage` (`app.js`), `computeCropWindow` (`crop-geometry.js`) | 이미지 캐시와 편집 상태 공유 |
| 원근/변형 렌더링 | `solveAffine3` (`transform-math.js`), `drawPerspectiveMesh` (`perspective-renderer.js`), `drawSlot` (`app.js`) | 캔버스 좌표·설정 결합 |
| 합성 배치 | `buildRenderItems` (`app.js`), `resolveOutputScale`, `resolveCompositeGeometry` (`composite-geometry.js`) | settings, photos, store 의존 |
| 미리보기 | `renderComposite`, `prepareCompositeCanvas` | DOM, 렌더링 상태 의존 |
| 원본 출력 | `renderFullResolution`, `drawCompositeItems` | 합성 배치/렌더 함수 재사용 |
| 파일 저장 | `finishWithDownloads`, exportBtn 클릭 핸들러 | 다운로드/공유 플랫폼 의존 |
| UI 조작 | `renderList`, `enterEdit`, `exitEdit` | DOM 이벤트/선택 상태 의존 |

## 다음 모듈화 원칙
- 먼저 현재 브랜치의 자동 테스트 통과를 확인할 것.
- **합성 알고리즘과 출력 픽셀 결과를 변경하지 않는 방식**으로 작은 함수 그룹부터 추출.
- 엔진 입력은 명시적인 이미지·편집 상태·설정으로, 출력은 Canvas/Blob 및 치수로 정의.
- UI에서 직접 접근하는 공유 상태는 단계적으로 어댑터를 거쳐 전달.
- 새 모듈을 도입할 때마다 기존 테스트와 픽셀 회귀 테스트를 모두 통과할 것.
- 파일만 분리했다고 CMS 연동이 완성된 것은 아님.

## CMS 개발팀이 확인할 사항
1. CMS의 인증·파일 접근·저장·송고 인터페이스
2. 이미지 메타데이터(EXIF/IPTC) 정책
3. 브라우저 및 최대 이미지 크기/메모리 제한
4. 이음의 기존 화면을 삽입할지, 이미지 엔진만 재사용할지

## 실행
정적 파일 서버에서 `index.html`을 제공하면 상대 경로로 CSS/JS를 불러옵니다. `npm test`로 Chromium 회귀 테스트를 실행합니다. Safari/Edge/실기기 검증은 별도로 필요합니다.

Copyright by 송은석. All Rights Reserved.
