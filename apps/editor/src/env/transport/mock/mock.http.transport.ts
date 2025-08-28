import { HttpResponseError } from '../http';

export type MockRequest = (path: string, options?: RequestInit) => Promise<Response>;

export class MockHttpTransport {
    constructor(private readonly handler: MockRequest) {}

    async request(path: string, options?: RequestInit): Promise<Response> {
        options?.signal?.throwIfAborted();
        const response = await this.handler(path, options);
        options?.signal?.throwIfAborted();

        if (!response.ok) {
            throw new HttpResponseError(response.status);
        }

        return response;
    }
}
