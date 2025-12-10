import { describe, expect, it, vi } from 'vitest';
import { createLoginRedirect, loginUrl } from '.';

describe('login redirect', () => {
    it('builds the login url against the configured API origin', () => {
        expect(loginUrl('', '/edit?schemaId=a')).toBe(
            '/auth/login?returnTo=%2Fedit%3FschemaId%3Da'
        );
        expect(loginUrl('https://api.example.test/', '/')).toBe(
            'https://api.example.test/auth/login?returnTo=%2F'
        );
    });

    it('redirects once with the current path and query', () => {
        const assign = vi.fn();
        const redirect = createLoginRedirect('', {
            pathname: '/edit',
            search: '?schemaId=a',
            assign,
        });

        redirect();
        redirect();

        expect(assign).toHaveBeenCalledTimes(1);
        expect(assign).toHaveBeenCalledWith(
            '/auth/login?returnTo=%2Fedit%3FschemaId%3Da'
        );
    });
});
