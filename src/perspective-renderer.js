// Perspective mesh renderer extracted without changing triangle sampling.
function drawWarpedTriangle(ctx, img, S0, S1, S2, D0, D1, D2, solveAffine3){
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
function keystoneStrength(sliderVal, clamp, MAX_KEYSTONE){
  const t = clamp(sliderVal, -50, 50) / 50;
  return Math.sign(t) * Math.pow(Math.abs(t), 1.7) * MAX_KEYSTONE;
}

function drawPerspectiveMesh(ctx, img, win, skewV, skewH, destW, destH, gridN, clamp, MAX_KEYSTONE, solveAffine3){
  const kV = keystoneStrength(skewV, clamp, MAX_KEYSTONE);
  const kH = keystoneStrength(skewH, clamp, MAX_KEYSTONE);
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
      drawWarpedTriangle(ctx, img, [v00[0],v00[1]], [v10[0],v10[1]], [v01[0],v01[1]], [v00[2],v00[3]], [v10[2],v10[3]], [v01[2],v01[3]], solveAffine3);
      drawWarpedTriangle(ctx, img, [v10[0],v10[1]], [v11[0],v11[1]], [v01[0],v01[1]], [v10[2],v10[3]], [v11[2],v11[3]], [v01[2],v01[3]], solveAffine3);
    }
  }
}


export { drawPerspectiveMesh };
