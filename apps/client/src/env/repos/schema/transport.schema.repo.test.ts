import { describe, expect, it, vi } from 'vitest';
import { TransportSchemaRepo } from '.';
import type { HttpTransport } from '../../transport';

describe('workspace schema synchronization', () => {
    it('reads the current server summary after an editor save without overwriting a newer revision', async () => {
        const request = vi.fn<HttpTransport['request']>(async () => ({
            id: 'orders',
            title: 'Server title',
            revision: 's3',
            updated_at: '2025-10-20T12:00:00Z',
            document_count: 2,
        }));
        const repository = new TransportSchemaRepo({
            request,
        });
        const summary = await repository.recordSaved({
            schemaId: 'orders',
            revision: 's2',
            savedAt: '2025-10-20T11:00:00Z',
            title: 'Stale title',
        });

        expect(summary).toMatchObject({
            revision: 's3',
            title: 'Server title',
            documentCount: 2,
        });
        expect(request).toHaveBeenCalledWith(
            '/api/v2/schemas/orders',
            expect.objectContaining({
                signal: undefined,
            })
        );
        expect(request.mock.calls[0][1]).not.toHaveProperty('method', 'PUT');
    });
});
