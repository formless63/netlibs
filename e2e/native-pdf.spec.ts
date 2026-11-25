import { expect, test } from '@playwright/test';

import { expectReady, open } from './helpers.ts';

// The headless shell has no PDF plugin; full Chromium does.
test.use({ channel: 'chromium' });

for (const via of ['url', 'blob', 'auth']) {
  test(`native PDF viewer opens a document read from ${via}`, async ({ page }) => {
    const panel = await open(page, 'pdf', via);
    await expectReady(panel);
    expect(await page.evaluate(() => navigator.pdfViewerEnabled)).toBe(true);
    await expect(panel.locator('object[type="application/pdf"]')).toBeVisible();
    await expect(panel.locator('object .fv-message')).toBeHidden();
    await expect
      .poll(() => page.frames().some((frame) => frame.url().startsWith('chrome-extension://')))
      .toBe(true);
  });
}
