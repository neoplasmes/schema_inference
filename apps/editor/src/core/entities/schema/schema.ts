export type Snapshot = Readonly<{
    resource: 'schema';
    id: string;
    revision: string;
}>;

export type ExpandedName = Readonly<{
    namespaceUri: string | null;
    localName: string;
}>;
export type Collection = Readonly<{
    id: string;
    totalItems: number;
}>;
export type ScalarType =
    | 'string'
    | 'integer'
    | 'number'
    | 'decimal'
    | 'boolean'
    | 'null'
    | 'date'
    | 'datetime';
export type SchemaProfile =
    | Readonly<{
          syntax: 'xml';
          dialect: 'xsd-1.0';
      }>
    | Readonly<{
          syntax: 'json' | 'yaml';
          dialect: 'json-schema-2020-12';
      }>;

export type SchemaNode = Readonly<{
    id: string;
}> &
    (
        | Readonly<{
              kind: 'scalar';
              scalarType: ScalarType;
              constraints: Readonly<Record<string, unknown>>;
          }>
        | Readonly<{
              kind: 'object';
              properties: Collection;
              additionalProperties: boolean;
          }>
        | Readonly<{
              kind: 'array';
              itemsNodeId: string;
              minItems: number;
              maxItems: number | null;
          }>
        | Readonly<{
              kind: 'union';
              mode: 'anyOf' | 'oneOf';
              options: Collection;
          }>
        | Readonly<{
              kind: 'ref';
              definitionId: string;
          }>
        | Readonly<{
              kind: 'xmlElement';
              name: ExpandedName;
              contentNodeId: string;
              nillable: boolean;
          }>
        | Readonly<{
              kind: 'xmlComplex';
              attributes: Collection;
              particleNodeId: string | null;
              simpleContentNodeId?: string | null;
              mixed: boolean;
          }>
        | Readonly<{
              kind: 'xmlGroup';
              compositor: 'sequence' | 'choice' | 'all';
              particles: Collection;
          }>
    );

export type SchemaMember =
    | Readonly<{
          id: string;
          kind: 'property';
          name: string;
          required: boolean;
          valueNodeId: string;
      }>
    | Readonly<{
          id: string;
          kind: 'option';
          title: string;
          valueNodeId: string;
      }>
    | Readonly<{
          id: string;
          kind: 'xmlAttribute';
          name: ExpandedName;
          required: boolean;
          valueNodeId: string;
      }>
    | Readonly<{
          id: string;
          kind: 'xmlParticle';
          valueNodeId: string;
          minOccurs: number;
          maxOccurs: number | null;
      }>;

export type NodeSummary = Readonly<{
    id: string;
    kind: SchemaNode['kind'];
    label: string;
    directMemberCount: number;
    descendantCount: number | null;
}>;

export type MemberSummary = Readonly<{
    member: SchemaMember;
    valueSummary: NodeSummary;
}>;

export type SchemaDocument = Readonly<{
    snapshot: Snapshot;
    title: string;
    profile: SchemaProfile;
    rootNodeId: string;
}>;

export type DocumentOperation =
    | Readonly<{
          kind: 'renameProperty';
          memberId: string;
          name: string;
      }>
    | Readonly<{
          kind: 'renameXmlName';
          target: Readonly<{
              kind: 'node' | 'member';
              id: string;
          }>;
          name: ExpandedName;
      }>
    | Readonly<{
          kind: 'moveMember';
          memberId: string;
          targetCollectionId: string;
          beforeMemberId: string | null;
      }>;

export function nodeCollections(node: SchemaNode): readonly Collection[] {
    switch (node.kind) {
        case 'object':
            return [
                node.properties,
            ];
        case 'union':
            return [
                node.options,
            ];
        case 'xmlComplex':
            return [
                node.attributes,
            ];
        case 'xmlGroup':
            return [
                node.particles,
            ];
        default:
            return [];
    }
}

export function memberName(row: MemberSummary): string {
    switch (row.member.kind) {
        case 'property':
            return row.member.name;
        case 'xmlAttribute':
            return row.member.name.localName;
        case 'option':
            return row.member.title;
        case 'xmlParticle':
            return row.valueSummary.label;
    }
}
