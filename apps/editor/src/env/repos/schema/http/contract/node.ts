import { ContractViolationError } from './contract_violation.error';
import type { SchemaNode } from '../../../../../core/entities/schema';
import { object, string, nullableString, count, boolean } from './value';
import { parseCollection, parseName } from './document';

export function nodeKind(value: unknown): SchemaNode['kind'] {
    switch (value) {
        case 'scalar':
        case 'object':
        case 'array':
        case 'union':
        case 'ref':
        case 'xmlElement':
        case 'xmlComplex':
        case 'xmlGroup':
            return value;
        default:
            throw new ContractViolationError('Unsupported schema node kind.');
    }
}

export function parseNode(value: unknown): SchemaNode {
    const data = object(value);
    const id = string(data.id);
    const kind = nodeKind(data.kind);

    switch (kind) {
        case 'scalar': {
            const type = data.scalarType;

            if (
                type !== 'string' &&
                type !== 'integer' &&
                type !== 'number' &&
                type !== 'decimal' &&
                type !== 'boolean' &&
                type !== 'null' &&
                type !== 'date' &&
                type !== 'datetime'
            ) {
                throw new ContractViolationError('Unsupported scalar type.');
            }

            return {
                id,
                kind,
                scalarType: type,
                constraints: object(data.constraints),
            };
        }
        case 'object':
            return {
                id,
                kind,
                properties: parseCollection(data.properties),
                additionalProperties: boolean(data.additionalProperties),
            };
        case 'array':
            return {
                id,
                kind,
                itemsNodeId: string(data.itemsNodeId),
                minItems: count(data.minItems),
                maxItems: data.maxItems === null ? null : count(data.maxItems),
            };
        case 'union': {
            if (data.mode !== 'anyOf' && data.mode !== 'oneOf') {
                throw new ContractViolationError('Unsupported union mode.');
            }

            return {
                id,
                kind,
                mode: data.mode,
                options: parseCollection(data.options),
            };
        }
        case 'ref':
            return {
                id,
                kind,
                definitionId: string(data.definitionId),
            };
        case 'xmlElement':
            return {
                id,
                kind,
                name: parseName(data.name),
                contentNodeId: string(data.contentNodeId),
                nillable: boolean(data.nillable),
            };
        case 'xmlComplex': {
            const simpleContentNodeId =
                data.simpleContentNodeId === undefined
                    ? null
                    : nullableString(data.simpleContentNodeId);
            const particleNodeId = nullableString(data.particleNodeId);
            const mixed = boolean(data.mixed);

            if (simpleContentNodeId && (particleNodeId || mixed)) {
                throw new ContractViolationError(
                    'XML simple content cannot also contain child particles or mixed text.'
                );
            }

            return {
                id,
                kind,
                attributes: parseCollection(data.attributes),
                particleNodeId,
                simpleContentNodeId,
                mixed,
            };
        }
        case 'xmlGroup': {
            if (
                data.compositor !== 'sequence' &&
                data.compositor !== 'choice' &&
                data.compositor !== 'all'
            ) {
                throw new ContractViolationError('Unsupported XML group.');
            }

            return {
                id,
                kind,
                compositor: data.compositor,
                particles: parseCollection(data.particles),
            };
        }
    }
}
