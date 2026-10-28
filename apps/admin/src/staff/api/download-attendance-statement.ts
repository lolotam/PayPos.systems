/** بينزّل ملف الكشف من بايتات المتصفح؛ العنوان مبني على المتصفح لأن الـ API مالهاش CORS ولا Content-Disposition (FR-007). */
export function downloadAttendanceStatement(data: Blob, fileName: string): () => void {
  const url = URL.createObjectURL(data);
  let revoked = false;
  const release = () => {
    clearTimeout(timer);
    if (!revoked) URL.revokeObjectURL(url);
    revoked = true;
  };
  const timer = setTimeout(release, 10_000);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return release;
}
