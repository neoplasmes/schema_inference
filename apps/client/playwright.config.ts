import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    workers: 1,
    retries: 0,
    timeout: 45000,
    outputDir: '../../artifacts/client-e2e/test-results',
    reporter: [
        [
            'list',
        ],
        [
            'html',
            {
                outputFolder: '../../artifacts/client-e2e/report',
                open: 'never',
            },
        ],
    ],
    use: {
        baseURL: 'http://127.0.0.1:4173',
        browserName: 'chromium',
        viewport: {
            width: 1440,
            height: 1000,
        },
        deviceScaleFactor: 1,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            args: [
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
            ],
        },
    },
    globalSetup: './scripts/setup-e2e.ts',
});
