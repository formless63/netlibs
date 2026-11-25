import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test } from '@playwright/test';

import { fileDelivery, untrustedDocumentHeaders } from '../src/index.ts';

// Full Chromium: the headless shell has no PDF viewer.
test.use({ channel: 'chromium' });

const SCRIPT = '<script>document.title = "EXECUTED"; fetch("/beacon")</script>';
const HTML = `<!doctype html>${SCRIPT}<p>page</p><img src="/beacon">`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">${SCRIPT}<rect width="40" height="40" fill="teal"/></svg>`;
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj trailer<</Root 1 0 R>>';

let server: Server;
let origin: string;
let beacons = 0;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://x');
    if (url.pathname === '/beacon') {
      beacons++;
      response.end();
      return;
    }
    const type = url.searchParams.get('type');
    const body =
      url.searchParams.get('body') === 'svg'
        ? SVG
        : url.searchParams.get('body') === 'pdf'
          ? PDF
          : HTML;
    const headers =
      url.pathname === '/raw'
        ? { 'Content-Type': type!, 'X-Content-Type-Options': 'nosniff' }
        : url.pathname === '/document'
          ? untrustedDocumentHeaders()
          : url.pathname === '/embed'
            ? { 'Content-Type': 'text/html' }
            : fileDelivery({ contentType: type, filename: 'file' }).headers;
    response.writeHead(200, headers);
    response.end(
      url.pathname === '/embed' ? `<img src="/file?type=image/svg%2Bxml&body=svg">` : body,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());
test.beforeEach(() => void (beacons = 0));

const at = (path: string, type: string, body = 'html') =>
  `${origin}${path}?${new URLSearchParams({ type, body })}`;

test('control: the attack works when the type is passed through', async ({ page }) => {
  for (const type of ['text/html', 'application/pdf;x=1, text/html', 'image/png;x=1,text/html']) {
    await page.goto(at('/raw', type));
    await expect(page, type).toHaveTitle('EXECUTED');
  }
});

for (const type of [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/plain',
  'application/json',
  'application/pdf;x=1, text/html',
  'image/png;x=1,text/html',
  'text/plain;x=1, text/html',
]) {
  test(`a hostile file stored as ${type} never runs`, async ({ page }) => {
    const downloading = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
    await page.goto(at('/file', type, type === 'image/svg+xml' ? 'svg' : 'html')).catch(() => {});
    await downloading;
    await page.waitForTimeout(200);
    expect(await page.title()).not.toBe('EXECUTED');
    expect(beacons).toBe(0);
  });
}

test('SVG still displays in an <img>', async ({ page }) => {
  await page.goto(`${origin}/embed`);
  expect(await page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);
  expect(beacons).toBe(0);
});

test('PDF opens in the browser viewer', async ({ page }) => {
  await page.goto(at('/file', 'application/pdf', 'pdf'));
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith('chrome-extension://')))
    .toBe(true);
});

test('an untrusted document renders without script, network or origin', async ({ page }) => {
  await page.goto(`${origin}/document`);
  await expect(page.locator('p')).toHaveText('page');
  expect(await page.title()).not.toBe('EXECUTED');
  expect(beacons).toBe(0);
});
