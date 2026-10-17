# 이음 CMS 리팩터링 작업 지도

## 상태
작업 브랜치: `refactor/cms-handoff-20261017`  
공개 `main`과 분리되어 있습니다. 이 문서는 개발팀이 변경 범위를 검토할 수 있도록 현재 의존성을 기록한 것입니다.

## 완료한 비동작 변경
1. 기존 인라인 CSS를 `styles/app.css`로 추출. CSS 선언은 원본과 동일.
2. 기존 인라인 JavaScript를 `src/app.js`로 추출. JS 내용은 원본과 동일.
3. `index.html`은 두 파일을 상대 경로로 불러옴.

현재는 **파일 분리 단계**이며, UI와 엔진을 독립적인 ES 모듈로 완전히 분리한 상태가 아닙니다.

## 현재 주요 함수와 책임
| 영역 | 주요 함수 (src/app.js) | 주의 |
|---|---|---|
| 사진 디코딩/썸네일 | `decodeImageFile`, `makeThumb` | ImageBitmap/Image 폴백 |
| 사진 목록/이력 | `addFiles`, `snapshotPhotos`, `pushHistory`, `restoreSnapshot` | store 및 photos 상태 공유 |
| 이미지 회전/크롭 | `getEffectiveImage`, `computeCropWindow` | 이미지 캐시와 편집 상태 공유 |
| 원근/변형 렌더링 | `solveAffine3`, `drawPerspectiveMesh`, `drawSlot` | 캔버스 좌표·설정 결합 |
| 합성 배치 | `buildRenderItems`, `resolveOutputScale`, `resolveCompositeGeometry` | settings, photos, store 의존 |
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
