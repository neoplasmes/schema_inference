import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../../../../app/editor/document';
import { SaveSchemaCommand } from '../../../../app/commands';
import { HttpSchemaRepository } from '.';
import { HttpTransport, HttpResponseError } from '../../../transport/http';
import { ContractViolationError } from './contract';

const snapshot = { resource: 'schema', id: 'orders', revision: 's1' } as const;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('HTTP schema boundaries', () => {
    it('preserves technical failures and distinguishes invalid server contracts', async () => {
        const repository = new HttpSchemaRepository(
            new HttpTransport('https://example.invalid')
        );
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
        );

        await expect(repository.readNode(snapshot, 'root')).rejects.toBeInstanceOf(
            HttpResponseError
        );
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response('{"id":17,"kind":"scalar"}', { status: 200 })
                )
        );

        await expect(repository.readNode(snapshot, 'root')).rejects.toBeInstanceOf(
            ContractViolationError
        );
    });

    it('rejects a manifest or node from another resource', async () => {
        const repository = new HttpSchemaRepository(
            new HttpTransport('https://example.invalid')
        );
        const manifest = {
            contractVersion: 2,
            format: 'schema-draft',
            snapshot: { ...snapshot, id: 'different' },
            title: 'Orders',
            rootNodeId: 'root',
            profile: { syntax: 'xml', dialect: 'xsd-1.0' },
        };
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json(manifest))
            .mockResolvedValueOnce(
                Response.json({
                    id: 'other',
                    kind: 'scalar',
                    scalarType: 'string',
                    constraints: {},
                })
            );
        vi.stubGlobal('fetch', fetch);
        await expect(
            repository.open({ kind: 'schema', schemaId: 'orders', revision: 's1' })
        ).rejects.toThrow('another schema snapshot');
        await expect(repository.readNode(snapshot, 'requested')).rejects.toThrow(
            'another schema node'
        );
    });

    it('does not create a draft from a mismatched analysis response', async () => {
        const fetch = vi.fn().mockResolvedValue(
            Response.json({
                contractVersion: 2,
                format: 'schema-analysis',
                snapshot: { resource: 'analysis', id: 'different', revision: 'a1' },
            })
        );
        vi.stubGlobal('fetch', fetch);
        await expect(
            new HttpSchemaRepository(new HttpTransport('')).createFromAnalysis({
                kind: 'analysis',
                analysisId: 'expected',
                revision: 'a1',
            })
        ).rejects.toThrow('another analysis snapshot');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('allows correcting a definitively rejected payload with a new mutation identity', async () => {
        const document = new EditorDocument({
            snapshot,
            title: 'Orders',
            rootNodeId: 'root',
            profile: { syntax: 'json', dialect: 'json-schema-2020-12' },
        });
        document.addPage({
            snapshot,
            collectionId: 'fields',
            scopeId: null,
            items: [
                {
                    member: {
                        id: 'name',
                        kind: 'property',
                        name: 'name',
                        required: true,
                        valueNodeId: 'string',
                    },
                    valueSummary: {
                        id: 'string',
                        kind: 'scalar',
                        label: 'string',
                        directMemberCount: 0,
                        descendantCount: 0,
                    },
                },
            ],
            totalItems: 1,
            nextCursor: null,
        });
        document.rename('name', 'invalid');
        const fetch = vi.fn().mockResolvedValue(new Response('', { status: 422 }));
        vi.stubGlobal('fetch', fetch);
        const command = new SaveSchemaCommand(
            new HttpSchemaRepository(new HttpTransport(''))
        );
        await expect(command.execute({ document, mutationId: 'first' })).rejects.toThrow(
            'rejected'
        );
        document.rename('name', 'corrected');
        await expect(command.execute({ document, mutationId: 'second' })).rejects.toThrow(
            'rejected'
        );
        const request = fetch.mock.calls[1][1] as RequestInit;
        const body: unknown = JSON.parse(String(request.body));
        expect(body).toMatchObject({
            clientMutationId: 'second',
            operations: [{ name: 'invalid' }, { name: 'corrected' }],
        });
        expect(request.headers).toMatchObject({ 'If-Match': '"orders:s1"' });
    });
});
