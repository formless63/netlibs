/**
 * Whether the browser can display a PDF inside an embedded frame. Capability
 * detection, not UA sniffing: `pdfViewerEnabled` is true on desktop browsers
 * and false on iOS Safari and Chrome for Android.
 */
export function browserRendersPdfInline(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.pdfViewerEnabled === 'boolean') return navigator.pdfViewerEnabled;
  return Boolean(navigator.mimeTypes?.namedItem?.('application/pdf'));
}
