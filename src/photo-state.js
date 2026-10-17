// Undo/redo snapshots contain only serializable photo-edit state.
// Preserve the original shallow crop copy semantics for compatibility.
function clonePhotoState(photos) {
  return photos.map(p => ({ id: p.id, rotation: p.rotation, crop: p.crop ? { ...p.crop } : null }));
}

export { clonePhotoState };
