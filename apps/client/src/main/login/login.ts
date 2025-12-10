export interface LoginLocation {
    pathname: string;
    search: string;
    assign(url: string): void;
}

export function loginUrl(apiBaseUrl: string, returnTo: string): string {
    return `${apiBaseUrl.replace(/\/$/, '')}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function createLoginRedirect(
    apiBaseUrl: string,
    location: LoginLocation
): () => void {
    let redirecting = false;

    return () => {
        if (redirecting) {
            return;
        }

        redirecting = true;
        location.assign(loginUrl(apiBaseUrl, `${location.pathname}${location.search}`));
    };
}
