// Image transform mathematics extracted from the original Ieum implementation.
function rotMatrix(rotDeg, clamp){
  const rad = clamp(rotDeg, -45, 45) * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos };
}

function computeOverscale(a, b, c, d, W, H){
  const det = a * d - b * c;
  if (!det) return 1;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  const hw = W / 2, hh = H / 2;
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  let maxX = 0, maxY = 0;
  corners.forEach(([x, y]) => {
    const tx = Math.abs(ia * x + ib * y);
    const ty = Math.abs(ic * x + id * y);
    if (tx > maxX) maxX = tx;
    if (ty > maxY) maxY = ty;
  });
  return Math.max((2 * maxX) / W, (2 * maxY) / H, 1);
}

export { rotMatrix, computeOverscale };
