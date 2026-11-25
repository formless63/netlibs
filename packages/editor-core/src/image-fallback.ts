/**
 * Swaps a failed image for its alt text, in the live editor. A missing and a forbidden resource
 * look the same to the browser: a failed load. Plain DOM, client only.
 */

export const RICH_IMAGE_FALLBACK_CLASS = 'rich-image-fallback';

function fallbackLabel(img: HTMLImageElement): string {
  const alt = img.alt.trim();
  if (alt) return alt;
  const title = img.title.trim();
  if (title) return title;
  return 'Image unavailable';
}

function buildFallbackElement(img: HTMLImageElement): HTMLElement {
  const span = document.createElement('span');
  span.className = RICH_IMAGE_FALLBACK_CLASS;
  const label = fallbackLabel(img);
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', label);
  span.textContent = label;
  return span;
}

/**
 * Swap one failed `<img>` for its alt-text fallback element. Idempotent — a
 * second call on an already-detached `img` is a no-op.
 */
export function replaceRichImageWithFallback(img: HTMLImageElement): void {
  if (!img.isConnected) return;
  img.replaceWith(buildFallbackElement(img));
}

/**
 * Attach one delegated, capture-phase `error` listener to `container` that
 * swaps any failed `<img data-resource-id>` beneath it for its fallback.
 *
 * `error` (a resource-loading event) does not bubble, but IS observable
 * during the DOM capturing phase on an ancestor — so a single listener here
 * covers every embedded image in the container without a per-image
 * handler. Returns a cleanup function.
 */
export function attachRichImageFallback(container: HTMLElement): () => void {
  const handleError = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.hasAttribute('data-resource-id')) {
      replaceRichImageWithFallback(target);
    }
  };
  container.addEventListener('error', handleError, true);
  return () => container.removeEventListener('error', handleError, true);
}
