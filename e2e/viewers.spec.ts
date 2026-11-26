import { expect, test } from '@playwright/test';

import { distinctColors, expectReady, open, unexpected, watch } from './helpers.ts';

/** Every format the README claims, rendered by its real engine. */
const FRAMED = [
  'text',
  'image',
  'svg',
  'stl-ascii',
  'stl-binary',
  'obj',
  'ply',
  'off',
  '3mf',
  'glb',
  'gltf',
  'kicad-pcb',
  'kicad-sch',
  'kicad-project',
  'gerber',
  'drill',
  'gerber-board',
  'lbx',
  'lbx-real',
  'markdown',
  'html',
  'pdf-canvas',
];

for (const id of FRAMED) {
  test(`${id} renders without errors or third-party requests`, async ({ page }) => {
    const seen = watch(page);
    const panel = await open(page, id);
    await expectReady(panel);
    await page.waitForTimeout(400);
    expect(await distinctColors(page, panel)).toBeGreaterThan(4);
    await panel.screenshot({ path: `artifacts/e2e/${id}.png` });
    expect(seen.external).toEqual([]);
    expect(unexpected(id, seen)).toEqual([]);
  });
}

for (const via of ['blob', 'buffer', 'auth']) {
  for (const id of [
    'pdf-canvas',
    'stl-binary',
    'glb',
    'kicad-pcb',
    'gerber',
    'lbx',
    'image',
    'html',
    'markdown',
  ]) {
    test(`${id} reads from ${via}`, async ({ page }) => {
      const seen = watch(page);
      await expectReady(await open(page, id, via));
      expect(unexpected(id, seen)).toEqual([]);
    });
  }
}

test('the secure route really is closed without the adapter', async ({ request }) => {
  expect((await request.get('/api/secure/tetra.glb')).status()).toBe(401);
});

test('pages are server-rendered, with the frame in the HTML', async ({ request }) => {
  const html = await (await request.get('/viewer/stl-ascii?via=url')).text();
  expect(html).toContain('data-fv-frame="mesh"');
});

test('pdf.js renders all pages lazily, navigates and zooms', async ({ page }) => {
  const panel = await open(page, 'pdf-canvas');
  await expectReady(panel);
  await expect(panel.locator('canvas[data-fv-rendered="true"]').first()).toBeVisible();
  await expect(panel.getByText('1 / 3')).toBeVisible();
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();
  await expect(panel.locator('[data-fv-page="3"] canvas')).not.toHaveAttribute(
    'data-fv-rendered',
    'true',
  );
  await panel.getByRole('button', { name: 'Zoom in' }).click();
  await expect(panel.locator('[data-fv-page="1"]')).toHaveAttribute('style', /width: 125%/);
});

test('pdf.js uses a real worker', async ({ page }) => {
  await expectReady(await open(page, 'pdf-canvas'));
  expect(page.workers().length).toBeGreaterThan(0);
});

test('pan/zoom: buttons, ctrl+wheel, keyboard, and no scroll hijack', async ({ page }) => {
  const panel = await open(page, 'gerber');
  await expectReady(panel);
  const content = panel.locator('.fv-panzoom-content');
  const scale = async () => Number(await content.getAttribute('data-fv-scale'));
  await panel.hover();
  await page.mouse.wheel(0, -200);
  expect(await scale()).toBe(1);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(scale).toBeGreaterThan(1.5);
  await panel.getByRole('button', { name: 'Reset view' }).click();
  expect(await scale()).toBe(1);
  await panel.locator('.fv-panzoom-viewport').press('+');
  expect(await scale()).toBeGreaterThan(1);
});

test('LBX stock preview recolours without moving marks', async ({ page }) => {
  const panel = await open(page, 'lbx-real');
  await expectReady(panel);
  const svg = panel.locator('svg[data-lbx-stock]');
  await expect(panel.locator('[data-lbx-tape]')).toHaveAttribute('fill', '#000000');
  const before = await panel.locator('[data-lbx-coverage]').innerHTML();
  await panel.locator('select').selectOption('black-on-yellow');
  await expect(svg).toHaveAttribute('data-lbx-stock', 'black-on-yellow');
  await expect(panel.locator('[data-lbx-tape]')).toHaveAttribute('fill', '#f2c800');
  expect(await panel.locator('[data-lbx-coverage]').innerHTML()).toBe(before);
});

