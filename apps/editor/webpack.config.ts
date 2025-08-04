import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { ModuleFederationPlugin } from '@module-federation/enhanced/webpack';
import type { Configuration } from 'webpack';
import type { Configuration as DevelopmentServerConfiguration } from 'webpack-dev-server';

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageManifest = JSON.parse(
    readFileSync(path.join(directory, 'package.json'), 'utf8')
) as {
    dependencies: Record<string, string>;
};

export default (
    _environment: unknown,
    arguments_: { mode?: string }
): Configuration & {
    devServer: DevelopmentServerConfiguration;
} => ({
    mode: arguments_.mode === 'production' ? 'production' : 'development',
    entry: './src/index.ts',
    output: {
        path: path.join(directory, 'dist'),
        publicPath: 'auto',
        uniqueName: 'schema_editor',
        filename: 'assets/[name].[contenthash:8].js',
        clean: true,
    },
    devtool: 'source-map',
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                loader: 'ts-loader',
                options: { transpileOnly: true, compilerOptions: { noEmit: false } },
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    {
                        loader: 'css-loader',
                        options: {
                            modules: {
                                auto: /\.module\.css$/,
                                namedExport: false,
                                localIdentName:
                                    'schema-editor__[name]__[local]__[hash:base64:5]',
                            },
                        },
                    },
                ],
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({ template: './index.html' }),
        new ModuleFederationPlugin({
            name: 'schema_editor',
            filename: 'remoteEntry.js',
            exposes: {
                './Editor': './src/expose/editor',
                './mount': './src/expose/mount',
            },
            shared: {
                react: {
                    singleton: true,
                    requiredVersion: packageManifest.dependencies.react,
                },
                'react-dom': {
                    singleton: true,
                    requiredVersion: packageManifest.dependencies['react-dom'],
                },
            },
            dts: { generateTypes: { abortOnError: true }, consumeTypes: false },
            manifest: { disableAssetsAnalyze: arguments_.mode !== 'production' },
        }),
    ],
    devServer: {
        host: '0.0.0.0',
        port: 3010,
        hot: true,
        historyApiFallback: true,
        headers: { 'Access-Control-Allow-Origin': '*' },
    },
});
