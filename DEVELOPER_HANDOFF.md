# 이음(Ieum) — 개발팀 인수인계 안내

## 목적
이음은 여러 장의 사진을 가로 또는 세로로 이어 하나의 JPG/PNG 이미지로 만드는 브라우저 기반 편집 도구입니다. 이 문서는 동아일보 CMS 개발팀의 기술 검토를 돕기 위한 초안입니다. **CMS 내부 구조, 인증 방식, 저장 API는 아직 확인되지 않았습니다.**

## 현재 구현
- 사진 여러 장 추가, 순서 변경, 삭제, 교체, 실행 취소/재실행
- 가로/세로 합성, 비율 및 간격, 크롭·회전·기울기·선명도 등 편집
- 미리보기 저해상도 렌더링과 최종 원본 해상도 출력 분리
- JPG/PNG 저장, PC·모바일 인터페이스, 시스템 다크모드 대응
- 브라우저 내 처리; 출력물에는 EXIF/IPTC 정보가 포함되지 않음

## 실행
- 현재 공개 URL: https://photodonga.github.io/ieum/
- 핵심 구현: `index.html` (HTML/CSS/JavaScript 단일 파일)
- 테스트: `npm test` (정적 검사 및 Playwright 기반 스모크 테스트)
- 자동화: `.github/workflows/test.yml`
- 별도 CMS 연결 없이 브라우저에서 실행 가능

## 현재 코드의 주요 위치 (2026-10-17 기준)
- `index.html` 약 3,764줄
- 스타일/테마: 상단 `<style>`; 다크모드 `prefers-color-scheme` 및 `data-theme`
- 사진 파일 디코딩: `decodeImageFile` (약 1624줄)
- 사진 추가/상태 이력: `addFiles` (약 1646줄), `pushHistory` (약 1494줄)
- 합성 기하/배치: `resolveCompositeGeometry` (약 2446줄)
- 합성 렌더링: `renderComposite` (약 2519줄)
- 원본 출력: `renderFullResolution` (약 2569줄)
- 저장: `finishWithDownloads` 및 `exportBtn` 이벤트 (약 3542~3633줄)
줄 번호는 변경될 수 있으므로 함수명으로 검색하세요.

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

## 확인된 테스트 범위
GitHub Actions 실행 https://github.com/photodonga/ieum/actions/runs/38923794138 (성공)
- PC/모바일 Chromium에서 사진 순서, 합성, UI 기본 동작, 자바스크립트 오류
- PC 원본 해상도 출력 및 모바일 핀치 확대
- Safari/Edge 실기기, 대용량·장시간 작업, 실제 CMS 통합은 별도 검증 필요

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
- [ ] 합성 결과 샘플과 기대 출력 검증

Copyright by 송은석. All Rights Reserved.
