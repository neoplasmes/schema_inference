export type SchemaReference = Readonly<{
    type: 'schema.document' | 'schema.node' | 'schema.collection';
    id: string;
}>;
