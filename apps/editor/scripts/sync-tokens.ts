import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const editorDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(
    editorDirectory,
    '../../artifacts/schema-editor-design/tokens/tokens.json'
);
const sourceLabel =
    '/home/neoplasmes/third_course_reimagined/artifacts/schema-editor-design/tokens/tokens.json';
const require = createRequire(import.meta.url);
const biome = require.resolve('@biomejs/biome/bin/biome');
const document = JSON.parse(await readFile(source, 'utf8')) as {
    tokens: Record<string, Record<string, string | Record<string, string>>>;
};
const declarations: string[] = [];

function format(source: string, filename: string): string {
    return execFileSync(
        process.execPath,
        [
            biome,
            'format',
            '--stdin-file-path',
            filename,
        ],
        {
            cwd: editorDirectory,
            input: source,
            encoding: 'utf8',
        }
    );
}

for (const [category, values] of Object.entries(document.tokens)) {
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string') {
            const variableName = category === 'font' ? `font-${name}` : name;
            declarations.push(`    --${variableName}: ${value};`);
        }
    }
}

await mkdir(path.resolve(editorDirectory, 'src/board/theme'), {
    recursive: true,
});
await mkdir(path.resolve(editorDirectory, 'src/shared/ui/theme'), {
    recursive: true,
});
await writeFile(
    path.resolve(editorDirectory, 'src/board/theme/tokens.ts'),
    format(
        `/** Generated from ${sourceLabel}. Run moon run editor:sync-tokens. */\nexport const tokens = ${JSON.stringify(document.tokens, null, 4)} as const;\n\nexport type BoardTheme = typeof tokens;\n`,
        'src/board/theme/tokens.ts'
    )
);
await writeFile(
    path.resolve(editorDirectory, 'src/shared/ui/theme/tokens.css'),
    format(
        `/* Generated from ${sourceLabel}. Run moon run editor:sync-tokens. */\n.schema-editor {\n${declarations.join('\n')}\n}\n`,
        'src/shared/ui/theme/tokens.css'
    )
);
