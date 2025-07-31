export type EntityName =
    | 'schema.document'
    | 'schema.snapshot'
    | 'schema.node'
    | 'schema.collection';

export type EntityRef = EntityName | `${EntityName}:${string}`;
