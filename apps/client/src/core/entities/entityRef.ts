export type EntityName = 'schema' | 'analysis' | 'document' | 'session';
export type EntityRef = EntityName | `${EntityName}:${string}`;
