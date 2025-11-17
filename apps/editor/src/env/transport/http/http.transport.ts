import { HttpResponseError } from './httpResponse.error';

export class HttpTransport {
    private readonly base: string;

    constructor(baseUrl: string) {
        this.base = baseUrl.replace(/\/$/, '');
    }

    async request(path: string, options?: RequestInit): Promise<Response> {
        const response = await fetch(`${this.base}${path}`, {
            ...options,
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
            throw new HttpResponseError(response.status);
        }

        return response;
    }
}
