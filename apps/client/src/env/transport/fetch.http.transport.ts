import type { HttpTransport } from './http.transport';
import { HttpError } from './http.error';

export class FetchHttpTransport implements HttpTransport {
    private readonly base: string;

    constructor(baseUrl: string) {
        this.base = baseUrl.replace(/\/$/, '');
    }

    async request(path: string, options: RequestInit = {}): Promise<unknown> {
        const headers = new Headers(options.headers);
        headers.set('Accept', 'application/json');

        if (options.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(`${this.base}${path}`, {
            ...options,
            headers,
        });
        const text = await response.text();
        let body: unknown = null;

        if (text) {
            try {
                body = JSON.parse(text);
            } catch (error) {
                if (response.ok) {
                    throw error;
                }

                body = text;
            }
        }

        if (!response.ok) {
            throw new HttpError(response.status, body);
        }

        return body;
    }
}
