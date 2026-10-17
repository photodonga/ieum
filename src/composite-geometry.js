// Pure geometry and output sizing logic extracted from the original Ieum app.
// No DOM access. Caller supplies current settings and crop calculation.
function resolveOutputScale(items, compositeLong, settings, computeCropWindow){
  let finalScale, target;
  if (settings.outputMode === 'original') {
    // "최대 크기"는 가장 해상도가 넉넉한 사진을 기준으로 정한다. 편집된 크롭은
    // 출력 전체 크기에 영향을 주지 않고, 해당 슬롯의 화질에만 영향을 준다.
    let referenceNativeScale = 0;
    items.forEach((it) => {
      const cropForScale = { ...it.p.crop, z:1, cx:.5, cy:.5, rot:0, skewV:0, skewH:0 };
      const win = computeCropWindow(it.eff, it.AR, cropForScale);
      const baseW = settings.direction === 'vertical' ? it.slotCross : it.slotLong;
      const baseH = settings.direction === 'vertical' ? it.slotLong : it.slotCross;
      const nativeScale = Math.min(win.winW / baseW, win.winH / baseH);
      if (Number.isFinite(nativeScale) && nativeScale > 0) referenceNativeScale = Math.max(referenceNativeScale, nativeScale);
    });
    finalScale = referenceNativeScale > 0 ? referenceNativeScale : 1;
    target = compositeLong * finalScale;
  } else {
    target = settings.outputMode === 'custom' ? settings.outputCustom : settings.outputPreset;
    finalScale = target / compositeLong;
  }
  return { finalScale, target };
}

function resolveCompositeGeometry(items, commonSize, settings, computeCropWindow, OUTPUT_GAP_RATIOS){
  const slotLongSum = items.reduce((s, it) => s + it.slotLong, 0);
  const n = items.length;
  let spacing = 0, compositeLong = slotLongSum;
  const compositeCross = commonSize;
  let { finalScale, target } = resolveOutputScale(items, compositeLong, settings, computeCropWindow);
  // 간격은 '사진/프레임 크기'가 아니라 최종 결과물의 긴 축에 비례.
  // 목표 긴 축에서 원하는 gap px를 먼저 정한 뒤, 내부 좌표계 spacing으로 역산한다.
  if (settings.spacingMode !== 'none' && n > 1) {
    const ratio = OUTPUT_GAP_RATIOS[settings.spacingMode] || 0;
    const desiredGapPx = Math.max(1, target * ratio);
    spacing = desiredGapPx / finalScale;
    compositeLong = slotLongSum + spacing * (n - 1);

    // 간격이 추가되면 합성 긴 축도 늘어나므로 preset/custom에서는 최종 긴 축이
    // 사용자가 고른 출력값을 유지하도록 scale을 한 번 재계산한다.
    if (settings.outputMode !== 'original') {
      finalScale = target / compositeLong;
      // 재계산된 scale에서도 gap 비율을 정확히 맞추도록 한 번 수렴.
      spacing = (target * ratio) / finalScale;
      compositeLong = slotLongSum + spacing * (n - 1);
      finalScale = target / compositeLong;
    }
  }
  return { spacing, finalScale, finalLong: Math.max(1, Math.round(compositeLong * finalScale)), finalCross: Math.max(1, Math.round(compositeCross * finalScale)) };
}


export { resolveOutputScale, resolveCompositeGeometry };
