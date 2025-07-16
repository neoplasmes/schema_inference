import path from 'node:path';

import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

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
            clean: true,
        },
        devtool: isProduction ? 'source-map' : 'eval-cheap-module-source-map',
        resolve: {
            extensions: ['.tsx', '.ts', '.js'],
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
                        compilerOptions: { noEmit: false },
                    },
                },
                {
                    test: /\.s?css$/,
                    use: [
                        isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                        'css-loader',
                        'sass-loader',
                    ],
                },
            ],
        },
        plugins: [
            new HtmlWebpackPlugin({ template: './index.html' }),
            isProduction &&
                new MiniCssExtractPlugin({
                    filename: 'assets/[name].[contenthash:8].css',
                }),
        ].filter(Boolean),
        devServer: {
            port: 3000,
            hot: true,
            historyApiFallback: true,
        },
    };
};
