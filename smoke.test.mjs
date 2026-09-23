// 이음 스모크 테스트 — 실제 브라우저(Chromium)로 index.html을 열어 핵심 동작을 확인한다.
// 실행: npm test   (처음 한 번은 npm install && npx playwright install chromium)
// 오늘 실제로 났던 버그들을 다시 잡도록 만든 검사들이다.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = "file://" + path.join(here, "index.html");

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + detail}`);
  if (!ok) failed++;
}

// 브라우저 안에서 단색 + 흰 원 JPEG를 만든다 (테스트용 사진 파일을 저장소에 둘 필요 없음)
async function makePhotos(page, specs) {
  const out = await page.evaluate(async (specs) => {
    const res = [];
    for (const s of specs) {
      const c = document.createElement("canvas");
      c.width = s.w; c.height = s.h;
      const g = c.getContext("2d");
      g.fillStyle = s.color; g.fillRect(0, 0, s.w, s.h);
      g.fillStyle = "#eee"; g.beginPath();
      g.ellipse(s.w / 2, s.h / 2, s.w / 5, s.h / 5, 0, 0, Math.PI * 2); g.fill();
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
      res.push({ name: s.name, b64: btoa(bin) });
    }
    return res;
  }, specs);
  return out.map((f) => ({ name: f.name, mimeType: "image/jpeg", buffer: Buffer.from(f.b64, "base64") }));
}

// 큰 사진을 맨 앞에 둔다: 디코딩이 느린 사진이 뒤로 밀리던 순서 버그를 잡기 위해
const SPECS = [
  { name: "p1-big.jpg", w: 6000, h: 4000, color: "#c83c28" },
  { name: "p2.jpg", w: 1200, h: 1800, color: "#2850c8" },
  { name: "p3.jpg", w: 1200, h: 1800, color: "#28a05a" },
];
const COLORS = [[200, 60, 40], [40, 80, 200], [40, 160, 90]];

const state = (page) => page.evaluate(() => {
  const c = document.getElementById("canvas");
  const r = c.getBoundingClientRect();
  return {
    names: [...document.querySelectorAll("li.photo-item")].map((li) => (li.textContent.match(/p\d/) || ["?"])[0]),
    canvas: [r.x, r.y, r.width, r.height].map(Math.round).join(","),
    scroll: [Math.round(scrollX), Math.round(scrollY)].join(","),
    sideAdd: !document.getElementById("mobileInsertLeftBtn").hidden && !document.getElementById("mobileInsertRightBtn").hidden,
    headerAdd: !!document.getElementById("mobileAddPhotoBtn"),
    overflowX: document.documentElement.scrollWidth > innerWidth,
  };
});

// 각 사진 칸 가운데 윗부분 색이 그 사진 색인지 (하얗게 비어 있지 않은지)
const slotColors = (page) => page.evaluate(() => {
  const c = document.getElementById("canvas"), g = c.getContext("2d");
  const vertical = c.height > c.width;
  const n = document.querySelectorAll("li.photo-item").length;
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 0.5) / n;
    const x = vertical ? c.width * 0.1 : c.width * f;
    const y = vertical ? c.height * f : c.height * 0.1;
    return Array.from(g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3));
  });
});
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 30);

async function addPhotos(page) {
  const files = await makePhotos(page, SPECS);
  await page.setInputFiles("#fileInput", files);
  await page.waitForFunction(() => document.querySelectorAll("li.photo-item").length === 3, null, { timeout: 10000 });
  await page.waitForTimeout(400); // 렌더 디바운스(90ms) 여유
}

const browser = await chromium.launch();
try {
  // ---------- PC ----------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(PAGE);
    await addPhotos(page);

    let s = await state(page);
    check("PC: 고른 순서대로 추가된다", s.names.join() === "p1,p2,p3", s.names.join());
    const cols = await slotColors(page);
    check("PC: 모든 사진이 그려진다 (하얀 칸 없음)", cols.every((c, i) => near(c, COLORS[i])), JSON.stringify(cols));
    check("PC: 좌우 + 버튼이 보인다", s.sideAdd);
    check("PC: 헤더 + 버튼은 없다", !s.headerAdd);

    const before = s.canvas;
    const box = await page.locator("#canvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    s = await state(page);
    check("PC: 사진 선택 시 미리보기 크기·위치 그대로", s.canvas === before, `${before} → ${s.canvas}`);
    check("PC: 사진 선택 시 페이지가 스크롤되지 않는다", s.scroll === "0,0", s.scroll);

    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.waitForTimeout(500);
    s = await state(page);
    check("PC: 다른 사진으로 바꿔 선택해도 그대로", s.canvas === before, `${before} → ${s.canvas}`);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    s = await state(page);
    check("PC: 선택 해제 후에도 그대로", s.canvas === before, `${before} → ${s.canvas}`);
    check("PC: 선택 해제 후 좌우 + 버튼 복원", s.sideAdd);

    await page.locator('li.photo-item [data-act="remove"]').first().click();
    await page.waitForTimeout(300);
    s = await state(page);
    check("PC: 삭제하면 2장", s.names.join() === "p2,p3", s.names.join());
    await page.click("#undoBtn");
    await page.waitForTimeout(400);
    s = await state(page);
    check("PC: 실행취소로 다시 3장", s.names.join() === "p1,p2,p3", s.names.join());

    await page.click("#dirVertical");
    await page.waitForTimeout(400);
    const vcols = await slotColors(page);
    check("PC: 세로로 잇기도 모든 사진이 그려진다", vcols.every((c, i) => near(c, COLORS[i])), JSON.stringify(vcols));

    check("PC: 자바스크립트 오류 없음", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ---------- 휴대폰 ----------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(PAGE);
    await addPhotos(page);
    const s = await state(page);
    const cols = await slotColors(page);
    check("모바일: 고른 순서대로 추가된다", s.names.join() === "p1,p2,p3", s.names.join());
    check("모바일: 모든 사진이 그려진다", cols.every((c, i) => near(c, COLORS[i])), JSON.stringify(cols));
    check("모바일: 좌우 + 버튼이 보인다", s.sideAdd);
    check("모바일: 헤더 + 버튼은 없다", !s.headerAdd);
    check("모바일: 가로 스크롤이 생기지 않는다", !s.overflowX);
    check("모바일: 자바스크립트 오류 없음", errors.length === 0, errors.join(" | "));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
process.exit(failed ? 1 : 0);
