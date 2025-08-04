import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectModules, type SourceModule } from './architecture';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const modules: SourceModule[] = [];

async function collect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            await collect(filename);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            modules.push({
                name: path.relative(sourceRoot, filename).split(path.sep).join('/'),
                text: await readFile(filename, 'utf8'),
            });
        }
    }
}

await collect(sourceRoot);
const violations = inspectModules(modules);

for (const violation of violations) {
    process.stderr.write(`${violation.file}: ${violation.rule}: ${violation.detail}\n`);
}

if (violations.length > 0) {
    process.exitCode = 1;
} else {
    process.stdout.write(`Architecture verified: ${modules.length} source modules.\n`);
}
