import { describe, expect, it, vi } from 'vitest';
import { TransportAnalysisRepo } from '.';
import { AnalysisNotFoundError } from '../../../app/ports/repos/analysis';
import { ContractViolationError } from '../contract';
import { MockHttpTransport } from '../../transport';

const dto = {
    id: 'a1',
    title: 'Catalog',
    revision: 'a1',
    status: 'queued',
    progress: 0,
    created_at: '2025-08-20T10:00:00Z',
    error: null,
    documents: [
        {
            id: 'd1',
            name: 'catalog.json',
            format: 'json',
            size: 2,
            content: '{}',
        },
    ],
};

describe('analysis repository boundary', () => {
    it('validates and maps transport DTOs without leaking protocol fields', async () => {
        const handler = vi.fn(async () => Response.json(dto));
        const repo = new TransportAnalysisRepo(new MockHttpTransport(handler));
        const signal = new AbortController().signal;
        const analysis = await repo.getById('a1', {
            signal,
        });

        expect(analysis.ref).toBe('analysis:a1');
        expect(analysis.documents[0].ref).toBe('document:d1');
        expect(analysis.createdAt).toBe(dto.created_at);
        expect(analysis).not.toHaveProperty('created_at');
        expect(handler).toHaveBeenCalledWith('/api/workspace/analyses/a1', {
            signal,
        });
    });

    it.each([
        {
            ...dto,
            id: 'wrong',
        },
        {
            ...dto,
            progress: 101,
        },
        {
            ...dto,
            status: 'unknown',
        },
        {
            ...dto,
            created_at: 'yesterday',
        },
        {
            ...dto,
            documents: [
                {
                    ...dto.documents[0],
                    format: 'exe',
                },
            ],
        },
        {
            ...dto,
            documents: [
                dto.documents[0],
                dto.documents[0],
            ],
        },
    ])('rejects invalid responses %#', async value => {
        const repo = new TransportAnalysisRepo(
            new MockHttpTransport(async () => Response.json(value))
        );

        await expect(repo.getById('a1')).rejects.toBeInstanceOf(ContractViolationError);
    });

    it('translates a missing resource into the declared port error', async () => {
        const repo = new TransportAnalysisRepo(
            new MockHttpTransport(async () =>
                Response.json(
                    {},
                    {
                        status: 404,
                    }
                )
            )
        );

        await expect(repo.getById('missing')).rejects.toBeInstanceOf(
            AnalysisNotFoundError
        );
    });

    it('keeps write requests uncancellable and includes the retry identity', async () => {
        const handler = vi.fn(async () => Response.json(dto));
        const repo = new TransportAnalysisRepo(new MockHttpTransport(handler));
        await repo.create({
            title: 'Catalog',
            documents: [
                {
                    name: 'catalog.json',
                    format: 'json',
                    size: 2,
                    content: '{}',
                },
            ],
            idempotencyKey: 'attempt',
        });
        const [, options] = handler.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];

        expect(options.signal).toBeUndefined();
        expect(new Headers(options.headers).get('Idempotency-Key')).toBe('attempt');
        expect(JSON.parse(String(options.body)).documents[0].content).toBe('{}');
    });
});
