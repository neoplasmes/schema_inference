import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const endpoint = 'http://127.0.0.1:8010/api/v2/schemas';

export async function startBackend(): Promise<() => Promise<void>> {
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
        probe.once('error', error => {
            reject(
                new Error('Port 8010 is unavailable; API tests require an isolated server.', {
                    cause: error,
                })
            );
        });
        probe.listen(8010, '127.0.0.1', () =>
            probe.close(error => (error ? reject(error) : resolve()))
        );
    });

    return launchBackend();
}

async function launchBackend(): Promise<() => Promise<void>> {
    const directory = await mkdtemp(path.join(tmpdir(), 'workspace-api-e2e-'));
    const child = spawn(
        'moon',
        [
            'run',
            'server:start',
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
                APP_ENV: 'production',
                HOST: '127.0.0.1',
                PORT: '8010',
                DATABASE_PATH: path.join(directory, 'workspace.sqlite3'),
                UPLOAD_ROOT: path.join(directory, 'uploads'),
                WORDNET_ROOT: path.join(root, 'apps/server/nltk_data'),
                ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
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
        signal('SIGTERM');
        await Promise.race([
            exited,
            delay(5000),
        ]);
        signal('SIGKILL');
        await exited;
        const artifacts = path.join(root, 'artifacts/client-api-e2e');
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
        const deadline = Date.now() + 30000;

        while (Date.now() < deadline) {
            if (failure || closed) {
                throw (
                    failure ??
                    new Error(`Backend exited before becoming ready.\n${output}`)
                );
            }

            const response = await fetch(endpoint, {
                signal: AbortSignal.timeout(1000),
            }).catch(() => undefined);

            if (response?.ok) {
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
