import { DocumentEditError } from './document_edit.error';
import { memberName } from '../../entities/schema';
import type { DocumentEdit, DocumentEditState } from './contracts';
import { findMember } from './members';

export function createRenameEdit(
    state: DocumentEditState,
    memberId: string,
    name: string
): DocumentEdit | null {
    const found = findMember(state.collections, memberId);

    if (!found) {
        throw new DocumentEditError('Load the field before renaming it.');
    }

    const { row } = found;
    const previousName = memberName(row);

    if (name === previousName) {
        return null;
    }

    if (row.member.kind === 'property') {
        return {
            forward: { kind: 'renameProperty', memberId, name },
            inverse: { kind: 'renameProperty', memberId, name: previousName },
        };
    }

    if (row.member.kind === 'xmlAttribute') {
        const target = { kind: 'member' as const, id: memberId };

        return {
            forward: {
                kind: 'renameXmlName',
                target,
                name: { ...row.member.name, localName: name },
            },
            inverse: { kind: 'renameXmlName', target, name: row.member.name },
        };
    }

    const node = state.nodes.get(row.member.valueNodeId);

    if (row.member.kind !== 'xmlParticle' || node?.kind !== 'xmlElement') {
        throw new DocumentEditError('Load the XML element before renaming it.');
    }

    const target = { kind: 'node' as const, id: node.id };

    return {
        forward: {
            kind: 'renameXmlName',
            target,
            name: { ...node.name, localName: name },
        },
        inverse: {
            kind: 'renameXmlName',
            target,
            name: { ...node.name, localName: previousName },
        },
    };
}
