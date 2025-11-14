import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);

if (args.some(argument => argument !== '--mock')) {
    throw new Error('Usage: moon run client:dev [-- --mock]');
}

const mode =
    args.includes('--mock') || process.env.WORKSPACE_MODE === 'mock' ? 'mock' : 'api';
const version = readFileSync(path.join(root, '.prototools'), 'utf8').match(
    /^moon\s*=\s*"([^"]+)"/m
)?.[1];
const moonPath =
    version &&
    path.join(
        process.env.PROTO_HOME || path.join(root, '.proto'),
        'tools/moon',
        version,
        process.platform === 'win32' ? 'moon.exe' : 'moon'
    );
const moon = moonPath && existsSync(moonPath) ? moonPath : 'moon';
const controller = new AbortController();
const aborted = new Promise<void>(resolve => {
    controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
    });
});
const tasks = new Set<{
    child: ChildProcess;
    closed: Promise<void>;
}>();
let failure: unknown;

function abort(error?: unknown): void {
    failure ??= error;
    controller.abort();
}

function startTask(target: string, persistent = true, env: NodeJS.ProcessEnv = {}) {
    controller.signal.throwIfAborted();
    const child = spawn(
        moon,
        [
            'run',
            target,
            '--no-actions',
        ],
        {
            cwd: root,
            detached: process.platform !== 'win32',
            stdio: 'inherit',
            env: {
                ...process.env,
                ...env,
            },
        }
    );
    const closed = new Promise<void>(resolve => {
        child.once('error', error => {
            abort(
                new Error(`Cannot start ${target}.`, {
                    cause: error,
                })
            );
            resolve();
        });
        child.once('close', (code, signal) => {
            if (!controller.signal.aborted && (persistent || code !== 0)) {
                abort(new Error(`${target} exited with ${signal ?? `code ${code}`}.`));
            }

            if (!persistent && code === 0) {
                tasks.delete(task);
            }

            resolve();
        });
    });
    const task = {
        child,
        closed,
    };
    tasks.add(task);

    return task;
}

async function waitForApi(): Promise<void> {
    const host = process.env.HOST || '127.0.0.1';
    const hostname = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const endpoint = `http://${hostname}:${process.env.PORT || '8000'}/api/v2/schemas`;
    const deadline = Date.now() + 60000;

    while (Date.now() < deadline) {
        controller.signal.throwIfAborted();
        const response = await fetch(endpoint, {
            signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(1000),
            ]),
        }).catch(() => undefined);
        await response?.body?.cancel();

        if (response?.ok) {
            return;
        }

        await delay(100, undefined, {
            signal: controller.signal,
        });
    }

    throw new Error(`Backend startup timed out: ${endpoint}`);
}

function signalTask(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) {
        return;
    }

    try {
        if (process.platform === 'win32') {
            child.kill(signal);
        } else {
            process.kill(-child.pid, signal);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
        }
    }
}

const onSignal = () => abort();
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

try {
    if (mode === 'api') {
        await Promise.race([
            startTask('env:compose-up-database', false).closed,
            aborted,
        ]);
        controller.signal.throwIfAborted();
        startTask('server:start');
        await waitForApi();
    }

    startTask('editor:dev');
    startTask('client:dev-web', true, {
        WORKSPACE_MODE: mode,
    });
    await aborted;
} catch (error) {
    if (!controller.signal.aborted) {
        failure = error;
    }
} finally {
    controller.abort();

    for (const { child } of tasks) {
        signalTask(child, 'SIGTERM');
    }

    const closed = Promise.all(
        [
            ...tasks,
        ].map(task => task.closed)
    );
    await Promise.race([
        closed,
        delay(5000, undefined, {
            ref: false,
        }),
    ]);

    for (const { child } of tasks) {
        signalTask(child, 'SIGKILL');
    }

    await closed;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
}

if (failure) {
    console.error(failure);
    process.exitCode = 1;
}
