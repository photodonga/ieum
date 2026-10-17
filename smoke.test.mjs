// 이음 스모크 테스트 — 실제 브라우저(Chromium)로 index.html을 열어 핵심 동작을 확인한다.
// 실행: npm test   (처음 한 번은 npm install && npx playwright install chromium)
// 오늘 실제로 났던 버그들을 다시 잡도록 만든 검사들이다.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// ES modules require an HTTP origin; file:// silently blocks module loading in Chromium.
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const filePath = path.resolve(here, "." + pathname);
    if (!filePath.startsWith(here + path.sep) && filePath !== here) {
      res.writeHead(403); res.end(); return;
    }
    const body = await readFile(filePath);
    const mime = filePath.endsWith(".js") ? "text/javascript" : filePath.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const PAGE = `http://127.0.0.1:${server.address().port}/index.html`;

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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(PAGE);
    await addPhotos(page);

    let s = await state(page);
    check("PC: 고른 순서대로 추가된다", s.names.join() === "p1,p2,p3", s.names.join());
    const cols = await slotColors(page);
    check("PC: 모든 사진이 그려진다 (하얀 칸 없음)", cols.every((c, i) => near(c, COLORS[i])), JSON.stringify(cols));

    // Canvas 픽셀 회귀: 같은 입력을 같은 설정으로 다시 그리면 결과가 정확히 같아야 한다.
    // 원본(main)과의 교차 버전 비교는 별도의 기준 이미지 검증이 필요하다.
    if (existsSync(path.join(here, ".baseline", "index.html"))) {
      const baseline = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const baselineErrors = [];
      baseline.on("pageerror", e => baselineErrors.push(e.message));
      await baseline.goto(PAGE.replace("/index.html", "/.baseline/index.html"));
      await addPhotos(baseline);
      const pixels = async p => p.evaluate(() => {
        const c = document.getElementById("canvas");
        const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let hash = 2166136261;
        for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619) >>> 0;
        return { w: c.width, h: c.height, hash };
      });
      const original = await pixels(baseline);
      const refactored = await pixels(page);
      check("PC: 원본(main)과 리팩터링 합성 픽셀이 일치한다", JSON.stringify(original) === JSON.stringify(refactored), JSON.stringify({ original, refactored, baselineErrors }));

      // 원근 보정 경로를 실제로 실행해 픽셀 단위로 교차 검증한다.
      const applyTransform = async p => {
        await p.locator('li.photo-item [data-act="adjust"]').first().click();
        for (const [id, value] of [["#rotRange", "12"], ["#skewVRange", "22"], ["#skewHRange", "-17"]]) {
          await p.locator(id).evaluate((el, v) => {
            el.value = v;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, value);
        }
        await p.waitForTimeout(650);
      };
      await applyTransform(baseline);
      await applyTransform(page);
      const originalWarp = await pixels(baseline);
      const refactoredWarp = await pixels(page);
      check("PC: 회전·수직·수평 원근 보정 픽셀이 원본과 일치한다", JSON.stringify(originalWarp) === JSON.stringify(refactoredWarp), JSON.stringify({ originalWarp, refactoredWarp }));
      await baseline.close();
    }
    const pixelBefore = await page.evaluate(() => {
      const c = document.getElementById("canvas");
      const g = c.getContext("2d");
      const data = g.getImageData(0, 0, c.width, c.height).data;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619) >>> 0;
      return { width: c.width, height: c.height, hash };
    });
    await page.waitForTimeout(350);
    const pixelAfter = await page.evaluate(() => {
      const c = document.getElementById("canvas");
      const g = c.getContext("2d");
      const data = g.getImageData(0, 0, c.width, c.height).data;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619) >>> 0;
      return { width: c.width, height: c.height, hash };
    });
    check("PC: 합성 캔버스 픽셀이 안정적으로 유지된다", JSON.stringify(pixelBefore) === JSON.stringify(pixelAfter), JSON.stringify({ pixelBefore, pixelAfter }));

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

    // Compare vertical stitching against the untouched public main implementation.
    if (existsSync(path.join(here, ".baseline", "index.html"))) {
      const baselineVertical = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await baselineVertical.goto(PAGE.replace("/index.html", "/.baseline/index.html"));
      await addPhotos(baselineVertical);
      // Match the refactor page's preceding remove/undo sequence exactly.
      await baselineVertical.locator('li.photo-item [data-act="remove"]').first().click();
      await baselineVertical.waitForTimeout(300);
      await baselineVertical.click("#undoBtn");
      await baselineVertical.waitForTimeout(400);
      await baselineVertical.click("#dirVertical");
      await baselineVertical.waitForTimeout(450);
      const verticalPixels = async p => p.evaluate(() => {
        const c = document.getElementById("canvas");
        const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let hash = 2166136261;
        for (const byte of data) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        return { w: c.width, h: c.height, hash };
      });
      const expectedVertical = await verticalPixels(baselineVertical);
      const actualVertical = await verticalPixels(page);
      check("PC: 세로 합성 픽셀이 원본(main)과 일치한다", JSON.stringify(expectedVertical) === JSON.stringify(actualVertical), JSON.stringify({ expectedVertical, actualVertical }));
      await baselineVertical.close();
    }


    // 미리보기는 가볍게(화면 해상도), 저장은 원본 해상도로
    const res = await page.evaluate(() => ({
      preview: document.getElementById("canvas").width,
      dims: document.getElementById("dimsReadout").textContent,
    }));
    const outW = Number((res.dims.match(/^(\d+)/) || [0, 0])[1]);
    check("PC: 미리보기는 화면 해상도로 그린다 (버벅임 방지)", res.preview < outW && res.preview <= 3000, `${res.preview} / ${outW}`);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
    const saved = await dl.path();
    const head = (await import("node:fs")).readFileSync(saved);
    // JPEG SOF0/SOF2 마커에서 실제 저장 크기를 읽는다
    let savedW = 0, savedH = 0;
    for (let i = 2; i < head.length - 9; i++) {
      if (head[i] === 0xff && (head[i + 1] === 0xc0 || head[i + 1] === 0xc2)) {
        savedH = head.readUInt16BE(i + 5); savedW = head.readUInt16BE(i + 7); break;
      }
    }
    check("PC: 저장 파일은 원본 해상도", res.dims === `${savedW} × ${savedH} px`, `${res.dims} vs ${savedW}x${savedH}`);

    check("PC: JPEG 저장 파일 시그니처와 확장자 정상", head[0] === 0xff && head[1] === 0xd8 && head[head.length - 2] === 0xff && head[head.length - 1] === 0xd9 && dl.suggestedFilename().endsWith(".jpg"));
    check("PC: JPEG 저장 파일이 비어 있지 않다", head.length > 1024, String(head.length));

    // 같은 이미지에 PNG 저장을 선택해 파일 시그니처와 실제 픽셀 치수를 검사한다.
    // The settings panel may be collapsed after entering edit mode; dispatch the
    // existing click handler directly rather than changing UI visibility.
    await page.locator('#formatSeg button[data-val="png"]').evaluate(button => button.click());
    await page.waitForTimeout(350);
    const pngDims = await page.locator("#dimsReadout").textContent();
    const [pngDownload] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
    const pngBytes = await readFile(await pngDownload.path());
    const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    check("PC: PNG 저장 파일 시그니처와 확장자 정상", pngBytes.subarray(0, 8).equals(pngMagic) && pngDownload.suggestedFilename().endsWith(".png"));
    const pngWidth = pngBytes.readUInt32BE(16), pngHeight = pngBytes.readUInt32BE(20);
    check("PC: PNG 저장 파일도 원본 해상도", pngDims === `${pngWidth} × ${pngHeight} px`, `${pngDims} vs ${pngWidth}x${pngHeight}`);
    check("PC: PNG 저장 파일이 비어 있지 않다", pngBytes.length > 1024, String(pngBytes.length));


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

    // 화면 전체 두 손가락 확대는 막고, 사진 조정의 두 손가락 확대는 살아 있어야 한다
    const zoomLock = await page.evaluate(() => ({
      touch: getComputedStyle(document.documentElement).touchAction,
      meta: document.querySelector('meta[name="viewport"]').content,
    }));
    check("모바일: 화면 확대 막힘 (touch-action·viewport)", zoomLock.touch === "pan-x pan-y" && zoomLock.meta.includes("maximum-scale=1"), JSON.stringify(zoomLock));
    await page.locator('li.photo-item [data-act="adjust"]').first().click();
    await page.waitForTimeout(500);
    await page.locator("#editOverlay").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const ob = await page.locator("#editOverlay").boundingBox();
    const z0 = Number(await page.inputValue("#zoomRange"));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizePinchGesture", { x: ob.x + ob.width / 2, y: ob.y + ob.height / 2, scaleFactor: 1.8, relativeSpeed: 400, gestureSourceType: "touch" });
    await page.waitForTimeout(400);
    const z1 = Number(await page.inputValue("#zoomRange"));
    check("모바일: 사진 조정에서는 두 손가락 확대가 된다", z1 > z0, `${z0} → ${z1}`);
    check("모바일: 자바스크립트 오류 없음", errors.length === 0, errors.join(" | "));
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
process.exit(failed ? 1 : 0);
