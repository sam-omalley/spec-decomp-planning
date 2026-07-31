/**
 * Browser file download, extracted from `App.tsx` so the engagement
 * tracker's own export (#163) uses the same one rather than a second copy
 * of the object-URL dance.
 */

export function downloadFile(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** `prefix-YYYY-MM-DD.ext` — the naming every export in the app uses. */
export function datedFilename(prefix: string, extension: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
