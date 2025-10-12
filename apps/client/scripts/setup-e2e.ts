import { startServers } from './serve-e2e';

export default async function setup(): Promise<() => Promise<void>> {
    return startServers();
}
