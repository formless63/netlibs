import { expect, type Locator, type Page } from '@playwright/test';

export interface Watch {
  errors: string[];
  external: string[];
}

/** Collect page errors and every request that leaves the playground's origin. */
export function watch(page: Page): Watch {
  const seen: Watch = { errors: [], external: [] };
  page.on('pageerror', (error) => seen.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.host !== '127.0.0.1:4310')
      seen.external.push(request.url());
  });
  // Playwright announces CSP-refused requests too. Those never reach the network.
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'csp') return;
    seen.external = seen.external.filter((url) => url !== request.url());
  });
  return seen;
}

export async function open(page: Page, id: string, via = 'url'): Promise<Locator> {
  await page.goto(`/viewer/${id}?via=${via}`);
  return page.getByTestId('panel');
}

export async function expectReady(panel: Locator): Promise<void> {
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
}

/** Distinct colours actually painted. A blank or single-colour viewer scores 1 or 2. */
export async function distinctColors(page: Page, target: Locator): Promise<number> {
  const png = (await target.screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${data}`)).blob(),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data: px } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const colors = new Set<number>();
    for (let i = 0; i < px.length; i += 4)
      colors.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    return colors.size;
  }, png);
}

/** The hostile HTML fixture is MEANT to be refused, and the browser says so. */
export function unexpected(id: string, seen: Watch): string[] {
  if (id !== 'html') return seen.errors;
  return seen.errors.filter(
    (text) => !/Blocked script execution|Content Security Policy/.test(text),
  );
}
