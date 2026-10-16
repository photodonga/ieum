# 이음(Ieum) v1.0 출시 전 점검 기록

작성: 2026-10-17 (KST)  
대상: https://github.com/photodonga/ieum / https://photodonga.github.io/ieum/

## 결과
- 상태: **정적 부분 점검 / 정식 v1.0 미승인**
- 원본 코드·기능·레이아웃 변경: **없음**
- 자동화 테스트 실제 실행: **미실행** (실행 환경에서 GitHub 원본 다운로드/DNS 접근 제한)
- 이 파일은 테스트 결과 **기록 문서**이며, 실행 가능한 새 테스트 스크립트나 수정된 앱은 아님.

## 확인된 구성
- `index.html`: 약 160,914바이트 단일 파일 앱. 다크모드 변수, 반응형 CSS, SVG 버튼 정의 확인.
- `package.json`: `npm test` = `eslint index.html && node smoke.test.mjs`.
- `smoke.test.mjs`: PC 1440×900 및 모바일 390×844 Chromium에서 이미지 추가 순서, 합성, 저장 해상도, 실행 취소, 배치 방향 전환, 핀치 확대 및 JS 오류 확인 코드를 포함.
- `.github/workflows/test.yml`: CI 워크플로 파일 존재. CI 실행 결과는 검증하지 않음.
- `.icon-btn` CSS: 버튼 30×30px, SVG 15×15px. 사진 추가 영역 SVG 24×24px, compact에서는 15×15px.
- 이미 SVG 아이콘을 사용하므로 전면 교체는 불필요.

## 추가 검증 항목 (버그로 확정된 사항 아님)
1. macOS Safari/WebKit, Windows Edge, Android Chrome 회귀 테스트.
2. PNG 다운로드의 실제 크기, 픽셀 및 알파채널 검증과 손상 이미지 입력 처리.
3. 10~20장 고해상도 이미지 반복 편집·저장 시 메모리·성능 시험.
4. 원본 대비 확대·회전·수평·수직 조정 결과의 정확성 비교.
5. 작은 모바일 화면, 가로 방향 및 다크모드 조작성.
6. EXIF·IPTC 미포함 정책의 실무 적합성 검토.

## 로컬 검증 명령
```sh
npm install
npx playwright install chromium
npm test
```

## 출시 판단
테스트를 실제 실행하고 결과를 확인하기 전에는 v1.0 최종 확정 금지. 기존 기능·레이아웃·동작 로직은 그대로 유지하고 발견된 오류만 최소 범위로 수정한다. 운영 `main`은 이 점검 문서 때문에 변경하지 않는다.

Copyright by 송은석. All Rights Reserved.
