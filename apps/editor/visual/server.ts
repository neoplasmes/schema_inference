import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const editorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function healthy(baseUrl: string): Promise<boolean> {
    try {
        const response = await fetch(baseUrl, {
            signal: AbortSignal.timeout(1500),
            cache: 'no-store',
        });

        return (
            response.ok &&
            response.headers.get('content-type')?.includes('text/html') === true
        );
    } catch {
        return false;
    }
}

export async function ensureEditorServer(
    baseUrl = process.env.EDITOR_URL ?? 'http://127.0.0.1:3010'
): Promise<{
    baseUrl: string;
    stop(): Promise<void>;
}> {
    if (await healthy(baseUrl)) {
        return {
            baseUrl,
            stop: async () => undefined,
        };
    }

    const address = new URL(baseUrl);

    if (
        ![
            '127.0.0.1',
            'localhost',
        ].includes(address.hostname) ||
        address.port !== '3010'
    ) {
        throw new Error(
            `Editor endpoint unavailable: ${baseUrl}; automatic startup supports the configured local port 3010 only.`
        );
    }

    await mkdir(resolve(editorRoot, 'visual/actual'), {
        recursive: true,
    });
    const log = createWriteStream(resolve(editorRoot, 'visual/actual/dev-server.log'), {
        flags: 'a',
    });
    const child: ChildProcess = spawn(
        process.execPath,
        [
            resolve(editorRoot, 'node_modules/tsx/dist/cli.mjs'),
            resolve(editorRoot, 'node_modules/webpack-cli/bin/cli.js'),
            'serve',
            '--config',
            'webpack.config.ts',
            '--mode',
            'development',
        ],
        {
            cwd: editorRoot,
            stdio: [
                'ignore',
                'pipe',
                'pipe',
            ],
            detached: true,
        }
    );
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    let stopped = false;
    const terminate = () => {
        if (!stopped && child.pid) {
            stopped = true;

            try {
                process.kill(-child.pid, 'SIGTERM');
            } catch {
                child.kill('SIGTERM');
            }
        }
    };
    process.once('exit', terminate);
    const stop = async () => {
        const exited = new Promise<void>(done => {
            if (child.exitCode !== null) {
                done();
            } else {
                child.once('exit', () => done());
            }
        });
        terminate();
        await Promise.race([
            exited,
            new Promise<void>(done => {
                const timeout = setTimeout(done, 3000);
                timeout.unref();
            }),
        ]);
        process.removeListener('exit', terminate);
        log.end();
    };
    const deadline = Date.now() + 60000;

    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            await stop();
            throw new Error(
                `Editor dev server exited (${child.exitCode}); inspect visual/actual/dev-server.log.`
            );
        }

        if (await healthy(baseUrl)) {
            return {
                baseUrl,
                stop,
            };
        }

        await new Promise(done => setTimeout(done, 250));
    }

    await stop();
    throw new Error(
        'Editor dev server did not become ready within 60 seconds; inspect visual/actual/dev-server.log.'
    );
}
