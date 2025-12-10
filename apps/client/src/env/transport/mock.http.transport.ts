import type {
    HttpErrorInterceptor,
    HttpRequestHandler,
    InterceptableHttpTransport,
} from './http.transport';
import { HttpError } from './http.error';

export class MockHttpTransport implements InterceptableHttpTransport {
    private readonly interceptors: HttpErrorInterceptor[] = [];

    constructor(private readonly handler: HttpRequestHandler) {}

    addErrorInterceptor(interceptor: HttpErrorInterceptor): void {
        this.interceptors.push(interceptor);
    }

    async request(path: string, options: RequestInit = {}): Promise<unknown> {
        options.signal?.throwIfAborted();
        const response = await this.handler(path, options);
        options.signal?.throwIfAborted();
        const text = await response.text();
        const body: unknown = text ? JSON.parse(text) : null;
        options.signal?.throwIfAborted();

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
