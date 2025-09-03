import type { HttpRequestHandler, HttpTransport } from './http.transport';
import { HttpError } from './http.error';

export class MockHttpTransport implements HttpTransport {
    constructor(private readonly handler: HttpRequestHandler) {}

    async request(path: string, options: RequestInit = {}): Promise<unknown> {
        options.signal?.throwIfAborted();
        const response = await this.handler(path, options);
        options.signal?.throwIfAborted();
        const body: unknown = await response.json();
        options.signal?.throwIfAborted();

        if (!response.ok) {
            throw new HttpError(response.status, body);
        }

        return body;
    }
}
