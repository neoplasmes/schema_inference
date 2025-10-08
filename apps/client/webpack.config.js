import path from 'node:path';

import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { ModuleFederationPlugin } from '@module-federation/enhanced/webpack';
import { readFileSync } from 'node:fs';
import webpack from 'webpack';

const packageManifest = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

/**
 * Builds webpack configuration for the mode passed through the CLI.
 *
 * @param {Record<string, unknown>} _env
 * @param {{ mode?: 'development' | 'production' }} argv
 * @returns {import('webpack').Configuration}
 */
export default (_env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        mode: isProduction ? 'production' : 'development',
        entry: './src/index.tsx',
        output: {
            path: path.resolve(import.meta.dirname, 'dist'),
            filename: isProduction
                ? 'assets/[name].[contenthash:8].js'
                : 'assets/[name].js',
            publicPath: '/',
            uniqueName: 'schema_host',
            clean: true,
        },
        devtool: isProduction ? 'source-map' : 'eval-cheap-module-source-map',
        resolve: {
            extensions: [
                '.tsx',
                '.ts',
                '.js',
            ],
            alias: {
                '@': path.resolve(import.meta.dirname, 'src'),
            },
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true,
                        compilerOptions: {
                            noEmit: false,
                        },
                    },
                },
                {
                    test: /\.css$/,
                    use: [
                        isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                        {
                            loader: 'css-loader',
                            options: {
                                modules: {
                                    auto: /\.module\.css$/,
                                    namedExport: false,
                                },
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new ModuleFederationPlugin({
                name: 'schema_host',
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
                dts: {
                    generateTypes: false,
                    consumeTypes: false,
                },
            }),
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(
                    isProduction ? 'production' : 'development'
                ),
            }),
            new HtmlWebpackPlugin({
                template: './index.html',
            }),
            {
                apply(compiler) {
                    compiler.hooks.thisCompilation.tap(
                        'EditorRuntimeConfiguration',
                        compilation => {
                            compilation.hooks.processAssets.tap(
                                {
                                    name: 'EditorRuntimeConfiguration',
                                    stage: webpack.Compilation
                                        .PROCESS_ASSETS_STAGE_ADDITIONAL,
                                },
                                () =>
                                    compilation.emitAsset(
                                        'editor-runtime.json',
                                        new webpack.sources.RawSource(
                                            readFileSync(
                                                new URL(
                                                    './public/editor-runtime.json',
                                                    import.meta.url
                                                )
                                            )
                                        )
                                    )
                            );
                        }
                    );
                },
            },
            isProduction &&
                new MiniCssExtractPlugin({
                    filename: 'assets/[name].[contenthash:8].css',
                }),
        ].filter(Boolean),
        devServer: {
            port: 3000,
            hot: true,
            client: {
                overlay: {
                    errors: true,
                    warnings: false,
                    runtimeErrors: false,
                },
            },
            historyApiFallback: true,
            setupMiddlewares(middlewares, server) {
                server.app.get('/editor-runtime.json', (_request, response) => {
                    response.json({
                        editorManifestUrl:
                            process.env.EDITOR_REMOTE_MANIFEST_URL ||
                            'http://localhost:3010/mf-manifest.json',
                        apiBaseUrl: process.env.EDITOR_API_BASE_URL || '',
                    });
                });

                return middlewares;
            },
        },
    };
};
