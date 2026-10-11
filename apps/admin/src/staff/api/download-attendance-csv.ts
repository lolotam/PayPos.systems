export function downloadAttendanceCsv(data: Blob, branchName: string, month: string): () => void {
  const name =
    branchName.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+|[.-]+$/g, '') || 'all';
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
  anchor.download = `attendance-${name}-${month}.csv`;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return release;
}
