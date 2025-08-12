export type Entity = Readonly<
    {
        ref: string;
    } & Record<string, unknown>
>;

export type NormalizedValue =
    | Readonly<{
          kind: 'value';
          value: unknown;
      }>
    | Readonly<{
          kind: 'entity';
          ref: string;
      }>
    | Readonly<{
          kind: 'array';
          items: readonly NormalizedValue[];
      }>
    | Readonly<{
          kind: 'object';
          fields: Readonly<Record<string, NormalizedValue>>;
      }>;

export type EntityPatch =
    | Readonly<{
          ref: string;
          patch: object;
      }>
    | Readonly<{
          ref: string;
          remove: true;
      }>;

export type OptimisticLayer = Readonly<{
    apply(patches: readonly EntityPatch[]): void;
    discard(): void;
}>;

export type EntityRecord = Readonly<Record<string, NormalizedValue>>;
