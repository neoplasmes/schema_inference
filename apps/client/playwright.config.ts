import { defineConfig } from '@playwright/test';

const api = process.env.WORKSPACE_MODE === 'api';
const artifacts = api ? '../../artifacts/client-api-e2e' : '../../artifacts/client-e2e';

export default defineConfig({
    testDir: './tests',
    testMatch: api ? '**/*.api.spec.ts' : '**/workspace.spec.ts',
    workers: 1,
    retries: 0,
    timeout: 45000,
    outputDir: `${artifacts}/test-results`,
    reporter: [
        [
            'list',
        ],
        [
            'html',
            {
                outputFolder: `${artifacts}/report`,
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
