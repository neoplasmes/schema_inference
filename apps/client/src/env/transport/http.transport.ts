import type { HttpError } from './http.error';

export type HttpRequestHandler = (
    path: string,
    options?: RequestInit
) => Promise<Response>;

export type HttpErrorInterceptor = (error: HttpError) => void;

export interface HttpTransport {
    request(path: string, options?: RequestInit): Promise<unknown>;
}

export interface InterceptableHttpTransport extends HttpTransport {
    addErrorInterceptor(interceptor: HttpErrorInterceptor): void;
}
