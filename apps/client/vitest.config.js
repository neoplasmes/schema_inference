import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, 'src'),
        },
    },
    test: {
        environment: 'node',
        testTimeout: 15000,
        expect: {
            poll: {
                timeout: 5000,
            },
        },
        include: [
            'src/**/*.test.{ts,tsx}',
            'scripts/**/*.test.ts',
        ],
    },
});
