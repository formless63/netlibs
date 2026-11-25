export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${round(kb)} KB`;
  const mb = kb / 1024;
  return mb < 1024 ? `${round(mb)} MB` : `${round(mb / 1024)} GB`;
}

function round(value: number): number {
  return value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
}
