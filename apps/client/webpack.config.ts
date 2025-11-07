import path from 'node:path';
import { fileURLToPath } from 'node:url';

import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { ModuleFederationPlugin } from '@module-federation/enhanced/webpack';
import { readFileSync } from 'node:fs';
import webpack from 'webpack';
import type { Configuration } from 'webpack';
import type { Configuration as DevelopmentServerConfiguration } from 'webpack-dev-server';

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageManifest = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
    dependencies: Record<string, string>;
};

/**
 * Builds webpack configuration for the mode passed through the CLI.
 */
export default (
    _environment: unknown,
    argv: {
        mode?: string;
    }
): Configuration & {
    devServer: DevelopmentServerConfiguration;
} => {
    const isProduction = argv.mode === 'production';

    return {
        mode: isProduction ? 'production' : 'development',
        entry: './src/index.tsx',
        output: {
            path: path.resolve(directory, 'dist'),
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
                '@': path.resolve(directory, 'src'),
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
                                () => {
                                    for (const name of [
                                        'editor-runtime.json',
                                        'workspace-runtime.json',
                                    ]) {
                                        compilation.emitAsset(
                                            name,
                                            new webpack.sources.RawSource(
                                                readFileSync(
                                                    new URL(
                                                        `./public/${name}`,
                                                        import.meta.url
                                                    )
                                                )
                                            )
                                        );
                                    }
                                }
                            );
                        }
                    );
                },
            },
            ...(isProduction
                ? [
                      new MiniCssExtractPlugin({
                          filename: 'assets/[name].[contenthash:8].css',
                      }),
                  ]
                : []),
        ],
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
                if (!server.app) {
                    throw new Error('The development server is not initialized.');
                }

                server.app.get('/workspace-runtime.json', (_request, response) => {
                    const mode = process.env.WORKSPACE_MODE === 'mock' ? 'mock' : 'api';
                    response.json({
                        mode,
                        apiBaseUrl:
                            process.env.WORKSPACE_API_BASE_URL ||
                            (mode === 'api'
                                ? `http://localhost:${process.env.PORT || '8000'}`
                                : 'mock://workspace'),
                    });
                });
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
