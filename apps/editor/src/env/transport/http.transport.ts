export class HttpTransport {
    private readonly base: string;

    constructor(baseUrl: string) {
        this.base = baseUrl.replace(/\/$/, '');
    }

    request(path: string, options?: RequestInit): Promise<Response> {
        return fetch(`${this.base}${path}`, {
            ...options,
            headers: {
                Accept: 'application/json',
                ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                ...options?.headers,
            },
        });
    }
}
