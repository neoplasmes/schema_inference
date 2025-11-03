CREATE TABLE resources (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (kind, id)
);

CREATE TABLE idempotency (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    digest TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    PRIMARY KEY (scope, key)
);

CREATE TABLE analysis_results (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL
);

CREATE TABLE revisions (
    schema_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (schema_id, revision)
);

CREATE TABLE nodes (
    schema_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    id TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (schema_id, revision, id),
    FOREIGN KEY (schema_id, revision) REFERENCES revisions
);

CREATE TABLE collections (
    schema_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    id TEXT NOT NULL,
    PRIMARY KEY (schema_id, revision, id),
    FOREIGN KEY (schema_id, revision) REFERENCES revisions
);

CREATE TABLE members (
    schema_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (schema_id, revision, collection_id, position),
    FOREIGN KEY (schema_id, revision, collection_id) REFERENCES collections
);

CREATE TABLE changesets (
    schema_id TEXT NOT NULL,
    id TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (schema_id, id)
);
