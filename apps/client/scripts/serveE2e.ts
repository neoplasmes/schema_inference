import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.zip': 'application/zip',
};

export async function startServers(): Promise<() => Promise<void>> {
    const servers: Server[] = [];
    const stop = async () => {
        await Promise.all(
            servers.map(
                server =>
                    new Promise<void>((resolve, reject) => {
                        server.close(error => (error ? reject(error) : resolve()));
                        server.closeAllConnections();
                    })
            )
        );
    };
    try {
        for (const [directory, port] of [
            [
                path.join(root, 'dist'),
                4173,
            ],
            [
                path.join(root, '../editor/dist'),
                3010,
            ],
        ] as const) {
            const server = createServer(async (request, response) => {
                response.setHeader('Access-Control-Allow-Origin', '*');
                response.setHeader('Cache-Control', 'no-store');
                const pathname = decodeURIComponent(
                    new URL(request.url ?? '/', 'http://localhost').pathname
                );

                if (port === 4173 && pathname === '/workspace-runtime.json') {
                    response.setHeader('Content-Type', 'application/json');
                    response.end(
                        JSON.stringify({
                            mode: process.env.WORKSPACE_MODE === 'api' ? 'api' : 'mock',
                            apiBaseUrl:
                                process.env.WORKSPACE_MODE === 'api'
                                    ? 'http://127.0.0.1:8010'
                                    : 'mock://workspace',
                        })
                    );

                    return;
                }

                if (port === 4173 && pathname === '/editor-runtime.json') {
                    response.setHeader('Content-Type', 'application/json');
                    response.end(
                        JSON.stringify({
                            editorManifestUrl: 'http://127.0.0.1:3010/mf-manifest.json',
                            apiBaseUrl: 'mock://workspace',
                        })
                    );

                    return;
                }

                let filename = path.resolve(directory, `.${pathname}`);

                if (
                    !filename.startsWith(`${directory}${path.sep}`) &&
                    filename !== directory
                ) {
                    response.writeHead(403).end();

                    return;
                }

                if (!path.extname(pathname)) {
                    filename = path.join(directory, 'index.html');
                }

                try {
                    if (!(await stat(filename)).isFile()) {
                        response.writeHead(404).end();

                        return;
                    }

                    response.setHeader(
                        'Content-Type',
                        types[path.extname(filename)] ?? 'application/octet-stream'
                    );
                    response.end(await readFile(filename));
                } catch {
                    response.writeHead(404).end();
                }
            });
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, '127.0.0.1', () => {
                    server.removeListener('error', reject);
                    resolve();
                });
            });
            servers.push(server);
        }
    } catch (error) {
        await stop();

        throw error;
    }

    return stop;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const stop = await startServers();
    process.once('SIGTERM', () => {
        void stop();
    });
}
