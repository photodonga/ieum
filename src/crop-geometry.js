// Crop geometry extracted without changing the original calculation.
/* crop window in the *effective* (rotation-baked) image's own pixel space */
function computeCropWindow(eff, AR, crop, clamp, MAX_ZOOM){
  const sourceAR = eff.w / eff.h;
  let winW0, winH0;
  if (sourceAR > AR) { winH0 = eff.h; winW0 = eff.h * AR; }
  else { winW0 = eff.w; winH0 = eff.w / AR; }
  const z = clamp(crop.z, 1, MAX_ZOOM);
  const winW = winW0 / z, winH = winH0 / z;
  let cx = clamp(crop.cx, 0, 1) * eff.w;
  let cy = clamp(crop.cy, 0, 1) * eff.h;
  cx = clamp(cx, winW / 2, eff.w - winW / 2);
  cy = clamp(cy, winH / 2, eff.h - winH / 2);
  return { winW, winH, srcX: cx - winW / 2, srcY: cy - winH / 2, cxNorm: cx / eff.w, cyNorm: cy / eff.h };
}


export { computeCropWindow };
