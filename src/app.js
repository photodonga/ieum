
import * as compositeGeometry from "./composite-geometry.js";
import * as cropGeometry from "./crop-geometry.js";
import * as transformMath from "./transform-math.js";

(function(){
  "use strict";

  const ICONS = {
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 15 7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 9 7 7 7-7"/></svg>',
    drag: '<svg viewBox="0 0 8 16" fill="currentColor"><circle cx="2" cy="2" r="1.3"/><circle cx="6" cy="2" r="1.3"/><circle cx="2" cy="8" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="2" cy="14" r="1.3"/><circle cx="6" cy="14" r="1.3"/></svg>',
    adjust: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v4M8 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 11v10M16 3v10M16 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM16 17v4"/></svg>'
  };

  const RATIOS = { free: null, '1:1': 1, '4:5': 4/5, '3:4': 3/4, '2:3': 2/3 };
  // 최종 출력 긴 축에 비례하는 실제 흰 간격.
  // 1600px 출력 기준: 얇게 4px / 보통 8px / 넓게 16px.
  const OUTPUT_GAP_RATIOS = { none: 0, thin: 0.0025, normal: 0.005, wide: 0.01 };
  function sharpenLevel(v){
    if (typeof v === 'number') return Math.max(0, Math.min(10, v));
    // 이전 버전 history/state 호환
    return ({none:0, light:3, normal:6, strong:10})[v] ?? 0;
  }
  const EYE_LEVEL = 0.4;
  // Preview/layout coordinate baseline only. Never use this as source resolution.
  const RATIO_BASELINE = 1000;
  const MAX_ZOOM = 5;
  // Interactive rendering is coalesced to one draw per animation frame.  Do not replace
  // the visible canvas with a lower-resolution version while dragging: although faster,
  // that makes the browser recalculate its intrinsic box and causes a distracting size
  // flicker in Fit preview.

  /* ---------- state ---------- */
  let photos = [];              // ordered [{id, rotation, crop:{z,cx,cy}|null}]
  const store = new Map();      // id -> {img, w, h, name, thumb, effCache}

  const EXPORT_QUALITY = 0.92;

  const settings = {
    direction: 'horizontal',
    fitMode: 'frame',
    ratio: '2:3',
    spacingMode: 'thin',
    format: 'jpeg',
    outputMode: 'original',
    outputPreset: 1600,
    outputCustom: 2000,
    commonAuto: true,
    commonSize: null,
    customRatioW: 4,
    customRatioH: 5,
    // named presets (1:1/4:5/3:4/2:3) are stored portrait-first; this just says whether to
    // use them as-is or flipped to their landscape counterpart (5:4/4:3/3:2/etc). 사용자 지정
    // doesn't use this — flipping it instead swaps the two number inputs directly (see the
    // ratioOrientSeg handler below), so what's typed there always matches what's applied.
    ratioOrientation: 'portrait'
  };

  // 방향별 기본 비율은 사용자가 비율을 직접 고르기 전까지만 자동 적용.
  let ratioTouchedByUser = false;

  // resolves the active frame ratio, including the free-form "사용자 지정" case
  // (a preset returns its fixed number, 자유 returns null, custom is computed live from the two inputs)
  function getFixedAR(){
    if (settings.ratio === 'custom') {
      const w = Math.max(0.01, Number(settings.customRatioW) || 1);
      const h = Math.max(0.01, Number(settings.customRatioH) || 1);
      return w / h;
    }
    const ar = RATIOS[settings.ratio];
    if (ar != null && settings.ratioOrientation === 'landscape') return 1 / ar;
    return ar;
  }

  // keeps the numeric ratio pills (1:1/4:5/3:4/2:3) truthful about which way they're
  // currently applied — "자유"/"사용자 지정" have their own fixed Korean labels and are left alone
  function refreshRatioPillLabels(){
    document.querySelectorAll('#ratioPills .pill').forEach(btn => {
      const key = btn.dataset.ratio;
      if (!key || !key.includes(':')) return;
      const [a, b] = key.split(':');
      btn.textContent = settings.ratioOrientation === 'landscape' ? `${b}:${a}` : `${a}:${b}`;
    });
  }

  let downloadsNS = null;
  (async () => {
    try {
      if (window.claude && window.claude.use) downloadsNS = await window.claude.use('downloads');
    } catch (e) { downloadsNS = null; }
  })();

  /* ---------- element refs ---------- */
  const el = (id) => document.getElementById(id);
  const photoList = el('photoList');
  const photoCount = el('photoCount');
  const dropzone = el('dropzone');
  const fileInput = el('fileInput');
  const previewStage = el('previewStage');
  const canvas = el('canvas');
  const emptyPreview = el('emptyPreview');
  const dimsReadout = el('dimsReadout');
  const sizeReadout = el('sizeReadout');
  const exportBtn = el('exportBtn');
  const exportLabel = el('exportLabel');
  const undoBtn = el('undoBtn');
  const redoBtn = el('redoBtn');

  /* ---------- helpers ---------- */
  function uid(){ return 'p' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  // the uploaded file's own name is attacker-controllable (anyone who hands someone a photo
  // picks its filename) and gets dropped into an innerHTML template for the list row — escape
  // it before interpolating so a crafted name like `"><img src=x onerror=...>` can't break out
  // of the title="" attribute / text position and run script in the viewer's own tab.
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // window.alert()도 confirm()과 같은 이유(sandboxed iframe에 allow-modals 없음)로 조용히
  // 무시될 수 있어서, 저장 실패 등을 사용자에게 알릴 때는 이 자체 토스트를 쓴다.
  let toastTimer = null;
  function showToast(msg, durationMs){
    let t = document.getElementById('appToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'appToast';
      t.className = 'app-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), durationMs || 3200);
  }

  /* ---------- undo/redo (whole-app history over photo actions) ----------
     Covers everything that changes the PHOTO list/state: add, remove, reorder,
     rotate, crop adjustments (zoom/straighten/skew/pan/sharpen), replace, and
     clear-all. Deliberately does NOT cover 설정 (ratio/spacing/format/output) —
     those are rendering options, not actions on a photo, and undoing them
     alongside photo edits was the confusing mix that got this feature pulled
     before. A snapshot is just the `photos` array (id/rotation/crop) — the
     actual image bytes live forever in `store` keyed by id, so restoring an
     older snapshot always finds its image (replace hands out a fresh id
     instead of overwriting the old one, so even "교체" is fully undoable). */
  let historyStack = [];
  let historyIndex = -1;

  function snapshotPhotos(){
    return photos.map(p => ({ id: p.id, rotation: p.rotation, crop: p.crop ? { ...p.crop } : null }));
  }
  function updateHistoryButtons(){
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= historyStack.length - 1;
  }
  function pushHistory(){
    const snap = snapshotPhotos();
    if (historyIndex >= 0 && JSON.stringify(historyStack[historyIndex]) === JSON.stringify(snap)) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(snap);
    historyIndex = historyStack.length - 1;
    updateHistoryButtons();
  }
  function restoreSnapshot(snap){
    photos = snap.map(p => ({ id: p.id, rotation: p.rotation, crop: p.crop ? { ...p.crop } : null }));
    if (editingId && !photos.find(p => p.id === editingId)) {
      exitEdit();
    } else if (editingId) {
      syncAdjustPanel();
    }
    if (settings.commonAuto) recomputeCommonSize();
    renderList();
    renderNow();
  }
  function undo(){
    if (historyIndex <= 0) return;
    historyIndex--;
    restoreSnapshot(historyStack[historyIndex]);
    updateHistoryButtons();
  }
  function redo(){
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    restoreSnapshot(historyStack[historyIndex]);
    updateHistoryButtons();
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  // window.confirm()은 게시된 Artifact가 실행되는 sandboxed iframe에서 allow-modals가
  // 없으면 그냥 조용히 무시된다 (대화상자가 안 뜨고 false 취급) — 그래서 버튼이 아예
  // 작동하지 않는 것처럼 보였다. 네이티브 대화상자 대신 "한 번 더 누르면 실행" 방식으로
  // 바꿔서, 실수로 바로 지워지진 않으면서도 어떤 환경에서든 확실히 동작하게 한다.
  const clearBtn = el('clearBtn');
  let clearArmed = false, clearArmTimer = null;
  function disarmClear(){
    clearArmed = false;
    clearTimeout(clearArmTimer);
    clearBtn.textContent = '전체 비우기';
    clearBtn.classList.remove('armed');
  }
  el('clearBtn').addEventListener('click', () => {
    if (photos.length === 0) return;
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = '한번 더 누르면 비워져요';
      clearBtn.classList.add('armed');
      clearTimeout(clearArmTimer);
      clearArmTimer = setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    photos = [];
    renderList();
    scheduleRender();
    pushHistory();
  });

  /* ---------- adding photos ---------- */
  let pendingPreviewInsertIndex = null;
  const mobileInsertLeftBtn = el('mobileInsertLeftBtn');
  const mobileInsertRightBtn = el('mobileInsertRightBtn');

  function openPreviewInsertPicker(index){
    if (!photos.length) return;
    pendingPreviewInsertIndex = index;
    fileInput.click();
  }

  function syncPreviewInsertButtons(){
    const hidden = !photos.length || !!editingId;
    if (mobileInsertLeftBtn) mobileInsertLeftBtn.hidden = hidden;
    if (mobileInsertRightBtn) mobileInsertRightBtn.hidden = hidden;
  }

  fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (pendingPreviewInsertIndex !== null) {
      const idx = pendingPreviewInsertIndex;
      pendingPreviewInsertIndex = null;
      insertFilesAt(files, idx);
    } else {
      addFiles(files);
    }
    fileInput.value = '';
  });


  [[mobileInsertLeftBtn, 0], [mobileInsertRightBtn, () => photos.length]].forEach(([btn, index]) => {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPreviewInsertPicker(typeof index === 'function' ? index() : index);
    });
  });

  // Empty preview is the primary click-to-add target.
  // Once photos exist, clicking photos remains reserved for selection/adjustment.
  emptyPreview.setAttribute('role','button');
  emptyPreview.setAttribute('tabindex','0');
  emptyPreview.setAttribute('aria-label','사진 추가');
  emptyPreview.addEventListener('click',(e)=>{
    e.stopPropagation();
    if(!photos.length) fileInput.click();
  });
  emptyPreview.addEventListener('keydown',(e)=>{
    if(!photos.length && (e.key==='Enter'||e.key===' ')){
      e.preventDefault();
      fileInput.click();
    }
  });

  // Decode the selected FILE itself. On iOS/iCloud, loading an object URL through
  // HTMLImageElement can be handed a display-sized representation in some paths.
  // createImageBitmap(file) asks the browser to decode the file/blob directly and keeps
  // the decoded pixel dimensions independent from our 1000px preview/layout baseline.
  async function decodeImageFile(file){
    if ('createImageBitmap' in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
          return { img: bitmap, w: bitmap.width, h: bitmap.height };
        }
      } catch (_) { /* HEIF/older Safari: fall through to Image */ }
    }
    return await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const out = { img, w: img.naturalWidth, h: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
      img.src = url;
    });
  }

  function addFiles(fileList){
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    // 디코딩은 병렬로 하되, 추가는 사용자가 고른 순서대로 한다.
    // (예전에는 먼저 디코딩이 끝난 사진부터 붙어서 순서가 뒤바뀌곤 했다)
    const ready = new Array(files.length);
    let next = 0, loaded = 0;
    const flush = () => {
      let added = false;
      while (next < files.length && ready[next] !== undefined) {
        const r = ready[next++];
        if (!r) continue; // 디코딩 실패한 파일은 건너뜀
        store.set(r.id, r.rec);
        photos.push({ id: r.id, rotation: 0, crop: null });
        added = true;
      }
      if (added) {
        renderList();
        if (settings.commonAuto) recomputeCommonSize();
        scheduleRender();
      }
    };
    files.forEach(async (file, i) => {
      let result = null;
      try {
        const decoded = await decodeImageFile(file);
        result = { id: uid(), rec: { img: decoded.img, w: decoded.w, h: decoded.h, name: file.name, thumb: makeThumb(decoded.img, decoded.w, decoded.h), effCache: {} } };
      } catch (_) { /* 읽을 수 없는 파일은 건너뜀 */ }
      ready[i] = result;
      flush();
      loaded++;
      if (loaded === files.length) pushHistory();
    });
  }

  function makeThumb(img, sourceW, sourceH){
    const iw = sourceW || img.naturalWidth || img.width;
    const ih = sourceH || img.naturalHeight || img.height;
    const max = 120;
    const s = Math.min(1, max / Math.max(iw, ih));
    const w = Math.round(iw * s), h = Math.round(ih * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.85);
  }

  /* effective (rotation-baked) image, cached per rotation */
  function getEffectiveImage(rec, rotation){
    rotation = ((rotation % 360) + 360) % 360;
    if (!rec.effCache) rec.effCache = {};
    if (rec.effCache[rotation]) return rec.effCache[rotation];
    if (rotation === 0) {
      const val = { img: rec.img, w: rec.w, h: rec.h };
      rec.effCache[0] = val;
      return val;
    }
    const swapped = rotation % 180 !== 0;
    const w = swapped ? rec.h : rec.w, h = swapped ? rec.w : rec.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(rec.img, -rec.w / 2, -rec.h / 2);
    const val = { img: c, w, h };
    rec.effCache[rotation] = val;
    return val;
  }

  function defaultCrop(){ return { z: 1, cx: 0.5, cy: 0.5, rot: 0, skewV: 0, skewH: 0, sharpen: 0 }; }

  function isCropAdjusted(crop){
    if (!crop) return false;
    return crop.z > 1.001 || Math.abs(crop.cx - 0.5) > 0.001 || Math.abs(crop.cy - 0.5) > 0.001
      || Math.abs(crop.rot || 0) > 0.001 || Math.abs(crop.skewV || 0) > 0.001 || Math.abs(crop.skewH || 0) > 0.001
      || sharpenLevel(crop.sharpen) > 0;
  }

  /* ---------- list rendering ---------- */

  // PC에서는 미리보기 높이까지 남는 공간을 사진 목록이 전부 사용한다.
  // 큰 모니터는 더 많은 행을 보여주고, 공간이 부족할 때만 목록 내부가 스크롤된다.
  // 모바일/좁은 화면은 기존의 컴팩트 목록(2장)을 유지한다.
  function syncPhotoListHeight(){
    const rows = Array.from(photoList.querySelectorAll('li.photo-item'));
    const wideWorkspace = window.matchMedia('(min-width:1100px), (orientation:landscape) and (min-width:800px)').matches;
    if (wideWorkspace) {
      photoList.style.maxHeight = 'none';
      syncPhotoListOverflowCue();
      return;
    }
    const mobile = window.matchMedia('(max-width:700px)').matches;
    const visibleRows = mobile ? 2 : 3;
    if (rows.length <= visibleRows) {
      photoList.style.maxHeight = 'none';
      syncPhotoListOverflowCue();
      return;
    }
    const target = rows[visibleRows - 1];
    const listRect = photoList.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const h = (targetRect.bottom - listRect.top) + photoList.scrollTop;
    photoList.style.maxHeight = Math.ceil(h) + 'px';
    syncPhotoListOverflowCue();
  }

  function syncPhotoListOverflowCue(){
    requestAnimationFrame(() => {
      const overflow = photoList.scrollHeight > photoList.clientHeight + 2;
      const moreBelow = overflow && (photoList.scrollTop + photoList.clientHeight < photoList.scrollHeight - 3);
      photoList.classList.toggle('has-more-below', moreBelow);
    });
  }


  function scrollSelectedPhotoIntoView(id, behavior='smooth'){
    requestAnimationFrame(() => {
      const row = photoList.querySelector(`li.photo-item[data-id="${id}"]`);
      if (!row) return;
      const listRect = photoList.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (rowRect.top < listRect.top || rowRect.bottom > listRect.bottom) {
        row.scrollIntoView({behavior, block:'nearest', inline:'nearest'});
      }
    });
  }

  function renderList(){
    photoCount.textContent = photos.length + '장';
    dropzone.classList.toggle('compact', photos.length > 0);
    photoList.innerHTML = '';
    photos.forEach((p, idx) => {
      const rec = store.get(p.id);
      if (!rec) return;
      const li = document.createElement('li');
      li.className = 'photo-item' + (editingId === p.id ? ' selected' : '');
      li.dataset.id = p.id;
      li.innerHTML = `
        <span class="drag-handle">${ICONS.drag}</span>
        <div class="thumb-wrap">
          <img class="thumb" src="${rec.thumb}" alt="" style="${p.rotation ? `transform:rotate(${p.rotation}deg);` : ''}">
          ${p.rotation ? `<span class="rot-badge">${p.rotation}°</span>` : ''}
        </div>
        <span class="photo-name" title="${escapeHtml(rec.name)} · ${rec.w}×${rec.h}px">${escapeHtml(rec.name)}</span>
        <div class="stack-btns">
          <button data-act="up" ${idx===0?'disabled':''} title="위로">${ICONS.up}</button>
          <button data-act="down" ${idx===photos.length-1?'disabled':''} title="아래로">${ICONS.down}</button>
        </div>
        <div class="item-actions">
          <button class="icon-btn${editingId===p.id?' live':(isCropAdjusted(p.crop)?' on':'')}" data-act="adjust" title="확대/위치 조정">${ICONS.adjust}</button>
          <button class="icon-btn" data-act="rotate" title="90도 회전">${ICONS.rotate}</button>
          <button class="icon-btn danger" data-act="remove" title="삭제">${ICONS.trash}</button>
        </div>
      `;
      photoList.appendChild(li);
    });
    requestAnimationFrame(() => { syncPhotoListHeight(); schedulePreviewFit(); });
  }

  photoList.addEventListener('scroll', syncPhotoListOverflowCue, {passive:true});

  photoList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const li = e.target.closest('li.photo-item');
    const id = li.dataset.id;
    const idx = photos.findIndex(p => p.id === id);
    if (idx === -1) return;
    const act = btn.dataset.act;

    // switching focus to a different photo's button always closes out whatever
    // photo was mid-edit first, so its in-progress crop gets committed to undo
    // history before anything else happens (rather than silently staying "selected")
    if (editingId && editingId !== id) exitEdit();

    if (act === 'adjust') {
      if (editingId === id) exitEdit(); else enterEdit(id);
      return;
    }
    if (editingId === id) exitEdit();
    if (act === 'rotate') {
      photos[idx].rotation = (photos[idx].rotation + 90) % 360;
      photos[idx].crop = null;
    } else if (act === 'remove') {
      photos.splice(idx, 1);
    } else if (act === 'up' && idx > 0) {
      [photos[idx-1], photos[idx]] = [photos[idx], photos[idx-1]];
    } else if (act === 'down' && idx < photos.length - 1) {
      [photos[idx+1], photos[idx]] = [photos[idx], photos[idx+1]];
    }
    if (settings.commonAuto) recomputeCommonSize();
    renderList();
    scheduleRender();
    pushHistory();
  });

  /* ---------- Photo list reordering ----------
     Pointer-based sorting works consistently for mouse, touch, and pen. */
  (() => {
  /* Native HTML5 drag-and-drop does not fire from a touch gesture on most mobile
     browsers, so a phone/tablet user pressing the handle couldn't reorder photos at all.
     Pointer Events fire the same way for mouse, touch and pen, so one implementation covers
     both. Beyond just working on touch, the dragged row now floats free of the list —
     translucent, slightly enlarged, tracking the pointer directly — with a dashed
     placeholder marking where it will land and the other rows sliding smoothly out of the
     way (a FLIP-style transform animation), instead of the earlier version's instant DOM
     reorder. This is the same "lift and float" feel as iOS's own list reordering. */
  let dragLi = null, dragPointerId = null, dragPlaceholder = null;
  let dragStartX = 0, dragStartY = 0, dragOrigLeft = 0, dragOrigTop = 0;

  // records every row's current position, runs the DOM mutation, then — for any row that
  // actually moved — sets it right back to its old spot with a transform and immediately
  // clears that transform, letting the row's own CSS transition animate it home. Standard
  // FLIP (First-Last-Invert-Play) technique; the placeholder is just another row here so it
  // glides into place the same way everything else does.
  function flipListRows(mutate){
    const rows = Array.from(photoList.children);
    const before = new Map(rows.map(n => [n, n.getBoundingClientRect()]));
    mutate();
    rows.forEach(n => {
      const oldRect = before.get(n);
      const newRect = n.getBoundingClientRect();
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dy) < 1) return;
      n.style.transition = 'none';
      n.style.transform = `translateY(${dy}px)`;
      n.getBoundingClientRect(); // force a reflow so the browser registers the starting transform...
      n.style.transition = '';   // ...before switching back to the default transition and...
      n.style.transform = '';    // ...clearing the offset, which is what actually animates
    });
  }

  photoList.addEventListener('pointerdown', (e) => {
    let handle = e.target.closest('.drag-handle');
    if (!handle) return;
    let li = handle.closest('li.photo-item');
    if (!li) return;
    const id = li.dataset.id;
    // switching focus to a different photo always commits whatever photo was
    // mid-edit first (same rule the click handler above uses) — exitEdit() rebuilds
    // the whole list DOM, so re-resolve the live node/handle after it runs rather
    // than holding on to references that may have just been replaced.
    if (editingId && editingId !== id) {
      exitEdit();
      li = photoList.querySelector(`li.photo-item[data-id="${id}"]`);
      if (!li) return;
      handle = li.querySelector('.drag-handle');
    }
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    dragLi = li;
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigLeft = rect.left;
    dragOrigTop = rect.top;
    handle.setPointerCapture(e.pointerId);

    // a placeholder the same height as the row holds its place in the flow (so the rest
    // of the list reflows normally around it) while the real row floats independently
    dragPlaceholder = document.createElement('li');
    dragPlaceholder.className = 'photo-item drag-placeholder';
    dragPlaceholder.style.height = rect.height + 'px';
    photoList.insertBefore(dragPlaceholder, li);

    li.style.width = rect.width + 'px';
    li.style.left = rect.left + 'px';
    li.style.top = rect.top + 'px';
    li.classList.add('dragging');
    // move the row itself out to <body> -- see the .dragging CSS comment for why leaving
    // it position:fixed inside .panel wouldn't track the viewport the way it looks like it should
    document.body.appendChild(li);
  });

  // pointerdown fires on photoList (before the row is reparented out to <body>), but capture
  // reroutes move/up/cancel to the handle wherever it currently lives in the tree — once the
  // row moves to <body> that no longer bubbles through photoList, so these listen on document instead
  document.addEventListener('pointermove', (e) => {
    if (!dragLi || e.pointerId !== dragPointerId) return;
    dragLi.style.left = (dragOrigLeft + (e.clientX - dragStartX)) + 'px';
    dragLi.style.top = (dragOrigTop + (e.clientY - dragStartY)) + 'px';

    // dragLi has pointer-events:none (see CSS) precisely so this hit-test reports whatever
    // real row is actually beneath the floating one, not the floating row itself
    const overEl = document.elementFromPoint(e.clientX, e.clientY);
    const overLi = overEl && overEl.closest && overEl.closest('li.photo-item');
    if (!overLi || overLi === dragPlaceholder || overLi.parentElement !== photoList) return;
    const rect = overLi.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const target = before ? overLi : overLi.nextSibling;
    if (dragPlaceholder.nextSibling === target) return;
    flipListRows(() => photoList.insertBefore(dragPlaceholder, target));
  });
  function endListDrag(e){
    if (!dragLi || (dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    photoList.insertBefore(dragLi, dragPlaceholder);
    dragPlaceholder.remove();
    dragLi.classList.remove('dragging');
    dragLi.style.position = '';
    dragLi.style.left = '';
    dragLi.style.top = '';
    dragLi.style.width = '';

    // the drag only ever moved actual DOM nodes (never renderList(), which would have
    // destroyed the pointer-captured handle mid-gesture) — so read the final order back
    // off the DOM now and reorder the `photos` array to match.
    const order = Array.from(photoList.children).map(node => node.dataset.id);
    photos.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    dragLi = null;
    dragPointerId = null;
    dragPlaceholder = null;
    if (settings.commonAuto) recomputeCommonSize();
    renderList();
    scheduleRender();
    pushHistory();
  }
  document.addEventListener('pointerup', endListDrag);
  document.addEventListener('pointercancel', endListDrag);
  })();

  /* ---------- settings wiring ---------- */
  function setActiveSeg(container, val){
    container.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === val));
  }

  el('directionSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings.direction = btn.dataset.val;
    setActiveSeg(el('directionSeg'), settings.direction);

    if (!ratioTouchedByUser) {
      settings.ratio = '2:3';
      settings.ratioOrientation = settings.direction === 'vertical' ? 'landscape' : 'portrait';
      document.querySelectorAll('#ratioPills .pill').forEach(p =>
        p.classList.toggle('active', p.dataset.ratio === '2:3')
      );
      setActiveSeg(el('ratioOrientSeg'), settings.ratioOrientation);
      el('ratioCustomRow').hidden = true;
      el('ratioCustomHint').hidden = true;
      refreshRatioPillLabels();
    }

    syncFitModeUI();
    updateCommonAutoLabel();
    if (settings.commonAuto) recomputeCommonSize();
    scheduleRender();
  });



  function syncAdvancedState(){
    const s=el('advancedState'); if(!s)return;
    let size='최대 크기';
    if(settings.outputMode==='preset') size=(settings.outputPreset||1600)+'px';
    else if(settings.outputMode==='custom') size=(settings.outputCustom||2000)+'px';
    const fmt=settings.format==='png'?'PNG':'JPG';
    s.textContent=size+' · '+fmt;
    const out=el('outputReadout');
    if(out) out.textContent=size+' · '+fmt;
  }

  const fitModeSeg = el('fitModeSeg');
  const ratioField = el('ratioField');
  const fitModeHint = el('fitModeHint');
  const outputSizeLabel = el('outputSizeLabel');

  function syncFitModeUI(){
    setActiveSeg(fitModeSeg, settings.fitMode);
    const original = settings.fitMode === 'original';
    ratioField.hidden = original;
    fitModeHint.textContent = original
      ? (settings.direction === 'vertical'
          ? '사진을 자르지 않고 원본 비율을 유지한 채 같은 너비로 맞춥니다.'
          : '사진을 자르지 않고 원본 비율을 유지한 채 같은 높이로 맞춥니다.')
      : '프레임 비율에 맞춰 사진을 정돈합니다.';
    outputSizeLabel.textContent = original
      ? (settings.direction === 'vertical' ? '출력 크기 (전체 높이 기준)' : '출력 크기 (전체 너비 기준)')
      : '출력 크기 (긴 변 기준)';
  }

  fitModeSeg.addEventListener('click',(e)=>{
    const btn=e.target.closest('button'); if(!btn)return;
    settings.fitMode=btn.dataset.val;
    syncFitModeUI();
    if(settings.commonAuto) recomputeCommonSize();
    scheduleRender();
    pushHistory();
  });


  el('outputPills').addEventListener('click',()=>setTimeout(syncAdvancedState,0));
  el('formatSeg').addEventListener('click',()=>setTimeout(syncAdvancedState,0));
  el('outputCustomInput').addEventListener('input',()=>setTimeout(syncAdvancedState,0));

  const ratioCustomRow = el('ratioCustomRow');
  const ratioCustomHint = el('ratioCustomHint');
  const ratioCustomW = el('ratioCustomW');
  const ratioCustomH = el('ratioCustomH');
  const ratioLinkBtn = el('ratioLinkBtn');
  let ratioLinked = false;

  el('ratioPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    ratioTouchedByUser = true;
    document.querySelectorAll('#ratioPills .pill').forEach(p => p.classList.toggle('active', p === btn));
    settings.ratio = btn.dataset.ratio;
    ratioCustomRow.hidden = settings.ratio !== 'custom';
    ratioCustomHint.hidden = settings.ratio !== 'custom';
    if (editingId) exitEdit();
    photos.forEach(p => { p.crop = null; });
    renderList();
    scheduleRender();
  });

  el('ratioOrientSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.dataset.val === settings.ratioOrientation) return;
    settings.ratioOrientation = btn.dataset.val;
    setActiveSeg(el('ratioOrientSeg'), settings.ratioOrientation);
    refreshRatioPillLabels();
    if (settings.ratio === 'custom') {
      // WYSIWYG: physically swap the two number fields rather than flipping the ratio
      // invisibly underneath numbers that would otherwise stop matching what's applied
      const w = settings.customRatioW, h = settings.customRatioH;
      settings.customRatioW = h;
      settings.customRatioH = w;
      ratioCustomW.value = settings.customRatioW;
      ratioCustomH.value = settings.customRatioH;
    }
    if (settings.ratio !== 'free') {
      if (editingId) exitEdit();
      photos.forEach(p => { p.crop = null; });
      renderList();
    }
    scheduleRender();
  });

  ratioLinkBtn.addEventListener('click', () => {
    ratioLinked = !ratioLinked;
    ratioLinkBtn.classList.toggle('on', ratioLinked);
    if (ratioLinked) {
      // syncing on: snap the two fields to the same value right away, not just on the next edit
      ratioCustomH.value = ratioCustomW.value;
      settings.customRatioW = Number(ratioCustomW.value) || 1;
      settings.customRatioH = settings.customRatioW;
      scheduleRender();
    }
  });

  ratioCustomW.addEventListener('input', () => {
    settings.customRatioW = Number(ratioCustomW.value) || 1;
    if (ratioLinked) {
      ratioCustomH.value = ratioCustomW.value;
      settings.customRatioH = settings.customRatioW;
    }
    scheduleRender();
  });
  ratioCustomH.addEventListener('input', () => {
    settings.customRatioH = Number(ratioCustomH.value) || 1;
    if (ratioLinked) {
      ratioCustomW.value = ratioCustomH.value;
      settings.customRatioW = settings.customRatioH;
    }
    scheduleRender();
  });

  el('spacingPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    document.querySelectorAll('#spacingPills .pill').forEach(p => p.classList.toggle('active', p === btn));
    settings.spacingMode = btn.dataset.spacing;
    scheduleRender();
  });

  el('formatSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings.format = btn.dataset.val;
    setActiveSeg(el('formatSeg'), settings.format);
    exportLabel.textContent = (settings.format === 'jpeg' ? 'JPG' : 'PNG') + '로 저장';
    scheduleRender();
  });

  const outputCustomInput = el('outputCustomInput');
  el('outputPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    document.querySelectorAll('#outputPills .pill').forEach(p => p.classList.toggle('active', p === btn));
    const preset = btn.dataset.preset;
    outputCustomInput.hidden = preset !== 'custom';
    if (preset === 'custom') { settings.outputMode = 'custom'; settings.outputCustom = Number(outputCustomInput.value) || 2000; }
    else if (preset === 'original') { settings.outputMode = 'original'; }
    else { settings.outputMode = 'preset'; settings.outputPreset = Number(preset); }
    scheduleRender();
  });
  outputCustomInput.addEventListener('input', () => {
    settings.outputCustom = Number(outputCustomInput.value) || 200;
    scheduleRender();
  });

  const commonAutoCheck = el('commonAutoCheck');
  const commonSizeInput = el('commonSizeInput');
  commonAutoCheck.addEventListener('change', () => {
    settings.commonAuto = commonAutoCheck.checked;
    commonSizeInput.disabled = settings.commonAuto;
    if (settings.commonAuto) recomputeCommonSize();
    scheduleRender();
  });
  commonSizeInput.addEventListener('input', () => {
    settings.commonSize = Number(commonSizeInput.value) || settings.commonSize;
    scheduleRender();
  });
  function updateCommonAutoLabel(){
    el('commonAutoLabel').textContent = settings.direction === 'vertical'
      ? '기준 폭 자동 계산 (사진들의 중간값)'
      : '기준 높이 자동 계산 (사진들의 중간값)';
  }

  function median(arr){
    const s = [...arr].sort((a,b)=>a-b);
    const mid = Math.floor(s.length/2);
    return s.length % 2 ? s[mid] : Math.round((s[mid-1]+s[mid])/2);
  }
  function crossSize(rec, rotation){
    const eff = getEffectiveImage(rec, rotation);
    return settings.direction === 'vertical' ? eff.w : eff.h;
  }
  function recomputeCommonSize(){
    if (photos.length === 0) return;
    const vals = photos.map(p => crossSize(store.get(p.id), p.rotation));
    settings.commonSize = median(vals);
    commonSizeInput.value = settings.commonSize;
  }

  function computeCropWindow(eff, AR, crop){
    return cropGeometry.computeCropWindow(eff, AR, crop, clamp, MAX_ZOOM);
  }

  /* fine straighten (rot), applied as a cosmetic transform on top of the already-cropped
     window, with automatic overscale so the rotated content still fully covers the
     destination slot (no gaps at corners). 수직/수평 (skewV/skewH) used to be baked into
     this same matrix as a simple shear, but a shear can only ever TILT straight lines —
     it can't converge or diverge them, so it never behaved like a real perspective/
     keystone correction (see drawPerspectiveMesh below for the real thing). */
  function rotMatrix(rotDeg){ return transformMath.rotMatrix(rotDeg, clamp); }
  function computeOverscale(a,b,c,d,W,H){ return transformMath.computeOverscale(a,b,c,d,W,H); }
  const MAX_KEYSTONE = 0.5;
  function solveAffine3(S,D){ return transformMath.solveAffine3(S,D); }

  function drawWarpedTriangle(ctx, img, S0, S1, S2, D0, D1, D2){
    const M = solveAffine3([S0, S1, S2], [D0, D1, D2]);
    if (!M) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(D0[0], D0[1]);
    ctx.lineTo(D1[0], D1[1]);
    ctx.lineTo(D2[0], D2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(...M);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  /* real (trapezoid) perspective correction for 수직/수평, drawn as a fine mesh of small
     affine-warped triangles (canvas 2D has no native projective-transform primitive).
     Samples a TRAPEZOID-shaped region out of `win` — narrower at one edge, wider at the
     other — and stretches it to fill the rectangular destW x destH slot; that stretch is
     what actually straightens converging lines, instead of just tilting them the way a
     plain shear does. gridN trades quality for speed (coarse while a slider is being
     dragged live, fine on the settle render). */
  // slider value (-50..50) -> keystone strength. An EASED curve (not linear) so the
  // first ~third of the slider stays subtle/fine-grained -- a photographer nudging out
  // a slightly-tilted building shouldn't already be at "strong trapezoid" by 20% of the
  // range -- while the far end still reaches a solid, clearly-corrective maximum.
  function keystoneStrength(sliderVal){
    const t = clamp(sliderVal, -50, 50) / 50;
    return Math.sign(t) * Math.pow(Math.abs(t), 1.7) * MAX_KEYSTONE;
  }

  function drawPerspectiveMesh(ctx, img, win, skewV, skewH, destW, destH, gridN){
    const kV = keystoneStrength(skewV);
    const kH = keystoneStrength(skewH);
    const scaleV = 1 / (1 + Math.abs(kV));
    const scaleH = 1 / (1 + Math.abs(kH));

    const verts = [];
    for (let j = 0; j <= gridN; j++){
      const v = j / gridN - 0.5;
      const row = [];
      for (let i = 0; i <= gridN; i++){
        const u = i / gridN - 0.5;
        // 수직(vertical correction): the sampled row's width varies with v, so the top
        // and bottom edges of the sampled trapezoid differ — stretching that back out to
        // a uniform destW is what straightens verticals that were converging top-to-bottom.
        const widthFrac = 1 + kV * 2 * v;
        // 수평(horizontal correction): same idea, rotated 90° — sampled column height
        // varies with u.
        const heightFrac = 1 + kH * 2 * u;
        const p = u * widthFrac * scaleV;   // stays within [-0.5, 0.5] by construction
        const q = v * heightFrac * scaleH;  // (scaleV/scaleH shrink the whole trapezoid
                                             // just enough that even its widest edge fits
                                             // inside `win` — never samples outside it)
        row.push([
          win.srcX + (p + 0.5) * win.winW,
          win.srcY + (q + 0.5) * win.winH,
          u * destW,
          v * destH,
        ]);
      }
      verts.push(row);
    }

    for (let j = 0; j < gridN; j++){
      for (let i = 0; i < gridN; i++){
        const v00 = verts[j][i], v10 = verts[j][i+1], v01 = verts[j+1][i], v11 = verts[j+1][i+1];
        drawWarpedTriangle(ctx, img, [v00[0],v00[1]], [v10[0],v10[1]], [v01[0],v01[1]], [v00[2],v00[3]], [v10[2],v10[3]], [v01[2],v01[3]]);
        drawWarpedTriangle(ctx, img, [v10[0],v10[1]], [v11[0],v11[1]], [v01[0],v01[1]], [v10[2],v10[3]], [v11[2],v11[3]], [v01[2],v01[3]]);
      }
    }
  }

  function drawSlot(ctx, img, win, dx, dy, destW, destH, crop, live){
    const rot = crop.rot || 0, skewV = crop.skewV || 0, skewH = crop.skewH || 0;
    if (!rot && !skewV && !skewH) {
      ctx.drawImage(img, win.srcX, win.srcY, win.winW, win.winH, dx, dy, destW, destH);
      return;
    }
    if (!skewV && !skewH) {
      // rotation only -- the old, cheap, exact single-drawImage path still applies
      const { a, b, c, d } = rotMatrix(rot);
      const s = computeOverscale(a, b, c, d, destW, destH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, destW, destH);
      ctx.clip();
      ctx.translate(dx + destW / 2, dy + destH / 2);
      ctx.transform(a, c, b, d, 0, 0);
      ctx.scale(s, s);
      ctx.drawImage(img, win.srcX, win.srcY, win.winW, win.winH, -destW / 2, -destH / 2, destW, destH);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, destW, destH);
    ctx.clip();
    ctx.translate(dx + destW / 2, dy + destH / 2);
    // rot is applied as a plain canvas rotation on top of the mesh, same as the
    // rotation-only path above -- but the mesh itself still only paints an axis-aligned
    // destW x destH rectangle, so once THAT gets rotated, its corners swing outside the
    // (unrotated) clip rect while the clip rect's own corners go uncovered, leaving white
    // triangular gaps. Same fix as the rotation-only path: overscale so the rotated
    // content still fully covers the clip -- just applied to the mesh's destination size
    // instead of a single drawImage call.
    let meshW = destW, meshH = destH;
    if (rot) {
      const { a, b, c, d } = rotMatrix(rot);
      // computeOverscale returns the minimum scale that makes the rotated rectangle's
      // edges exactly touch the clip rect's corners -- with the mesh built from many
      // separately-clipped triangles (vs. one drawImage call in the rotation-only path),
      // that exact tangency leaves a sub-pixel gap at the seam some of the time. A small
      // safety margin closes it; it's far too small to read as extra zoom.
      const s = computeOverscale(a, b, c, d, destW, destH) * 1.02;
      ctx.rotate(rot * Math.PI / 180);
      meshW = destW * s;
      meshH = destH * s;
    }
    drawPerspectiveMesh(ctx, img, win, skewV, skewH, meshW, meshH, live ? 6 : 16);
    ctx.restore();
  }


  /* ---------- rendering the composite ---------- */
  let renderTimer = null;
  let liveRenderFrame = 0;
  function scheduleRender(){
    clearTimeout(renderTimer);
    if (liveRenderFrame) {
      cancelAnimationFrame(liveRenderFrame);
      liveRenderFrame = 0;
    }
    renderTimer = setTimeout(renderComposite, 90);
  }

  let lastSlots = []; // [{id, x, y, w, h}] in canvas-internal px, one per photo

  /* every photo always has an adjustable slot: a fixed ratio uses one shared AR,
     "자유" gives each photo its own (rotated) native AR, frozen until it's edited again */
  function slotARFor(eff){
    const fixedAR = getFixedAR();
    return fixedAR !== null ? fixedAR : (eff.w / eff.h);
  }

  /* ---------- composite renderer ---------- */
  function buildRenderItems(){
    const fixedAR = settings.fitMode === 'original' ? null : getFixedAR();
    let commonSize;
    if (settings.fitMode === 'original') {
      // Same cross-axis size for every image: horizontal join => same height,
      // vertical join => same width. slotARFor() then preserves each source AR.
      commonSize = RATIO_BASELINE;
    } else if (fixedAR !== null) {
      commonSize = RATIO_BASELINE;
    } else {
      if (settings.commonAuto) recomputeCommonSize();
      commonSize = settings.commonSize || RATIO_BASELINE;
    }

    const items = photos.map((p) => {
      const rec = store.get(p.id);
      const eff = getEffectiveImage(rec, p.rotation);
      const AR = settings.fitMode === 'original' ? (eff.w / eff.h) : slotARFor(eff);
      if (!p.crop) p.crop = defaultCrop();
      const slotCross = commonSize;
      const slotLong = settings.direction === 'vertical' ? commonSize / AR : commonSize * AR;
      return { p, eff, AR, slotCross, slotLong };
    });
    return { items, commonSize };
  }

  function resolveCompositeGeometry(items, commonSize){
    return compositeGeometry.resolveCompositeGeometry(items, commonSize, settings, computeCropWindow, OUTPUT_GAP_RATIOS);
  }

  function prepareCompositeCanvas(finalLong, finalCross){
    if (settings.direction === 'vertical') { canvas.width = finalCross; canvas.height = finalLong; }
    else { canvas.width = finalLong; canvas.height = finalCross; }
    emptyPreview.style.display = 'none';
    canvas.hidden = false;
    exportBtn.disabled = false;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  function drawCompositeItems(ctx, items, geometry, live, slotsOut = lastSlots){
    const { spacing, finalScale } = geometry;
    let cursor = 0;
    items.forEach((it, idx) => {
      const cropForRender = settings.fitMode === 'original'
        ? { ...it.p.crop, z:1, cx:.5, cy:.5, rot:0, skewV:0, skewH:0 }
        : it.p.crop;
      const win = computeCropWindow(it.eff, it.AR, cropForRender);
      if (settings.fitMode !== 'original') {
        it.p.crop.cx = win.cxNorm; it.p.crop.cy = win.cyNorm;
      }
      const destW = (settings.direction === 'vertical' ? it.slotCross : it.slotLong) * finalScale;
      const destH = (settings.direction === 'vertical' ? it.slotLong : it.slotCross) * finalScale;
      const pos = cursor * finalScale;
      let dx, dy;
      if (settings.direction === 'vertical') { dx = 0; dy = pos; }
      else { dx = pos; dy = 0; }
      drawSlot(ctx, it.eff.img, win, dx, dy, destW, destH, settings.fitMode === 'original' ? defaultCrop() : it.p.crop, live);
      slotsOut.push({ id: it.p.id, x: dx, y: dy, w: destW, h: destH });
      cursor += it.slotLong + (idx < items.length - 1 ? spacing : 0);
    });
  }

  function updateRenderedPreview(ctx, geometry, live){
    if (!live) {
      dimsReadout.textContent = lastRender.full.w + ' × ' + lastRender.full.h + ' px';
      scheduleSizeEstimate();
      applyPreviewZoom();
    }
    if (editingId) positionEditOverlay();
    if (eyeGuideOn) positionEyeGuide();
  }

  function renderComposite(opts){
    const live = !!(opts && opts.live);
    if (photos.length === 0) {
      syncPreviewInsertButtons();
      canvas.hidden = true;
      emptyPreview.style.display = '';
      dimsReadout.textContent = '—';
      sizeReadout.textContent = '—';
      exportBtn.disabled = true;
      lastSlots = [];
      if (editingId) exitEdit();
      if (eyeGuideOn) positionEyeGuide();
      return;
    }
    lastSlots = [];
    const { items, commonSize } = buildRenderItems();
    const geometry = resolveCompositeGeometry(items, commonSize);
    const full = fullDimsOf(geometry);
    // 미리보기는 화면에 필요한 해상도로만 그린다. 원본 해상도(수천만 화소)로 매번 그리면
    // 휴대폰에서 선택·드래그·확대가 버벅인다. 저장할 때만 원본 해상도로 다시 그린다.
    lastPreviewTargetW = previewTargetWidth();
    const ps = Math.min(1, lastPreviewTargetW / full.w);
    const previewGeometry = {
      ...geometry,
      finalScale: geometry.finalScale * ps,
      finalLong: Math.max(1, Math.round(geometry.finalLong * ps)),
      finalCross: Math.max(1, Math.round(geometry.finalCross * ps)),
    };
    lastRender = { full };
    const ctx = prepareCompositeCanvas(previewGeometry.finalLong, previewGeometry.finalCross);
    drawCompositeItems(ctx, items, previewGeometry, live);
    updateRenderedPreview(ctx, previewGeometry, live);
    syncPreviewInsertButtons();
  }

  /* ---------- preview resolution vs. output resolution ---------- */
  let lastRender = { full: { w: 0, h: 0 } };
  let lastPreviewTargetW = 0;
  function fullDimsOf(geometry){
    return settings.direction === 'vertical'
      ? { w: geometry.finalCross, h: geometry.finalLong }
      : { w: geometry.finalLong, h: geometry.finalCross };
  }
  // 미리보기 캔버스 가로 픽셀 수: 화면 폭 × 기기 픽셀 배율 (최소 1200px).
  // 미리보기는 어떤 배율에서도 화면 폭보다 넓게 표시되지 않으므로 이 정도면 선명하다.
  function previewTargetWidth(){
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    return Math.max(1200, Math.ceil(window.innerWidth * dpr));
  }
  // 저장용: 원본 해상도로 새 캔버스에 그린다 (화면의 미리보기 캔버스는 건드리지 않음).
  function renderFullResolution(){
    const { items, commonSize } = buildRenderItems();
    const geometry = resolveCompositeGeometry(items, commonSize);
    const full = fullDimsOf(geometry);
    const out = document.createElement('canvas');
    out.width = full.w; out.height = full.h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    drawCompositeItems(ctx, items, geometry, false, []);
    return out;
  }
  function formatBytes(bytes){
    const kb = bytes / 1024;
    return kb > 1024 ? (kb/1024).toFixed(1) + 'MB' : Math.round(kb) + 'KB';
  }
  // 파일 크기는 원본 해상도 전체를 인코딩하지 않고, 가운데 1024px 조각만 원본 해상도로
  // 그려 인코딩한 뒤 전체 면적으로 환산한다 (그래서 '약'). 저장하면 실제 크기로 바뀐다.
  let sizeEstimateTimer = null;
  function scheduleSizeEstimate(){
    clearTimeout(sizeEstimateTimer);
    sizeEstimateTimer = setTimeout(updateSizeEstimate, 500);
  }
  function updateSizeEstimate(){
    if (!photos.length) return;
    const { items, commonSize } = buildRenderItems();
    const geometry = resolveCompositeGeometry(items, commonSize);
    const full = fullDimsOf(geometry);
    const tw = Math.min(1024, full.w), th = Math.min(1024, full.h);
    const tile = document.createElement('canvas');
    tile.width = tw; tile.height = th;
    const ctx = tile.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.translate(-Math.round((full.w - tw) / 2), -Math.round((full.h - th) / 2));
    drawCompositeItems(ctx, items, geometry, false, []);
    const mime = settings.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    tile.toBlob((blob) => {
      if (!blob) { sizeReadout.textContent = '—'; return; }
      const est = blob.size * (full.w * full.h) / (tw * th);
      sizeReadout.textContent = '약 ' + formatBytes(est);
    }, mime, EXPORT_QUALITY);
  }

  /* ---------- inline crop editing (directly on the live preview) ---------- */
  const canvasWrap = el('canvasWrap');

  /* OS file -> preview frame replacement.
     Capture at document level so the browser cannot navigate/open the dragged image
     before the canvas gets a chance to accept it. */
  const frameDropOverlay=el('frameDropOverlay');
  const emptySlotDrop=el('emptySlotDrop');
  const insertDropCue=el('insertDropCue');

  function clearInsertCue(){
    insertDropCue.classList.remove('show');
    insertDropCue.hidden=true;
  }

  // Detect insertion zones near the boundaries between existing frames.
  // Center area of a frame remains "replace"; only the narrow edge zone means "insert".
  function insertionAtPoint(clientX,clientY){
    if(canvas.hidden||photos.length<1||!lastSlots.length)return null;
    const cr=canvas.getBoundingClientRect();
    if(clientX<cr.left||clientX>cr.right||clientY<cr.top||clientY>cr.bottom)return null;
    const sx=cr.width/canvas.width, sy=cr.height/canvas.height;
    const horizontal=settings.direction!=='vertical';
    const threshold=18; // CSS px: intentionally narrow to avoid accidental inserts.

    if(horizontal){
      for(let i=0;i<lastSlots.length;i++){
        const s=lastSlots[i];
        const left=cr.left+s.x*sx, right=left+s.w*sx;
        if(Math.abs(clientX-left)<=threshold)
          return {index:i,axis:'x',coord:left,side:'left'};
        if(Math.abs(clientX-right)<=threshold)
          return {index:i+1,axis:'x',coord:right,side:'right'};
      }
    }else{
      for(let i=0;i<lastSlots.length;i++){
        const s=lastSlots[i];
        const top=cr.top+s.y*sy, bottom=top+s.h*sy;
        if(Math.abs(clientY-top)<=threshold)
          return {index:i,axis:'y',coord:top,side:'top'};
        if(Math.abs(clientY-bottom)<=threshold)
          return {index:i+1,axis:'y',coord:bottom,side:'bottom'};
      }
    }
    return null;
  }

  function paintInsertCue(ins){
    if(!ins){clearInsertCue();return;}
    const wr=canvasWrap.getBoundingClientRect();
    const cr=canvas.getBoundingClientRect();
    insertDropCue.hidden=false;

    if(ins.axis==='x'){
      insertDropCue.style.left=(ins.coord-wr.left-2)+'px';
      insertDropCue.style.top=(cr.top-wr.top+8)+'px';
      insertDropCue.style.width='4px';
      insertDropCue.style.height=Math.max(12,cr.height-16)+'px';
    }else{
      insertDropCue.style.left=(cr.left-wr.left+8)+'px';
      insertDropCue.style.top=(ins.coord-wr.top-2)+'px';
      insertDropCue.style.width=Math.max(12,cr.width-16)+'px';
      insertDropCue.style.height='4px';
    }
    requestAnimationFrame(()=>insertDropCue.classList.add('show'));
  }

  function insertFilesAt(fileList,index){
    const files=Array.from(fileList||[]);
    if(!files.length)return;
    // Reuse existing decoder/addFiles, but capture newly appended photo records and splice
    // them into the requested order after decoding. This keeps all existing image handling.
    const beforeIds=new Set(photos.map(p=>p.id));
    addFiles(files);
    let tries=0;
    const settle=()=>{
      const added=photos.filter(p=>!beforeIds.has(p.id));
      if(added.length>=files.length || tries++>80){
        if(added.length){
          const addedIds=new Set(added.map(p=>p.id));
          const base=photos.filter(p=>!addedIds.has(p.id));
          base.splice(Math.max(0,Math.min(index,base.length)),0,...added);
          photos.splice(0,photos.length,...base);
          renderList();
          if(settings.commonAuto)recomputeCommonSize();
          scheduleRender();
          pushHistory();
        }
        return;
      }
      setTimeout(settle,25);
    };
    setTimeout(settle,25);
  }


  function clearEmptySlot(){
    emptySlotDrop.hidden=true;
  }

  // When the current layout has room for another image, use the unused half/slot
  // of the visible canvas as a direct drop target. This is intentionally simple:
  // for a single image, expose the opposite half according to the current join direction.
  function emptySlotAtPoint(clientX,clientY){
    if(canvas.hidden||!canvas.width||!canvas.height||photos.length!==1)return null;
    const r=canvas.getBoundingClientRect();
    if(clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null;

    const verticalJoin = settings.direction === 'vertical';
    const existing = lastSlots && lastSlots[0];
    if(!existing)return null;

    // Build a virtual two-slot canvas from the current visible canvas bounds.
    // Horizontal join => right half is add slot. Vertical join => bottom half.
    if(!verticalJoin){
      const mid=r.left+r.width/2;
      if(clientX<mid)return null;
      return {left:mid,top:r.top,width:r.width/2,height:r.height};
    }else{
      const mid=r.top+r.height/2;
      if(clientY<mid)return null;
      return {left:r.left,top:mid,width:r.width,height:r.height/2};
    }
  }

  function paintEmptySlot(slot){
    if(!slot){clearEmptySlot();return;}
    const wr=canvasWrap.getBoundingClientRect();
    emptySlotDrop.style.left=(slot.left-wr.left)+'px';
    emptySlotDrop.style.top=(slot.top-wr.top)+'px';
    emptySlotDrop.style.width=slot.width+'px';
    emptySlotDrop.style.height=slot.height+'px';
    emptySlotDrop.hidden=false;
  }


  function isOSFileDrag(dt){
    if(!dt)return false;
    return Array.from(dt.types||[]).includes('Files') || !!(dt.files&&dt.files.length);
  }
  function droppedImageFiles(dt){
    return Array.from((dt&&dt.files)||[]).filter(f =>
      f && (((f.type||'').toLowerCase().startsWith('image/')) ||
      /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test((f.name||'').trim()))
    );
  }
  function pointToSlot(clientX,clientY){
    if(canvas.hidden||!canvas.width||!canvas.height||!lastSlots.length)return null;
    const r=canvas.getBoundingClientRect();
    if(clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null;
    const x=(clientX-r.left)*(canvas.width/r.width);
    const y=(clientY-r.top)*(canvas.height/r.height);
    return lastSlots.find(s=>x>=s.x&&x<=s.x+s.w&&y>=s.y&&y<=s.y+s.h)||null;
  }
  function paintDropSlot(slot){
    if(!slot){frameDropOverlay.hidden=true;return;}
    const cr=canvas.getBoundingClientRect(),wr=canvasWrap.getBoundingClientRect();
    const sx=cr.width/canvas.width,sy=cr.height/canvas.height;
    frameDropOverlay.style.left=(cr.left-wr.left+slot.x*sx)+'px';
    frameDropOverlay.style.top=(cr.top-wr.top+slot.y*sy)+'px';
    frameDropOverlay.style.width=(slot.w*sx)+'px';
    frameDropOverlay.style.height=(slot.h*sy)+'px';
    frameDropOverlay.hidden=false;
  }
  async function replacePreviewPhoto(targetId,file){
    const idx=photos.findIndex(p=>p.id===targetId); if(idx<0||!file)return;
    try {
      const decoded=await decodeImageFile(file);
      const newId=uid();
      store.set(newId,{img:decoded.img,w:decoded.w,h:decoded.h,name:file.name,thumb:makeThumb(decoded.img,decoded.w,decoded.h),effCache:{}});
      photos[idx]={id:newId,rotation:0,crop:null};
      if(editingId===targetId)exitEdit();
      renderList();
      if(settings.commonAuto)recomputeCommonSize();
      scheduleRender(); pushHistory();
    } catch (_) {}
  }

  function pointInsidePreview(clientX,clientY){
    const r=previewStage.getBoundingClientRect();
    return clientX>=r.left&&clientX<=r.right&&clientY>=r.top&&clientY<=r.bottom;
  }
  function clearPreviewDropUI(){
    frameDropOverlay.hidden=true;
    previewStage.classList.remove('preview-file-drop');
  }

  document.addEventListener('dragenter',e=>{
    if(isOSFileDrag(e.dataTransfer))e.preventDefault();
  },true);

  document.addEventListener('dragover',e=>{
    if(!isOSFileDrag(e.dataTransfer))return;
    e.preventDefault();
    if(e.dataTransfer)e.dataTransfer.dropEffect='copy';

    const ins=insertionAtPoint(e.clientX,e.clientY);
    const empty=emptySlotAtPoint(e.clientX,e.clientY);
    const slot=pointToSlot(e.clientX,e.clientY);
    if(ins){
      clearEmptySlot();
      frameDropOverlay.hidden=true;
      previewStage.classList.remove('preview-file-drop');
      paintInsertCue(ins);
    }else if(empty){
      clearInsertCue();
      frameDropOverlay.hidden=true;
      previewStage.classList.remove('preview-file-drop');
      paintEmptySlot(empty);
    }else if(slot){
      clearInsertCue();
      clearEmptySlot();
      previewStage.classList.remove('preview-file-drop');
      paintDropSlot(slot);
    }else if(pointInsidePreview(e.clientX,e.clientY)){
      clearInsertCue();
      clearEmptySlot();
      frameDropOverlay.hidden=true;
      previewStage.classList.add('preview-file-drop');
    }else{
      clearInsertCue();
      clearEmptySlot();
      clearPreviewDropUI();
    }
  },true);

  document.addEventListener('drop',e=>{
    if(!isOSFileDrag(e.dataTransfer))return;
    e.preventDefault(); e.stopPropagation();

    const files=droppedImageFiles(e.dataTransfer);
    const ins=insertionAtPoint(e.clientX,e.clientY);
    const empty=emptySlotAtPoint(e.clientX,e.clientY);
    const slot=pointToSlot(e.clientX,e.clientY);
    const inPreview=pointInsidePreview(e.clientX,e.clientY);
    clearInsertCue();
    clearEmptySlot();
    clearPreviewDropUI();

    if(!files.length)return;

    if(ins){
      insertFilesAt(files,ins.index);
      return;
    }

    if(empty){
      addFiles(files);
      return;
    }

    if(slot){
      replacePreviewPhoto(slot.id,files[0]);
      return;
    }

    if(inPreview){
      addFiles(files);
      return;
    }

  },true);

  document.addEventListener('dragleave',e=>{
    if(e.clientX===0&&e.clientY===0){clearInsertCue();clearEmptySlot();clearPreviewDropUI();}
  },true);

  const editOverlay = el('editOverlay');
  const editScrimTop = el('editScrimTop');
  const editScrimBottom = el('editScrimBottom');
  const editScrimLeft = el('editScrimLeft');
  const editScrimRight = el('editScrimRight');
  const editHint = el('editHint');

  /* 설정 / 사진 조정 tabs sharing one panel, instead of a separate card that pops up
     beside/under the preview. Clicking a photo's adjust button switches to the 사진
     조정 tab automatically; leaving edit mode switches back to 설정. */
  const controlTabs = el('controlTabs');
  const settingsTabContent = el('settingsTabContent');
  const adjustTabContent = el('adjustTabContent');
  const adjustEmptyState = el('adjustEmptyState');
  const adjustFieldsWrap = el('adjustFieldsWrap');
  const previewAdjustDock = el('previewAdjustDock');
  const controlsPanel = controlTabs.closest('.panel');
  function placeAdjustPanel(){
    const desktop = !window.matchMedia('(max-width:700px)').matches;
    if (desktop) {
      if (adjustTabContent.parentElement !== previewAdjustDock) previewAdjustDock.appendChild(adjustTabContent);
    } else {
      if (adjustTabContent.parentElement !== controlsPanel) controlsPanel.appendChild(adjustTabContent);
    }
  }
  placeAdjustPanel();
  function setActiveTab(tab){
    placeAdjustPanel();
    const desktop = !window.matchMedia('(max-width:700px)').matches;
    controlTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    // PC에서는 설정은 왼쪽에 계속 유지하고 사진 조정만 헤더 도크에 띄운다.
    settingsTabContent.hidden = desktop ? false : tab !== 'settings';
    adjustTabContent.hidden = tab !== 'adjust';
    previewAdjustDock.hidden = !(desktop && tab === 'adjust');
    document.getElementById('photosCol').classList.toggle('adjust-mode', !desktop && tab === 'adjust');
    requestAnimationFrame(() => { syncPhotoListHeight(); schedulePreviewFit(); });
  }
  controlTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    setActiveTab(btn.dataset.tab);
  });
  const zoomRange = el('zoomRange');
  const zoomVal = el('zoomVal');
  const rotRange = el('rotRange');
  const rotVal = el('rotVal');
  const skewVRange = el('skewVRange');
  const skewVVal = el('skewVVal');
  const skewHRange = el('skewHRange');
  const skewHVal = el('skewHVal');
  const replacePhotoBtn = el('replacePhotoBtn');
  const resetPhotoBtn = el('resetPhotoBtn');
  const replaceInput = el('replaceInput');
  let editingId = null;

  function renderNow(){
    clearTimeout(renderTimer);
    if (liveRenderFrame) {
      cancelAnimationFrame(liveRenderFrame);
      liveRenderFrame = 0;
    }
    renderComposite();
  }
  // Interactive redraw for continuous drag/pinch/slider feedback. Pointer events can
  // arrive faster than the display refreshes, especially during iPhone pinch gestures,
  // so coalesce them to one canvas render per animation frame.
  function renderLive(){
    clearTimeout(renderTimer);
    if (liveRenderFrame) return;
    liveRenderFrame = requestAnimationFrame(() => {
      liveRenderFrame = 0;
      renderComposite({ live: true });
    });
  }

  function zToPercent(z){ return Math.round(clamp((z - 1) / (MAX_ZOOM - 1), 0, 1) * 100); }
  function percentToZ(pct){ return 1 + (clamp(pct, 0, 100) / 100) * (MAX_ZOOM - 1); }

  function syncRotSlider(){
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry || !entry.crop) return;
    rotRange.value = -(entry.crop.rot || 0);
    rotVal.textContent = Math.round(-(entry.crop.rot || 0)) + '°';
  }

  function syncZoomSlider(){
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry || !entry.crop) return;
    const pct = zToPercent(entry.crop.z);
    zoomRange.value = pct;
    zoomVal.textContent = pct + '%';
  }

  function syncAdjustPanel(){
    editHint.hidden = !editingId;
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry || !entry.crop) return;
    syncZoomSlider();
    const c = entry.crop;
    rotRange.value = -(c.rot || 0);
    rotVal.textContent = Math.round(-(c.rot || 0)) + '°';
    skewVRange.value = c.skewV || 0;
    skewVVal.textContent = Math.round(c.skewV || 0);
    skewHRange.value = c.skewH || 0;
    skewHVal.textContent = Math.round(c.skewH || 0);
  }

  function enterEdit(id){
    const entry = photos.find(p => p.id === id);
    if (!entry) return;
    if (!entry.crop) entry.crop = defaultCrop();
    editingId = id;
    editHint.hidden = false;
    adjustEmptyState.hidden = true;
    adjustFieldsWrap.hidden = false;
    setActiveTab('adjust');
    syncAdjustPanel();
    renderList();
    scrollSelectedPhotoIntoView(id);
    renderNow();
    // 이미 보이는 상태면 스크롤하지 않는다 (선택할 때마다 창이 흔들리던 원인)
    previewStage.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  function exitEdit(){
    if (!editingId) return;
    editingId = null;
    editOverlay.hidden = true;
    editScrimTop.hidden = true;
    editScrimBottom.hidden = true;
    editScrimLeft.hidden = true;
    editScrimRight.hidden = true;
    editHint.hidden = true;
    adjustFieldsWrap.hidden = true;
    adjustEmptyState.hidden = false;
    setActiveTab('settings');
    renderList();
    syncPreviewInsertButtons(); // 조정 모드를 빠져나오면 좌우 + 버튼을 다시 보여준다
    requestAnimationFrame(applyPreviewZoom);
  }

  function positionEditOverlay(){
    const slot = lastSlots.find(s => s.id === editingId);
    if (!slot || !canvas.clientWidth) { exitEdit(); return; }
    const scale = canvas.clientWidth / canvas.width;
    const left = slot.x * scale, top = slot.y * scale, width = slot.w * scale, height = slot.h * scale;
    editOverlay.style.left = left + 'px';
    editOverlay.style.top = top + 'px';
    editOverlay.style.width = width + 'px';
    editOverlay.style.height = height + 'px';
    editOverlay.hidden = false;

    // dim everything outside the edited slot with four real rectangles (a band each on
    // top/bottom/left/right) rather than the old box-shadow-spread trick, which didn't
    // render its dimming at all in some mobile browsers and left only a stray border.
    const wrapW = canvasWrap.clientWidth, wrapH = canvasWrap.clientHeight;
    editScrimTop.style.left = '0px';
    editScrimTop.style.top = '0px';
    editScrimTop.style.width = wrapW + 'px';
    editScrimTop.style.height = Math.max(0, top) + 'px';
    editScrimTop.hidden = false;

    editScrimBottom.style.left = '0px';
    editScrimBottom.style.top = (top + height) + 'px';
    editScrimBottom.style.width = wrapW + 'px';
    editScrimBottom.style.height = Math.max(0, wrapH - (top + height)) + 'px';
    editScrimBottom.hidden = false;

    editScrimLeft.style.left = '0px';
    editScrimLeft.style.top = top + 'px';
    editScrimLeft.style.width = Math.max(0, left) + 'px';
    editScrimLeft.style.height = height + 'px';
    editScrimLeft.hidden = false;

    editScrimRight.style.left = (left + width) + 'px';
    editScrimRight.style.top = top + 'px';
    editScrimRight.style.width = Math.max(0, wrapW - (left + width)) + 'px';
    editScrimRight.style.height = height + 'px';
    editScrimRight.hidden = false;
  }

  el('editDoneBtn').addEventListener('click', (e) => { e.stopPropagation(); exitEdit(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && editingId) exitEdit(); });
  previewStage.addEventListener('click', (e) => {
    // Controls belonging to the active edit overlay keep their own behavior.
    if (e.target.closest?.('.edit-done, .edit-handle, .edit-rotate-zone')) return;

    // A real drag/pinch is an adjustment, not a deselection click.
    if (dragMoved) return;

    // 사진 조정 중에는 미리보기의 어느 곳을 클릭해도 선택 취소.
    // 예전처럼 회색 여백/간격을 정확히 눌러야 할 필요가 없다.
    if (editingId) { exitEdit(); return; }

    // 선택된 사진이 없을 때 미리보기 속 사진을 클릭하면 조정 대상으로 선택한다.
    const rect = canvas.getBoundingClientRect();
    const insideCanvas = photos.length && rect.width && rect.height &&
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (insideCanvas) {
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const slot = lastSlots.find(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
      if (slot) { enterEdit(slot.id); return; }
      return; // 사진 사이 간격은 삽입 클릭으로 쓰지 않는다.
    }

    // 방향과 관계없이 회색 미리보기의 좌/우 여백으로 양 끝에 사진 추가.
    // 왼쪽 여백 = 맨 앞(세로 잇기에서는 위), 오른쪽 여백 = 맨 뒤(세로 잇기에서는 아래).
    // 세로 잇기에서도 위/아래 여백은 추가 영역으로 쓰지 않아 조작 규칙을 통일한다.
    if (photos.length && rect.width && rect.height) {
      let insertIndex = null;
      if (e.clientX < rect.left) insertIndex = 0;
      else if (e.clientX > rect.right) insertIndex = photos.length;
      if (insertIndex !== null) {
        openPreviewInsertPicker(insertIndex);
      }
    }
  });

  // sliders fire 'input' continuously while being dragged and one final 'change' on
  // release — interactive preview during the drag, then one final settle render.
  function commitCrop(){ renderNow(); pushHistory(); }
  zoomRange.addEventListener('input', () => {
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry) return;
    if (!entry.crop) entry.crop = defaultCrop();
    entry.crop.z = percentToZ(Number(zoomRange.value));
    zoomVal.textContent = Math.round(Number(zoomRange.value)) + '%';
    renderLive();
  });
  zoomRange.addEventListener('change', commitCrop);
  rotRange.addEventListener('input', () => {
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry) return;
    if (!entry.crop) entry.crop = defaultCrop();
    entry.crop.rot = -Number(rotRange.value);
    rotVal.textContent = rotRange.value + '°';
    renderLive();
  });
  rotRange.addEventListener('change', commitCrop);
  skewVRange.addEventListener('input', () => {
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry) return;
    if (!entry.crop) entry.crop = defaultCrop();
    entry.crop.skewV = Number(skewVRange.value);
    skewVVal.textContent = skewVRange.value;
    renderLive();
  });
  skewVRange.addEventListener('change', commitCrop);
  skewHRange.addEventListener('input', () => {
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry) return;
    if (!entry.crop) entry.crop = defaultCrop();
    entry.crop.skewH = Number(skewHRange.value);
    skewHVal.textContent = skewHRange.value;
    renderLive();
  });
  skewHRange.addEventListener('change', commitCrop);
  resetPhotoBtn.addEventListener('click', () => {
    if (!editingId) return;
    const entry = photos.find(p => p.id === editingId);
    if (!entry) return;
    entry.crop = defaultCrop();
    renderNow();
    syncAdjustPanel();
    pushHistory();
  });

  replacePhotoBtn.addEventListener('click', () => {
    if (!editingId) return;
    replaceInput.click();
  });
  replaceInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    replaceInput.value = '';
    if (!file || !file.type.startsWith('image/') || !editingId) return;
    const oldId = editingId;
    try {
      const decoded = await decodeImageFile(file);
      // a fresh id (not overwriting oldId's store entry) so undo can still restore it
      const newId = uid();
      store.set(newId, { img: decoded.img, w: decoded.w, h: decoded.h, name: file.name, thumb: makeThumb(decoded.img, decoded.w, decoded.h), effCache: {} });
      const idx = photos.findIndex(p => p.id === oldId);
      if (idx !== -1) photos[idx] = { id: newId, rotation: 0, crop: null };
      editingId = newId;
      if (settings.commonAuto) recomputeCommonSize();
      syncFitModeUI();
      syncAdvancedState();
      renderList();
      renderNow();
      syncAdjustPanel();
      pushHistory();
    } catch (_) {}
  });

  /* ---------- global eye-level guide (one line across the whole composite) ---------- */
  const eyeGuide = el('eyeGuide');
  const eyeGuideToggle = el('eyeGuideToggle');
  const eyeGuideHandle = el('eyeGuideHandle');
  let eyeGuideOn = false;
  let eyeLevel = EYE_LEVEL;

  function positionEyeGuide(){
    if (!eyeGuideOn || canvas.hidden || !canvas.clientHeight) { eyeGuide.hidden = true; return; }
    eyeGuide.hidden = false;
    eyeGuide.style.top = (eyeLevel * canvas.clientHeight) + 'px';
    eyeGuide.style.width = canvas.clientWidth + 'px';
  }

  eyeGuideToggle.addEventListener('click', () => {
    eyeGuideOn = !eyeGuideOn;
    eyeGuideToggle.classList.toggle('on', eyeGuideOn);
    positionEyeGuide();
  });

  // 미리보기 배율: PC 기본은 화면 맞춤(Fit). 저장 픽셀에는 영향 없음.
  let previewZoomMode = 'fit', previewZoomPct = 100;
  function applyPreviewZoom(){
    canvasWrap.style.width='';
    canvasWrap.style.maxWidth='100%';
    const verticalPreview = settings.direction === 'vertical';
    previewStage.classList.toggle('vertical-preview', verticalPreview);
    previewStage.style.overflowY = (verticalPreview && editingId) ? 'auto' : 'hidden';
    if(canvas.hidden||!canvas.width||!canvas.height)return;
    const st=getComputedStyle(previewStage);
    const availW=Math.max(1,previewStage.clientWidth-(parseFloat(st.paddingLeft)||0)-(parseFloat(st.paddingRight)||0));
    const availH=Math.max(1,previewStage.clientHeight-(parseFloat(st.paddingTop)||0)-(parseFloat(st.paddingBottom)||0));

    if(verticalPreview){
      // 세로 잇기에서도 상단의 맞춤 / 100 / 80 / 60 / 40 배율을 그대로 적용한다.
      // 맞춤은 평상시에는 전체 결과를 팔레트에 맞추고, 사진 조정 중에는 선택 사진이
      // 작업하기 좋은 크기로 보이도록 맞춘다. 수동 배율을 누르면 조정 중에도 그 값을 우선한다.
      if(previewZoomMode==='fit'){
        if(editingId){
          const slot=lastSlots.find(s=>s.id===editingId);
          const byWidth=(availW*0.72)/canvas.width;
          const bySelected=slot && slot.h ? (availH*0.82)/slot.h : byWidth;
          const sc=Math.min(1,byWidth,bySelected);
          canvasWrap.style.width=Math.max(1,Math.floor(canvas.width*sc))+'px';
        }else{
          const sc=Math.min(1,availW/canvas.width,availH/canvas.height);
          canvasWrap.style.width=Math.max(1,Math.floor(canvas.width*sc))+'px';
        }
      }else{
        // 세로 결과는 길이가 길어도 100%가 팔레트 가로폭을 기준으로 동작하도록 한다.
        // 80/60/40은 그 폭의 비율이며, 세로 스크롤로 위아래를 확인할 수 있다.
        const pct=Math.min(100,previewZoomPct)/100;
        canvasWrap.style.width=Math.max(1,Math.floor(availW*pct))+'px';
        previewStage.style.overflowY='auto';
      }
      return;
    }

    // 가로 잇기는 기존처럼 결과 전체가 회색 프레임 안에 들어오도록 맞춤.
    if(previewZoomMode==='fit'){
      const sc=Math.min(1,availW/canvas.width,availH/canvas.height);
      canvasWrap.style.width=Math.max(1,Math.floor(canvas.width*sc))+'px';
      return;
    }
    const naturalW=Math.min(canvas.width,availW);
    canvasWrap.style.width=Math.max(1,Math.floor(naturalW*Math.min(100,previewZoomPct)/100))+'px';
  }
  const previewZoomSeg=el('previewZoomSeg');
  previewZoomSeg.addEventListener('click',e=>{
    const btn=e.target.closest('button'); if(!btn)return;
    setActiveSeg(previewZoomSeg,btn.dataset.val);
    if(btn.dataset.val==='fit')previewZoomMode='fit';
    else{previewZoomMode='manual';previewZoomPct=Number(btn.dataset.val);}
    applyPreviewZoom();
    if(editingId)positionEditOverlay();
    if(eyeGuideOn)positionEyeGuide();
  });

  let eyeDragging = false;
  eyeGuideHandle.addEventListener('pointerdown', (e) => {
    eyeDragging = true;
    e.stopPropagation();
    try { eyeGuideHandle.setPointerCapture(e.pointerId); } catch (err) {}
  });
  eyeGuideHandle.addEventListener('pointermove', (e) => {
    if (!eyeDragging) return;
    const rect = canvasWrap.getBoundingClientRect();
    if (!rect.height) return;
    eyeLevel = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    positionEyeGuide();
  });
  function endEyeDrag(){ eyeDragging = false; }
  eyeGuideHandle.addEventListener('pointerup', endEyeDrag);
  eyeGuideHandle.addEventListener('pointercancel', endEyeDrag);

  let lastClickX = 0, lastClickY = 0, dragMoved = false;
  canvas.addEventListener('pointerdown', (e) => { lastClickX = e.clientX; lastClickY = e.clientY; dragMoved = false; });
  canvas.addEventListener('click', (e) => {
    if (dragMoved) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = (lastClickX - rect.left) * scale, y = (lastClickY - rect.top) * scale;
    const slot = lastSlots.find(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    if (slot) {
      e.stopPropagation();
      enterEdit(slot.id);
    }
    // No slot: allow bubbling to previewStage, which clears the selection.
  });

  /* ---------- Canvas editing gestures ---------- */
  (() => {
  function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b){ return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function currentEditCtx(){
    if (!editingId) return null;
    const entry = photos.find(p => p.id === editingId);
    const rec = store.get(editingId);
    if (!entry || !rec) return null;
    const eff = getEffectiveImage(rec, entry.rotation);
    const AR = slotARFor(eff);
    const slot = lastSlots.find(s => s.id === editingId);
    if (!slot) return null;
    const cssScale = canvas.clientWidth / canvas.width;
    return { entry, eff, AR, slot, cssScale };
  }

  const activePointers = new Map();
  let gesture = null;
  let editGestureDirty = false;

  editOverlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.edit-done, .edit-handle, .edit-rotate-zone')) return;
    if (activePointers.size === 0) {
      editGestureDirty = false;
      dragMoved = false;
    }
    editOverlay.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ctx = currentEditCtx();
    if (!ctx) return;
    if (activePointers.size === 1) {
      gesture = { mode: 'pan', x: e.clientX, y: e.clientY, cx: ctx.entry.crop.cx, cy: ctx.entry.crop.cy, z: ctx.entry.crop.z };
    } else if (activePointers.size === 2) {
      const pts = [...activePointers.values()];
      gesture = { mode: 'pinch', dist: dist(pts[0], pts[1]), z: ctx.entry.crop.z, mid: mid(pts[0], pts[1]), cx: ctx.entry.crop.cx, cy: ctx.entry.crop.cy };
    }
  });
  editOverlay.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ctx = currentEditCtx();
    if (!ctx || !gesture) return;
    dragMoved = true;
    editGestureDirty = true;
    const win0 = computeCropWindow(ctx.eff, ctx.AR, { z: gesture.z, cx: gesture.cx, cy: gesture.cy });
    const SdispCss = (ctx.slot.w * ctx.cssScale) / win0.winW;
    if (activePointers.size === 1 && gesture.mode === 'pan') {
      const dxs = e.clientX - gesture.x, dys = e.clientY - gesture.y;
      ctx.entry.crop.cx = gesture.cx - (dxs / SdispCss) / ctx.eff.w;
      ctx.entry.crop.cy = gesture.cy - (dys / SdispCss) / ctx.eff.h;
      renderLive();
    } else if (activePointers.size === 2 && gesture.mode === 'pinch') {
      const pts = [...activePointers.values()];
      const d = dist(pts[0], pts[1]);
      ctx.entry.crop.z = clamp(gesture.z * (d / gesture.dist), 1, MAX_ZOOM);
      const m = mid(pts[0], pts[1]);
      ctx.entry.crop.cx = gesture.cx - ((m.x - gesture.mid.x) / SdispCss) / ctx.eff.w;
      ctx.entry.crop.cy = gesture.cy - ((m.y - gesture.mid.y) / SdispCss) / ctx.eff.h;
      syncZoomSlider();
      renderLive();
    }
  });
  function endEditPointer(e){
    activePointers.delete(e.pointerId);
    const ctx = currentEditCtx();
    if (!ctx) {
      gesture = null;
      if (editGestureDirty) { renderNow(); pushHistory(); }
      return;
    }
    if (activePointers.size === 1) {
      const [pos] = activePointers.values();
      gesture = { mode: 'pan', x: pos.x, y: pos.y, cx: ctx.entry.crop.cx, cy: ctx.entry.crop.cy, z: ctx.entry.crop.z };
      return;
    }
    gesture = null;
    if (editGestureDirty) { renderNow(); pushHistory(); }
  }
  editOverlay.addEventListener('pointerup', endEditPointer);
  editOverlay.addEventListener('pointercancel', endEditPointer);
  let wheelCommitTimer = null;
  editOverlay.addEventListener('wheel', (e) => {
    const ctx = currentEditCtx();
    if (!ctx) return;
    e.preventDefault();
    // PC trackpad pinch is delivered as a ctrl/meta-modified wheel event in Chromium/Safari.
    // Make pinch about 1.8x more responsive, while preserving the existing mouse-wheel /
    // ordinary two-finger scroll zoom sensitivity.
    const wheelSensitivity = (e.ctrlKey || e.metaKey) ? 0.0045 : 0.0018;
    const factor = Math.exp(-e.deltaY * wheelSensitivity);
    ctx.entry.crop.z = clamp(ctx.entry.crop.z * factor, 1, MAX_ZOOM);
    syncZoomSlider();
    renderLive();
    // wheel fires many events per scroll gesture — wait for a pause before treating
    // it as one committed history step (and doing the one full-quality settle render),
    // instead of doing that on every tiny tick
    clearTimeout(wheelCommitTimer);
    wheelCommitTimer = setTimeout(() => { renderNow(); pushHistory(); }, 400);
  }, { passive: false });

  /* corner handles: drag toward/away from the slot center to zoom with the mouse */
  document.querySelectorAll('.edit-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      const ctx0 = currentEditCtx();
      if (!ctx0) return;
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const rect = editOverlay.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
      const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1;
      const startZ = ctx0.entry.crop.z;
      function onMove(ev){
        const c = currentEditCtx();
        if (!c) return;
        const d = Math.hypot(ev.clientX - centerX, ev.clientY - centerY);
        c.entry.crop.z = clamp(startZ * (d / startDist), 1, MAX_ZOOM);
        syncZoomSlider();
        renderLive();
      }
      function onUp(){
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        renderNow();
        pushHistory();
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });

  /* corner straighten/rotate zones: on touch these are the ONLY one-finger corner action; arc around the photo's
     center to rotate — same crop.rot value (and same -45~45 range) as the 똑바르게
     slider, just a more direct/tactile way to reach it */
  document.querySelectorAll('.edit-rotate-zone').forEach((zone) => {
    zone.addEventListener('pointerdown', (e) => {
      const ctx0 = currentEditCtx();
      if (!ctx0) return;
      e.stopPropagation();
      zone.setPointerCapture(e.pointerId);
      zone.classList.add('active');
      const rect = editOverlay.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      const startRot = ctx0.entry.crop.rot || 0;
      function onMove(ev){
        const c = currentEditCtx();
        if (!c) return;
        const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * 180 / Math.PI;
        let delta = angle - startAngle;
        // keep the delta within a half-turn either way so a wide arc never wraps/jumps
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        c.entry.crop.rot = clamp(startRot - delta, -45, 45);
        syncRotSlider();
        renderLive();
      }
      function onUp(){
        zone.removeEventListener('pointermove', onMove);
        zone.removeEventListener('pointerup', onUp);
        zone.classList.remove('active');
        renderNow();
        pushHistory();
      }
      zone.addEventListener('pointermove', onMove);
      zone.addEventListener('pointerup', onUp);
    });
  });
  })();

  /* ---------- keyboard shortcuts ----------
     Only act on the currently selected/adjusted photo (editingId).
     Never hijack typing inside inputs or contenteditable elements. */
  function shortcutTypingTarget(target){
    return !!(target && (
      target.matches?.('input, textarea, select, button') ||
      target.isContentEditable
    ));
  }

  function removeSelectedPhotoByShortcut(){
    if(!editingId) return false;
    const idx=photos.findIndex(p=>p.id===editingId);
    if(idx<0) return false;
    const removedId=editingId;
    // Tear down the edit UI BEFORE removing the selected photo.
    // Otherwise the overlay can survive one render with stale geometry after Delete/Backspace.
    exitEdit();
    photos.splice(idx,1);
    if(store.has(removedId) && !photos.some(p=>p.id===removedId)) {
      // Keep store bytes available for undo/history, matching existing removal behavior.
    }
    if(settings.commonAuto) recomputeCommonSize();
    renderList();
    renderNow();
    syncAdjustPanel();
    setActiveTab('settings');
    pushHistory();
    return true;
  }

  function moveSelectedPhotoByShortcut(delta){
    if(!editingId || photos.length<2) return false;
    const from=photos.findIndex(p=>p.id===editingId);
    if(from<0) return false;
    const to=clamp(from+delta,0,photos.length-1);
    if(to===from) return true;
    const [item]=photos.splice(from,1);
    photos.splice(to,0,item);
    if(settings.commonAuto) recomputeCommonSize();
    renderList();
    renderNow();
    scrollSelectedPhotoIntoView(editingId);
    pushHistory();
    return true;
  }

  window.addEventListener('keydown',(e)=>{
    if(shortcutTypingTarget(e.target)) return;

    // Delete / Backspace: delete selected photo.
    if((e.key==='Delete' || e.key==='Backspace') && editingId && !e.metaKey && !e.ctrlKey && !e.altKey){
      e.preventDefault();
      removeSelectedPhotoByShortcut();
      return;
    }

    // Shift + arrows: reorder selected photo.
    // Horizontal join uses ←/→ naturally; vertical join also accepts ↑/↓.
    if(e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && editingId){
      let delta=0;
      if(e.key==='ArrowLeft' || e.key==='ArrowUp') delta=-1;
      if(e.key==='ArrowRight' || e.key==='ArrowDown') delta=1;
      if(delta){
        e.preventDefault();
        moveSelectedPhotoByShortcut(delta);
      }
    }
  });

  /* ---------- export ----------
     Mobile uses the native share sheet when file sharing is available; every other
     environment falls back to the host download bridge or a standard download link. */
  let preparedShare = null; // { blob, filename, key } from a tap whose activation expired
  function currentRenderKey(){
    return lastRender.full.w + 'x' + lastRender.full.h + '|' + settings.format + '|' +
      photos.map(p => p.id + ':' + p.rotation + ':' + JSON.stringify(p.crop)).join(',');
  }
  async function finishWithDownloads(blob, filename){
    if (!downloadsNS) {
      try { if (window.claude && window.claude.use) downloadsNS = await window.claude.use('downloads'); } catch(e) {}
    }
    if (downloadsNS) {
      try {
        await downloadsNS.save({ filename, data: blob });
      } catch (err) {
        if (err && err.code === 'declined') return;
        showToast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }
    // Regular browser fallback when no host download bridge is available.
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      showToast('이 화면에서는 저장 기능을 사용할 수 없어요. 다른 환경에서 다시 시도해 주세요.');
    }
  }

  exportBtn.addEventListener('click', async () => {
    if (photos.length === 0) return;
    const mime = settings.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = settings.format === 'jpeg' ? 'jpg' : 'png';
    // Keep desktop on the normal download path; touch devices may use the share sheet.
    const isMobileShareTarget =
      window.matchMedia('(pointer:coarse)').matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const canShareFiles = isMobileShareTarget && !!(navigator.share && navigator.canShare);

    // The prepared file is shared synchronously on a second tap to preserve user activation.
    if (canShareFiles && preparedShare && preparedShare.key === currentRenderKey()) {
      const { blob, filename } = preparedShare;
      preparedShare = null;
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      await finishWithDownloads(blob, filename);
      return;
    }

    exportBtn.disabled = true;
    const prevLabel = exportLabel.textContent;
    exportLabel.textContent = '저장 중…';
    // '저장 중…'이 먼저 화면에 그려지도록 한 프레임 쉬고 원본 해상도로 그린다.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const outCanvas = renderFullResolution();

    outCanvas.toBlob(async (blob) => {
      exportBtn.disabled = false;
      exportLabel.textContent = prevLabel;
      outCanvas.width = outCanvas.height = 0; // 큰 캔버스 메모리 바로 반납
      if (!blob) return;
      sizeReadout.textContent = formatBytes(blob.size);
      const stamp = new Date();
      const pad = n => String(n).padStart(2,'0');
      const filename = `photojoin_${stamp.getFullYear()}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}.${ext}`;
      const file = new File([blob], filename, { type: mime });

      if (canShareFiles && navigator.canShare({ files: [file] })) {
        const stillActive = !navigator.userActivation || navigator.userActivation.isActive;
        if (!stillActive) {
          preparedShare = { blob, filename, key: currentRenderKey() };
          showToast('저장 준비가 끝났어요. 저장 버튼을 한 번 더 눌러주세요.');
          return;
        }
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // user closed the share sheet
          // any other failure falls through to the downloads capability below
          // instead of dead-ending here
        }
      }

      await finishWithDownloads(blob, filename);
    }, mime, EXPORT_QUALITY);
  });


  // iOS Safari는 touch-action만으로 화면 확대가 완전히 막히지 않는 경우가 있어
  // 화면 확대 제스처(gesture*) 자체를 막는다. 사진 조정의 두 손가락 확대는
  // pointer 이벤트로 따로 처리하므로 이 코드와 무관하게 계속 동작한다.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  });

  /* ---------- viewport fit ----------
     Keep the whole workspace visible by giving the preview exactly the remaining
     viewport height after measuring the real elements below it. */
  function fitPreviewToViewport(){
    if(window.matchMedia('(max-width:700px)').matches){
      document.documentElement.style.removeProperty('--preview-fit-height');
      return;
    }

    const stageRect = previewStage.getBoundingClientRect();
    const previewPanel = previewStage.closest('.panel');
    if(!previewPanel) return;

    // IMPORTANT: never use document.body.bottom here.
    // The left photo/settings column can become taller when photos are added; measuring the
    // whole page made that unrelated height look like "content below the preview", so the
    // gray preview stage shrank every time the photo list/settings grew.
    // Measure ONLY the preview column's own fixed chrome below the stage instead.
    const privacy = previewPanel.querySelector('.privacy-note');
    const tail = privacy || previewPanel.querySelector('.shortcut-note') || previewPanel.querySelector('.export-row');
    const tailRect = tail ? tail.getBoundingClientRect() : stageRect;
    const panelStyle = getComputedStyle(previewPanel);
    const panelBottomPad = parseFloat(panelStyle.paddingBottom) || 0;
    const contentBelow = Math.max(0, tailRect.bottom - stageRect.bottom) + panelBottomPad;

    // Reserve only the page's normal bottom breathing room. This value is independent of
    // the photo count and the height of the left column, so Fit stays visually stable.
    const safety = 8;
    // 문서 기준 위치로 계산해야 스크롤 위치에 따라 미리보기 크기가 달라지지 않는다.
    const stageTop = stageRect.top + window.scrollY;
    const available = Math.floor(window.innerHeight - stageTop - contentBelow - safety);

    // Keep the drop target usable on short windows, but otherwise consume all
    // available space. No device-specific Mac/iPad/Windows breakpoints.
    const fitted = Math.max(220, available);
    document.documentElement.style.setProperty('--preview-fit-height', fitted + 'px');

    requestAnimationFrame(() => {
      applyPreviewZoom();
      if(editingId) positionEditOverlay();
    });
  }

  let fitPreviewRAF = 0;
  function schedulePreviewFit(){
    cancelAnimationFrame(fitPreviewRAF);
    fitPreviewRAF = requestAnimationFrame(fitPreviewToViewport);
  }

  /* One layout pass per frame keeps resize, orientation changes, and mobile browser
     chrome changes from repeatedly measuring and redrawing the same canvas. */
  let layoutChangeRAF = 0;
  function handleLayoutChange(){
    cancelAnimationFrame(layoutChangeRAF);
    layoutChangeRAF = requestAnimationFrame(() => {
      // 창이 넓어져 미리보기 해상도가 부족해지면 다시 그린다.
      if (photos.length && previewTargetWidth() > lastPreviewTargetW) scheduleRender();
      placeAdjustPanel();
      syncPhotoListHeight();
      schedulePreviewFit();
      applyPreviewZoom();
      if (editingId) positionEditOverlay();
      if (eyeGuideOn) positionEyeGuide();
    });
  }

  window.addEventListener('resize', handleLayoutChange, {passive:true});
  window.addEventListener('orientationchange', handleLayoutChange, {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', handleLayoutChange, {passive:true});
  }

  /* ---------- init ---------- */
  updateCommonAutoLabel();
  ratioCustomRow.hidden = settings.ratio !== 'custom';
  ratioCustomHint.hidden = settings.ratio !== 'custom';
  renderComposite();
  pushHistory(); // baseline (empty) state so the very first add can be undone back to nothing
  requestAnimationFrame(handleLayoutChange);

  if (window.claude && window.claude.hot) {
    window.claude.hot.ready ? window.claude.hot.ready(() => {}) : null;
  }
})();


  // 왼쪽 사진 추가 영역은 '클릭해서 열기' 전용.
  // 왼쪽 목록 내부의 기존 사진 드래그 정렬은 건드리지 않는다.
  (function(){
    const dz=document.getElementById('dropzone');
    if(!dz)return;

    // 안내 문구가 있다면 드래그 관련 표현을 제거하고 클릭 중심으로 바꾼다.
    const walker=document.createTreeWalker(dz,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(n=>{
      n.nodeValue=n.nodeValue
        .replace(/드래그\s*(?:하거나|또는|&|·)?\s*/g,'')
        .replace(/여기에\s*놓으세요/g,'클릭해서 사진 열기');
    });

    // OS 파일을 왼쪽 추가 영역에 놓아도 사진을 추가하지 않는다.
    // stopImmediatePropagation으로 기존 dropzone의 drop 핸들러까지 막는다.
    ['dragenter','dragover','drop'].forEach(type=>{
      dz.addEventListener(type,e=>{
        const dt=e.dataTransfer;
        const isFiles=dt && (Array.from(dt.types||[]).includes('Files') || (dt.files&&dt.files.length));
        if(!isFiles)return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if(type==='dragover' && dt)dt.dropEffect='none';
      },true);
    });
  })();



