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

// solves for the unique affine matrix [a b c d e f] that sends source triangle S
// (3 points) exactly onto destination triangle D (3 points) — see check_perspective.py
// for the numeric derivation/verification. Any 3-point-to-3-point mapping IS affine
// (only 4+ points can require a true, non-affine projective mapping), which is exactly
// what makes the "warp a fine mesh of tiny triangles" technique work below: canvas 2D
// has no projective-transform primitive, but composing many small affine triangle
// draws approximates one closely enough that the seams aren't visible.
function solveAffine3(S, D){
  const [[sx0,sy0],[sx1,sy1],[sx2,sy2]] = S;
  const [[dx0,dy0],[dx1,dy1],[dx2,dy2]] = D;
  const denom = sx0*(sy1-sy2) + sx1*(sy2-sy0) + sx2*(sy0-sy1);
  if (!denom) return null;
  const a = (dx0*(sy1-sy2) + dx1*(sy2-sy0) + dx2*(sy0-sy1)) / denom;
  const c = (dx0*(sx2-sx1) + dx1*(sx0-sx2) + dx2*(sx1-sx0)) / denom;
  const e = (dx0*(sx1*sy2-sx2*sy1) + dx1*(sx2*sy0-sx0*sy2) + dx2*(sx0*sy1-sx1*sy0)) / denom;
  const b = (dy0*(sy1-sy2) + dy1*(sy2-sy0) + dy2*(sy0-sy1)) / denom;
  const d = (dy0*(sx2-sx1) + dy1*(sx0-sx2) + dy2*(sx1-sx0)) / denom;
  const f = (dy0*(sx1*sy2-sx2*sy1) + dy1*(sx2*sy0-sx0*sy2) + dy2*(sx0*sy1-sx1*sy0)) / denom;
  return [a, b, c, d, e, f];
}


export { rotMatrix, computeOverscale, solveAffine3 };
