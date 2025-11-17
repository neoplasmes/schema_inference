import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfiguration } from '.';

afterEach(() => vi.unstubAllGlobals());

describe('workspace runtime configuration', () => {
    it('selects the real server without requiring an editor manifest at startup', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                Response.json({
                    mode: 'api',
                    apiBaseUrl: 'https://api.example.test/',
                })
            )
        );

        expect(await loadRuntimeConfiguration()).toEqual({
            mode: 'api',
            apiBaseUrl: 'https://api.example.test/',
        });
    });

    it('rejects invalid modes instead of silently opening mock data', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                Response.json({
                    mode: 'production',
                    apiBaseUrl: '',
                })
            )
        );

        await expect(loadRuntimeConfiguration()).rejects.toThrow();
    });

    it('passes the browser telemetry collector through when the deployment provides one', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                Response.json({
                    mode: 'api',
                    apiBaseUrl: '',
                    telemetryUrl: '/collect',
                })
            )
        );

        expect(await loadRuntimeConfiguration()).toEqual({
            mode: 'api',
            apiBaseUrl: '',
            telemetryUrl: '/collect',
        });
    });

    it('rejects an empty telemetry collector', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                Response.json({
                    mode: 'api',
                    apiBaseUrl: '',
                    telemetryUrl: '',
                })
            )
        );

        await expect(loadRuntimeConfiguration()).rejects.toThrow();
    });
});
