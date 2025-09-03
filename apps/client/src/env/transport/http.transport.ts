export type HttpRequestHandler = (
    path: string,
    options?: RequestInit
) => Promise<Response>;

export interface HttpTransport {
    request(path: string, options?: RequestInit): Promise<unknown>;
}
