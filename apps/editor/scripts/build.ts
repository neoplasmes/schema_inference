import { execFileSync } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    generateTypesAPI,
    normalizeDtsOptions,
    normalizeGenerateTypesOptions,
} from '@module-federation/dts-plugin';
import { federationOptions } from '../webpack.config';

const context = fileURLToPath(new URL('../', import.meta.url));
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`;
execFileSync(
    process.execPath,
    [
        path.join(context, 'node_modules/tsx/dist/cli.mjs'),
        path.join(context, 'node_modules/webpack-cli/bin/cli.js'),
        '--config',
        'webpack.config.ts',
        '--mode',
        'production',
    ],
    {
        cwd: context,
        stdio: 'inherit',
    }
);

const dts = normalizeDtsOptions(federationOptions, context);

if (!dts || !dts.generateTypes) {
    throw new Error('The editor must publish its federated type contract.');
}

await rm(path.join(context, 'dist/@mf-types.zip'), {
    force: true,
});
await rm(path.join(context, 'dist/@mf-types.d.ts'), {
    force: true,
});
await rm(path.join(context, 'dist/@mf-types'), {
    recursive: true,
    force: true,
});
await rm(path.join(context, 'node_modules/.cache/mf-types/.tsbuildinfo'), {
    force: true,
});
const options = normalizeGenerateTypesOptions({
    context,
    outputDir: 'dist',
    pluginOptions: federationOptions,
    dtsOptions: {
        ...dts,
        generateTypes: {
            ...(typeof dts.generateTypes === 'object' ? dts.generateTypes : {}),
            compileInChildProcess: false,
            abortOnError: true,
        },
    },
});
await generateTypesAPI({
    dtsManagerOptions: options,
});
await access(path.join(context, 'dist/@mf-types.zip'));
await access(path.join(context, 'dist/@mf-types.d.ts'));
