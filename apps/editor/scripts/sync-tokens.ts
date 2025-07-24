import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const editorDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(
    editorDirectory,
    '../../artifacts/schema-editor-design/tokens/tokens.json'
);
const sourceLabel =
    '/home/neoplasmes/third_course_reimagined/artifacts/schema-editor-design/tokens/tokens.json';
const formatting = await resolveConfig(editorDirectory);
const document = JSON.parse(await readFile(source, 'utf8')) as {
    tokens: Record<string, Record<string, string | Record<string, string>>>;
};
const declarations: string[] = [];

for (const [category, values] of Object.entries(document.tokens)) {
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string') {
            const variableName = category === 'font' ? `font-${name}` : name;
            declarations.push(`    --${variableName}: ${value};`);
        }
    }
}

await mkdir(path.resolve(editorDirectory, 'src/board/theme'), { recursive: true });
await mkdir(path.resolve(editorDirectory, 'src/theme'), { recursive: true });
await writeFile(
    path.resolve(editorDirectory, 'src/board/theme/tokens.ts'),
    await format(
        `/** Generated from ${sourceLabel}. Run pnpm sync-tokens. */\nexport const tokens = ${JSON.stringify(document.tokens, null, 4)} as const;\n\nexport type BoardTheme = typeof tokens;\n`,
        { ...formatting, parser: 'typescript' }
    )
);
await writeFile(
    path.resolve(editorDirectory, 'src/theme/tokens.css'),
    await format(
        `/* Generated from ${sourceLabel}. Run pnpm sync-tokens. */\n.schema-editor {\n${declarations.join('\n')}\n}\n`,
        { ...formatting, parser: 'css' }
    )
);
