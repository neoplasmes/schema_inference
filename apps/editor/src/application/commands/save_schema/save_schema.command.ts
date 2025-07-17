import type { SchemaReference } from '../../../core/schema_reference';
import type { EditorDocument } from '../../editor/editor_document';
import type { ChangeReceipt, SchemaRepository } from '../../ports/repos/schema.repo';
import { SchemaWriteRejectedError } from '../../ports/repos/schema.repo.error';

export class SaveSchemaCommand {
    constructor(private readonly repository: SchemaRepository) {}

    async execute(input: {
        document: EditorDocument;
        mutationId: string;
    }): Promise<ChangeReceipt> {
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
    ): readonly SchemaReference[] {
        return output.status === 'applied'
            ? [{ type: 'schema.document', id: input.document.manifest.snapshot.id }]
            : [];
    }
}
