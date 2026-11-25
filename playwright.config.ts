import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/*.spec.ts', 'packages/*/browser/*.spec.ts'],
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4310',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    // Software WebGL, so the 3D and KiCad engines really render headless.
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'bun run --cwd examples/viewer-playground start',
    url: 'http://127.0.0.1:4310/',
    reuseExistingServer: !process.env['CI'],
  },
});