test('Gerber stack: drill holes in inches line up with millimetre pads', async ({ page }) => {
  const panel = await open(page, 'gerber-board');
  await expectReady(panel);
  const centres = async (index: number) =>
    panel
      .locator('svg[role=img] > g')
      .nth(index)
      .evaluate((g) => {
        const box = g.getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2];
      });
  const count = await panel.locator('svg[role=img] > g').count();
  expect(count).toBe(6);
  const [copper, drill] = [await centres(1), await centres(count - 1)];
  expect(Math.abs(copper[0]! - drill[0]!)).toBeLessThan(1.5);
  expect(Math.abs(copper[1]! - drill[1]!)).toBeLessThan(1.5);
});

test('KiCad engine renders its icons from the bundled font', async ({ page }) => {
  await expectReady(await open(page, 'kicad-pcb'));
  expect(await page.evaluate(() => document.fonts.check('24px "Material Symbols Outlined"'))).toBe(
    true,
  );
});

test('hostile files cannot run script', async ({ page }) => {
  for (const id of ['html', 'svg', 'markdown']) {
    await expectReady(await open(page, id));
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() =>
        ['__htmlPwned', '__svgPwned', '__mdPwned'].filter((key) => key in window),
      ),
    ).toEqual([]);
  }
});

test('remote content in HTML is refused by default and only then', async ({ page }) => {
  let hits = 0;
  await page.route('https://tracker.invalid/**', (route) => {
    hits++;
    return route.fulfill({ status: 204 });
  });
  await expectReady(await open(page, 'html'));
  await page.waitForTimeout(400);
  expect(hits).toBe(0);
  // Control: the same file does call out once the host opts in.
  await expectReady(await open(page, 'html-remote'));
  await expect.poll(() => hits).toBeGreaterThan(0);
});

test('failures degrade to actionable states', async ({ page }) => {
  const corrupt = await open(page, 'corrupt');
  await expect(corrupt.locator('[data-fv-error="parse-failed"]')).toBeVisible();
  const missing = await open(page, 'missing');
  await expect(missing.locator('[data-fv-error="http-status"]')).toBeVisible();
  await expect(missing.getByRole('button', { name: 'Try again' })).toBeVisible();
  const unsupported = await open(page, 'unsupported');
  await expect(unsupported.locator('[data-fv-error="unsupported"]')).toBeVisible();
  const guarded = await open(page, 'guarded');
  await guarded.getByRole('button', { name: 'Load preview (80 MB)' }).click();
  await expectReady(guarded);
});

test('engines load only for the viewer that needs them', async ({ page }) => {
  const scripts: string[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script')
      scripts.push(new URL(response.url()).pathname);
  });
  await expectReady(await open(page, 'text'));
  const heavy = /kicanvas|o3dv|model-viewer|tracespace|mermaid|pdf\.worker|pdf-worker/;
  expect(scripts.filter((path) => heavy.test(path))).toEqual([]);
});

test('a local file opens without a server round trip', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.setInputFiles('input[type=file]', 'fixtures/tetra-binary.stl');
  await expect(page.locator('[data-fv-viewer="mesh"]')).toHaveAttribute(
    'data-fv-status',
    'ready',
    { timeout: 30_000 },
  );
});

test('corrupt bytes fail cleanly in every engine', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (const name of [
    'bad.glb',
    'bad.stl',
    'bad.kicad_pcb',
    'bad.gbr',
    'bad.lbx',
    'bad.png',
    'bad.3mf',
  ]) {
    const body = name.endsWith('kicad_pcb') ? '(kicad_pcb (layers' : 'definitely not this format';
    await page.setInputFiles('input[type=file]', { name, mimeType: '', buffer: Buffer.from(body) });
    await expect(page.locator('[data-fv-error]'), name).toBeVisible({ timeout: 35_000 });
  }
});

test('fits a phone viewport without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of ['pdf-canvas', 'gerber-board', 'markdown', 'lbx-real']) {
    await expectReady(await open(page, id));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      id,
    ).toBeLessThanOrEqual(0);
  }
});
