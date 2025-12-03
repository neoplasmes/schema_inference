ALTER TABLE resources ADD COLUMN owner TEXT;

CREATE INDEX resources_kind_owner_idx ON resources (kind, owner);

CREATE TABLE changes (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
