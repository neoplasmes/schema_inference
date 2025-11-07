import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cleanups: (() => Promise<void>)[] = [];

type Invocation = {
    target: string;
    args: string[];
    mode?: string;
    pid: number;
};

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

async function startFixture(args: string[] = [], failure = '', holdDatabase = false) {
    const directory = await mkdtemp(path.join(tmpdir(), 'workspace-dev-'));
    const log = path.join(directory, 'tasks.jsonl');
    const ready = path.join(directory, 'ready');
    const version = (await readFile(path.join(root, '.prototools'), 'utf8')).match(
        /^moon\s*=\s*"([^"]+)"/m
    )?.[1];
    const executable = path.join(directory, 'tools/moon', version!, 'moon');
    const port = await availablePort();
    await mkdir(path.dirname(executable), {
        recursive: true,
    });
    await writeFile(log, '');
    await writeFile(
        executable,
        `#!${process.execPath}
const { appendFileSync, existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const target = process.argv[3];
appendFileSync(process.env.DEV_TEST_LOG, JSON.stringify({
    target, args: process.argv.slice(2), mode: process.env.WORKSPACE_MODE, pid: process.pid
}) + '\\n');
if (target === 'server:start') {
    spawn(process.execPath, ['-e',
        "const { appendFileSync, existsSync } = require('node:fs');" +
        "appendFileSync(process.env.DEV_TEST_LOG, JSON.stringify({ target: 'backend-http', pid: process.pid, args: [] }) + '\\\\n');" +
        "require('node:http').createServer((request, response) => {" +
        "response.writeHead(existsSync(process.env.DEV_TEST_READY) ? 200 : 503).end('[]');" +
        "}).listen(Number(process.env.PORT), '127.0.0.1');"
    ], { stdio: 'inherit' });
}
if (target === process.env.DEV_TEST_FAIL) {
    setTimeout(() => process.exit(23), 200);
} else if (target === 'infrastructure:up' && process.env.DEV_TEST_HOLD_DATABASE !== 'true') {
    process.exit(0);
} else {
    setInterval(() => {}, 1000);
}
`,
        {
            mode: 0o755,
        }
    );
    const child = spawn(
        process.execPath,
        [
            '--import',
            'tsx',
            'scripts/dev.ts',
            ...args,
        ],
        {
            cwd: path.join(root, 'apps/client'),
            detached: true,
            stdio: [
                'ignore',
                'pipe',
                'pipe',
            ],
            env: {
                ...process.env,
                PROTO_HOME: directory,
                WORKSPACE_MODE: '',
                HOST: '127.0.0.1',
                PORT: String(port),
                DEV_TEST_LOG: log,
                DEV_TEST_READY: ready,
                DEV_TEST_FAIL: failure,
                DEV_TEST_HOLD_DATABASE: String(holdDatabase),
            },
        }
    );
    let output = '';
    child.stdout.on('data', data => {
        output += String(data);
    });
    child.stderr.on('data', data => {
        output += String(data);
    });
    const closed = new Promise<number | null>(resolve => child.once('close', resolve));
    const invocations = async (): Promise<Invocation[]> =>
        (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line));
    const stop = async () => {
        child.kill('SIGTERM');

        return closed;
    };
    cleanups.push(async () => {
        await Promise.race([
            stop(),
            delay(1000),
        ]);
        for (const invocation of await invocations()) {
            try {
                process.kill(invocation.pid, 'SIGKILL');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                    throw error;
                }
            }
        }
        child.kill('SIGKILL');
        await closed;
        await rm(directory, {
            recursive: true,
            force: true,
        });
    });

    return {
        invocations,
        ready: () => writeFile(ready, ''),
        output: () => output,
        closed,
        stop,
    };
}

async function availablePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
    );

    if (!address || typeof address === 'string') {
        throw new Error('Cannot allocate a backend port.');
    }

    return address.port;
}

describe('development launcher', () => {
    it('stops while the database is still starting', async () => {
        const fixture = await startFixture([], '', true);
        await expect.poll(async () => (await fixture.invocations()).length).toBe(1);
        expect(
            await Promise.race([
                fixture.stop(),
                delay(1000, 'timed out'),
            ])
        ).toBe(0);
        expect((await fixture.invocations()).map(item => item.target)).toEqual([
            'infrastructure:up',
        ]);
    });

    it('waits for the real API before starting the frontend and cleans up its processes', async () => {
        const fixture = await startFixture();
        await expect
            .poll(async () => (await fixture.invocations()).map(item => item.target))
            .toContain('backend-http');
        await delay(150);
        expect((await fixture.invocations()).map(item => item.target)).toEqual([
            'infrastructure:up',
            'server:start',
            'backend-http',
        ]);
        await fixture.ready();
        await expect.poll(async () => (await fixture.invocations()).length).toBe(5);
        const invocations = await fixture.invocations();
        expect(
            invocations
                .slice(3)
                .map(item => item.target)
                .sort()
        ).toEqual([
            'client:dev-web',
            'editor:dev',
        ]);
        expect(invocations.find(item => item.target === 'client:dev-web')?.mode).toBe(
            'api'
        );
        expect(await fixture.stop()).toBe(0);
        await expect
            .poll(() =>
                invocations.filter(item => {
                    try {
                        process.kill(item.pid, 0);

                        return true;
                    } catch {
                        return false;
                    }
                })
            )
            .toEqual([]);
    });

    it('starts only the frontend in explicit mock mode without forwarding the flag', async () => {
        const fixture = await startFixture([
            '--mock',
        ]);
        await expect.poll(async () => (await fixture.invocations()).length).toBe(2);
        const invocations = await fixture.invocations();
        expect(invocations.map(item => item.target).sort()).toEqual([
            'client:dev-web',
            'editor:dev',
        ]);
        expect(invocations.find(item => item.target === 'client:dev-web')?.mode).toBe(
            'mock'
        );
        expect(invocations.every(item => !item.args.includes('--mock'))).toBe(true);
        expect(await fixture.stop()).toBe(0);
    });

    it.each([
        'infrastructure:up',
        'server:start',
    ])('fails without launching the frontend when %s exits', async target => {
        const fixture = await startFixture([], target);
        expect(await fixture.closed).toBe(1);
        expect(fixture.output()).toContain(target);
        expect(
            (await fixture.invocations()).some(item => item.target === 'client:dev-web')
        ).toBe(false);
    });
});
