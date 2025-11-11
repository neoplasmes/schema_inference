import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const container = process.env.WORKSPACE_CONTAINER === '1';
const endpoints = [
    'http://127.0.0.1:8010/api/v2/schemas',
    ...(container
        ? [
              'http://127.0.0.1:4173/',
              'http://127.0.0.1:4173/api/v2/schemas',
              'http://127.0.0.1:4173/editor/mf-manifest.json',
          ]
        : []),
];

export async function startBackend(): Promise<() => Promise<void>> {
    for (const port of container
        ? [
              8010,
              4173,
          ]
        : [
              8010,
          ]) {
        const probe = createServer();
        await new Promise<void>((resolve, reject) => {
            probe.once('error', error => {
                reject(
                    new Error(
                        `Port ${port} is unavailable; API tests require an isolated server.`,
                        {
                            cause: error,
                        }
                    )
                );
            });
            probe.listen(port, '127.0.0.1', () =>
                probe.close(error => (error ? reject(error) : resolve()))
            );
        });
    }

    return launchBackend();
}

async function launchBackend(): Promise<() => Promise<void>> {
    const directory = await mkdtemp(path.join(tmpdir(), 'workspace-api-e2e-'));
    const stopFile = path.join(directory, 'stop');
    const child = spawn(
        'moon',
        [
            'run',
            'backend-e2e:start',
            '--no-actions',
        ],
        {
            cwd: root,
            detached: true,
            stdio: [
                'ignore',
                'pipe',
                'pipe',
            ],
            env: {
                ...process.env,
                PORT: '8010',
                BACKEND_E2E_STOP_FILE: stopFile,
            },
        }
    );
    let output = '';
    let failure: Error | undefined;
    let closed = false;
    child.stdout.on('data', data => {
        output += String(data);
    });
    child.stderr.on('data', data => {
        output += String(data);
    });
    child.on('error', error => {
        failure = error;
    });
    const exited = new Promise<void>(resolve =>
        child.once('close', () => {
            closed = true;
            resolve();
        })
    );
    const stop = async () => {
        const signal = (value: NodeJS.Signals) => {
            if (child.pid) {
                try {
                    process.kill(-child.pid, value);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                        throw error;
                    }
                }
            }
        };
        await writeFile(stopFile, 'stop');
        await Promise.race([
            exited,
            delay(30000, undefined, {
                ref: false,
            }),
        ]);

        if (!closed) {
            signal('SIGTERM');
            await Promise.race([
                exited,
                delay(5000, undefined, {
                    ref: false,
                }),
            ]);
        }

        if (!closed) {
            signal('SIGKILL');
        }

        await exited;
        const artifacts = path.join(
            root,
            container ? 'artifacts/client-docker-e2e' : 'artifacts/client-api-e2e'
        );
        await mkdir(artifacts, {
            recursive: true,
        });
        await writeFile(path.join(artifacts, 'backend.log'), output);
        await rm(directory, {
            recursive: true,
            force: true,
        });
    };

    try {
        const deadline = Date.now() + 180000;

        while (Date.now() < deadline) {
            if (failure || closed) {
                throw (
                    failure ??
                    new Error(`Backend exited before becoming ready.\n${output}`)
                );
            }

            const responses = await Promise.all(
                endpoints.map(endpoint =>
                    fetch(endpoint, {
                        signal: AbortSignal.timeout(1000),
                    }).catch(() => undefined)
                )
            );

            if (responses.every(response => response?.ok)) {
                return stop;
            }

            await delay(100);
        }

        throw new Error(`Backend startup timed out.\n${output}`);
    } catch (error) {
        await stop();

        throw error;
    }
}
