import test from "node:test";
import assert from "node:assert/strict";
import { rotMatrix, computeOverscale, solveAffine3 } from "../src/transform-math.js";
import { computeCropWindow } from "../src/crop-geometry.js";
import { clonePhotoState } from "../src/photo-state.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

test("0° rotation is the identity matrix", () => {
  assert.deepEqual(rotMatrix(0, clamp), { a: 1, b: 0, c: -0, d: 1 });
});

test("rotation clamps to ±45°", () => {
  assert.deepEqual(rotMatrix(90, clamp), rotMatrix(45, clamp));
});

test("overscale is one for an identity transform", () => {
  assert.equal(computeOverscale(1, 0, 0, 1, 800, 600), 1);
});

test("affine transform maps a translated triangle", () => {
  const m = solveAffine3([[0, 0], [1, 0], [0, 1]], [[10, 20], [12, 20], [10, 23]]);
  assert.deepEqual(m, [2, 0, 0, 3, 10, 20]);
});

test("degenerate triangle has no affine transform", () => {
  assert.equal(solveAffine3([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 0], [0, 1]]), null);
});

test("crop window preserves requested aspect ratio", () => {
  const crop = { z: 1, cx: 0.5, cy: 0.5 };
  const w = computeCropWindow({ w: 600, h: 400 }, 1, crop, clamp, 10);
  assert.equal(w.winW, 400);
  assert.equal(w.winH, 400);
  assert.equal(w.srcX, 100);
  assert.equal(w.srcY, 0);
});

test("crop window stays inside image at maximum zoom", () => {
  const w = computeCropWindow({ w: 600, h: 400 }, 1, { z: 10, cx: 0, cy: 0 }, clamp, 10);
  assert.ok(w.srcX >= 0 && w.srcY >= 0);
  assert.ok(w.srcX + w.winW <= 600);
  assert.ok(w.srcY + w.winH <= 400);
});


test("photo history snapshot copies crop state without sharing it", () => {
  const source = [{ id: "a", rotation: 90, crop: { z: 2, cx: 0.25 } }, { id: "b", rotation: 0, crop: null }];
  const copy = clonePhotoState(source);
  assert.deepEqual(copy, source);
  assert.notEqual(copy[0], source[0]);
  assert.notEqual(copy[0].crop, source[0].crop);
  copy[0].crop.z = 5;
  assert.equal(source[0].crop.z, 2);
});
