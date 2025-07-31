import type { Command } from '../../contracts';
import type { EntityRef } from '../../../core/entities';
import type { EditorDocument } from '../../editor/document';
import type { ChangeReceipt, SchemaRepository } from '../../ports/repos/schema';
import { SchemaWriteRejectedError } from '../../ports/repos/schema';

export type SaveSchemaInput = { document: EditorDocument; mutationId: string };

export class SaveSchemaCommand implements Command<SaveSchemaInput, ChangeReceipt> {
    constructor(private readonly repository: SchemaRepository) {}

    async execute(input: SaveSchemaInput): Promise<ChangeReceipt> {
        const pending = input.document.beginSave(input.mutationId);
        let receipt: ChangeReceipt;

        try {
            receipt = await this.repository.save(
                input.document.manifest.snapshot,
                pending.id,
                pending.operations
            );
        } catch (error) {
            if (error instanceof SchemaWriteRejectedError) {
                input.document.failSave(pending.id);
            }

            throw error;
        }

        if (receipt.clientMutationId !== pending.id) {
            throw new Error('The server confirmed a different save operation.');
        }

        if (receipt.status === 'applied' && receipt.revision !== null) {
            input.document.confirmSave(receipt.revision, pending.id);
        } else if (receipt.status === 'failed' || receipt.status === 'conflicted') {
            input.document.failSave(pending.id);
        }

        return receipt;
    }

    writes(
        input: { document: EditorDocument },
        output: ChangeReceipt
    ): readonly EntityRef[] {
        return output.status === 'applied'
            ? [`schema.document:${input.document.manifest.snapshot.id}`]
            : [];
    }
}
