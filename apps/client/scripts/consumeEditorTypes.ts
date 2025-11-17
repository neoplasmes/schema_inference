import { access, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(directory, '@mf-types/schema_editor');
const cache = path.join(directory, '.cache');
const lockPath = path.join(cache, 'editor-types.lock');
const digestPath = path.join(cache, 'editor-types.sha256');
await mkdir(cache, {
    recursive: true,
});
const deadline = Date.now() + 30000;
let locked = false;

while (!locked) {
    try {
        const lock = await open(lockPath, 'wx');
        await lock.writeFile(String(process.pid));
        await lock.close();
        locked = true;
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
            throw error;
        }

        if (Date.now() >= deadline) {
            throw new Error(
                'Timed out waiting for editor type preparation. Check .cache/editor-types.lock and its owner process.'
            );
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

try {
    let archive = path.resolve(directory, '../editor/dist/@mf-types.zip');

    if (process.env.EDITOR_TYPES_URL && !process.argv.includes('--local')) {
        const response = await fetch(process.env.EDITOR_TYPES_URL);

        if (!response.ok) {
            throw new Error(`Editor types request failed: ${response.status}`);
        }

        archive = path.join(cache, 'editor-types.zip');
        await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    }

    const bytes = await readFile(archive);

    if (bytes.length === 0) {
        throw new Error('The editor type archive is empty.');
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    const previous = await readFile(digestPath, 'utf8').catch(() => null);
    const present = await access(path.join(target, 'Editor.d.ts')).then(
        () => true,
        () => false
    );

    if (previous !== digest || !present) {
        await rm(digestPath, {
            force: true,
        });
        await rm(target, {
            recursive: true,
            force: true,
        });
        await mkdir(target, {
            recursive: true,
        });
        execFileSync(
            'unzip',
            [
                '-o',
                archive,
                '-d',
                target,
            ],
            {
                stdio: 'pipe',
            }
        );
        await access(path.join(target, 'Editor.d.ts'));
        await writeFile(digestPath, digest);
    }
} finally {
    await rm(lockPath, {
        force: true,
    });
}
