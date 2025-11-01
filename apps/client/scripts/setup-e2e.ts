import { startServers } from './serve-e2e';
import { startBackend } from './start-backend-e2e';

export default async function setup(): Promise<() => Promise<void>> {
    const stopBackend =
        process.env.WORKSPACE_MODE === 'api' ? await startBackend() : async () => {};

    try {
        const stopServers = await startServers();

        return async () => {
            try {
                await stopServers();
            } finally {
                await stopBackend();
            }
        };
    } catch (error) {
        await stopBackend();

        throw error;
    }
}
