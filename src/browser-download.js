// Browser download fallback. Host-specific bridges stay in the application adapter.
function downloadBlob(blob, filename, { document, URL, setTimeout }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { downloadBlob };
