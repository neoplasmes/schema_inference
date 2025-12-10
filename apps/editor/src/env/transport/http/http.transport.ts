import { HttpResponseError } from './httpResponse.error';

export class HttpTransport {
    private readonly base: string;

    constructor(
        baseUrl: string,
        private readonly onUnauthenticated?: () => void
    ) {
        this.base = baseUrl.replace(/\/$/, '');
    }

    async request(path: string, options?: RequestInit): Promise<Response> {
        const response = await fetch(`${this.base}${path}`, {
            ...options,
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(options?.body
                    ? {
                          'Content-Type': 'application/json',
                      }
                    : {}),
                ...options?.headers,
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                this.onUnauthenticated?.();
            }

            throw new HttpResponseError(response.status);
        }

        return response;
    }
}
