import { ContractViolationError } from './contract_violation.error';
import type { MemberSummary, SchemaMember } from '../../../../../core/entities/schema';
import { object, string, count, boolean } from './value';
import { parseName } from './document';
import { nodeKind } from './node';

export function parseMemberSummary(value: unknown): MemberSummary {
    const data = object(value);
    const member = object(data.member);
    const summary = object(data.valueSummary);
    const id = string(member.id);
    const valueNodeId = string(member.valueNodeId);
    let parsed: SchemaMember;

    switch (member.kind) {
        case 'property':
            parsed = {
                id,
                valueNodeId,
                kind: 'property',
                name: string(member.name),
                required: boolean(member.required),
            };
            break;
        case 'option':
            parsed = {
                id,
                valueNodeId,
                kind: 'option',
                title: string(member.title),
            };
            break;
        case 'xmlAttribute':
            parsed = {
                id,
                valueNodeId,
                kind: 'xmlAttribute',
                name: parseName(member.name),
                required: boolean(member.required),
            };
            break;
        case 'xmlParticle':
            parsed = {
                id,
                valueNodeId,
                kind: 'xmlParticle',
                minOccurs: count(member.minOccurs),
                maxOccurs: member.maxOccurs === null ? null : count(member.maxOccurs),
            };
            break;
        default:
            throw new ContractViolationError('Unsupported schema member kind.');
    }

    if (summary.id !== valueNodeId) {
        throw new ContractViolationError(
            'The member summary does not describe its value.'
        );
    }

    return {
        member: parsed,
        valueSummary: {
            id: valueNodeId,
            kind: nodeKind(summary.kind),
            label: string(summary.label),
            directMemberCount: count(summary.directMemberCount),
            descendantCount:
                summary.descendantCount === null ? null : count(summary.descendantCount),
        },
    };
}
