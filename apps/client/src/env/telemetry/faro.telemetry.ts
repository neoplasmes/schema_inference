import { getWebInstrumentations, initializeFaro, LogLevel } from '@grafana/faro-web-sdk';

let started = false;

/**
 * Sends browser errors, console warnings, Web Vitals and session events to the
 * Faro collector at `url`. Repeated calls keep the first collector.
 */
export function startFaroTelemetry(url: string): void {
    if (started) {
        return;
    }

    started = true;

    initializeFaro({
        url,
        app: {
            name: 'schema-workspace',
        },
        instrumentations: getWebInstrumentations({
            captureConsoleDisabledLevels: [
                LogLevel.TRACE,
                LogLevel.DEBUG,
                LogLevel.LOG,
                LogLevel.INFO,
            ],
        }),
    });
}
