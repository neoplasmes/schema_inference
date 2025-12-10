import type { HttpErrorInterceptor, InterceptableHttpTransport } from './http.transport';
import { HttpError } from './http.error';

export class FetchHttpTransport implements InterceptableHttpTransport {
    private readonly base: string;
    private readonly interceptors: HttpErrorInterceptor[] = [];

    constructor(baseUrl: string) {
        this.base = baseUrl.replace(/\/$/, '');
    }

    addErrorInterceptor(interceptor: HttpErrorInterceptor): void {
        this.interceptors.push(interceptor);
    }

    async request(path: string, options: RequestInit = {}): Promise<unknown> {
        const headers = new Headers(options.headers);
        headers.set('Accept', 'application/json');

        if (options.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(`${this.base}${path}`, {
            ...options,
            credentials: 'include',
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
            const error = new HttpError(response.status, body);

            for (const interceptor of this.interceptors) {
                interceptor(error);
            }

            throw error;
        }

        return body;
    }
}
