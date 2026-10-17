// Keep browser Canvas encoding callback semantics unchanged.
function encodeCanvas(canvas, callback, mime, quality) {
  canvas.toBlob(callback, mime, quality);
}

export { encodeCanvas };
