import { describe, expect, it, vi } from 'vitest';
import { CreateAnalysis, InvalidAnalysisInputError } from '.';
import { GetAnalysis } from '../../queries/getAnalysis';
import { ListSchemas } from '../../queries/listSchemas';
import { GetSchema } from '../../queries/getSchema';
import { RecordSchemaSaved } from '../recordSchemaSaved';
import type { AnalysisRepo, CreateAnalysisInput, SchemaRepo } from '../../ports/repos';
import type { Analysis, SchemaSummary } from '../../../core/entities';

const input: CreateAnalysisInput = {
    title: ' Catalog ',
    idempotencyKey: 'attempt-1',
    documents: [
        {
            name: 'catalog.json',
            format: 'json',
            size: 2,
            content: '{}',
        },
    ],
};
const analysis: Analysis = {
    ref: 'analysis:a1',
    id: 'a1',
    title: 'Catalog',
    revision: 'a1',
    status: 'queued',
    progress: 0,
    createdAt: '2025-08-20T10:00:00Z',
    error: null,
    documents: [
        {
            ...input.documents[0],
            id: 'd1',
            ref: 'document:d1',
        },
    ],
};
const schema: SchemaSummary = {
    ref: 'schema:s1',
    id: 's1',
    title: 'Catalog',
    revision: 'r1',
    updatedAt: '2025-08-20T10:00:00Z',
    documentCount: 1,
};

describe('workspace application contracts', () => {
    it('accepts an interchangeable repository and propagates read cancellation', async () => {
        const repo: AnalysisRepo = {
            create: vi.fn(async () => analysis),
            getById: vi.fn(async () => analysis),
        };
        const command = new CreateAnalysis(repo);
        const query = new GetAnalysis(repo);
        const controller = new AbortController();

        expect(await command.execute(input)).toBe(analysis);
        expect(repo.create).toHaveBeenCalledWith({
            ...input,
            title: 'Catalog',
        });
        expect(
            await query.execute(
                {
                    id: 'a1',
                },
                {
                    signal: controller.signal,
                }
            )
        ).toBe(analysis);
        expect(repo.getById).toHaveBeenCalledWith('a1', {
            signal: controller.signal,
        });
        expect(
            query.reads({
                id: 'a1',
            })
        ).toEqual([
            'analysis:a1',
            'document',
        ]);
        expect(command.writes(input, analysis)).toEqual([
            'analysis',
            'analysis:a1',
            'document',
            'document:d1',
        ]);
    });

    it('rejects an empty upload before the repository is called', () => {
        const create = vi.fn(async () => analysis);
        const command = new CreateAnalysis({
            create,
            getById: async () => analysis,
        });

        expect(() =>
            command.execute({
                ...input,
                documents: [],
            })
        ).toThrow(InvalidAnalysisInputError);
        expect(() =>
            command.execute({
                ...input,
                documents: [
                    {
                        ...input.documents[0],
                        content: ' ',
                    },
                ],
            })
        ).toThrow(InvalidAnalysisInputError);
        expect(create).not.toHaveBeenCalled();
    });

    it('declares list and entity invalidation after an editor save', async () => {
        const repo: SchemaRepo = {
            list: vi.fn(async () => [
                schema,
            ]),
            getById: vi.fn(async () => schema),
            recordSaved: vi.fn(async () => schema),
        };
        const command = new RecordSchemaSaved(repo);
        const list = new ListSchemas(repo);
        const detail = new GetSchema(repo);
        const saved = {
            schemaId: 's1',
            revision: 'r1',
            savedAt: schema.updatedAt,
        };
        const signal = new AbortController().signal;

        expect(await command.execute(saved)).toBe(schema);
        expect(command.writes(saved, schema)).toEqual([
            'schema',
            'schema:s1',
        ]);
        expect(list.reads()).toEqual([
            'schema',
        ]);
        expect(
            detail.reads({
                id: 's1',
            })
        ).toEqual([
            'schema:s1',
        ]);
        expect(
            await list.execute(
                {},
                {
                    signal,
                }
            )
        ).toEqual([
            schema,
        ]);
        expect(repo.list).toHaveBeenCalledWith({
            signal,
        });
        expect(
            await detail.execute(
                {
                    id: 's1',
                },
                {
                    signal,
                }
            )
        ).toBe(schema);
        expect(repo.getById).toHaveBeenCalledWith('s1', {
            signal,
        });
    });
});
