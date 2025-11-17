import { ContractViolationError } from './contractViolation.error';
import type {
    Collection,
    ExpandedName,
    SchemaDocument,
    SchemaProfile,
    Snapshot,
} from '../../../../../core/entities/schema';
import { object, string, nullableString, count, version } from './value';

export function parseSnapshot(value: unknown): Snapshot {
    const data = object(value);

    if (data.resource !== 'schema') {
        throw new ContractViolationError('Expected a schema snapshot.');
    }

    return {
        resource: 'schema',
        id: string(data.id),
        revision: string(data.revision),
    };
}

export function parseManifest(value: unknown): SchemaDocument {
    const data = object(value);
    version(data);

    if (data.format !== 'schema-draft') {
        throw new ContractViolationError('Expected an editable schema manifest.');
    }

    const profile = object(data.profile);
    let parsedProfile: SchemaProfile;

    if (profile.syntax === 'xml' && profile.dialect === 'xsd-1.0') {
        parsedProfile = {
            syntax: 'xml',
            dialect: 'xsd-1.0',
        };
    } else if (
        (profile.syntax === 'json' || profile.syntax === 'yaml') &&
        profile.dialect === 'json-schema-2020-12'
    ) {
        parsedProfile = {
            syntax: profile.syntax,
            dialect: 'json-schema-2020-12',
        };
    } else {
        throw new ContractViolationError('Unsupported schema profile.');
    }

    return {
        snapshot: parseSnapshot(data.snapshot),
        title: string(data.title),
        rootNodeId: string(data.rootNodeId),
        profile: parsedProfile,
    };
}

export function parseCollection(value: unknown): Collection {
    const data = object(value);

    return {
        id: string(data.id),
        totalItems: count(data.totalItems),
    };
}

export function parseName(value: unknown): ExpandedName {
    const data = object(value);

    return {
        namespaceUri: nullableString(data.namespaceUri),
        localName: string(data.localName),
    };
}
