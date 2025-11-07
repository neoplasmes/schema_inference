import psycopg
from psycopg.rows import DictRow, dict_row


def test_http_server_uses_postgres_through_transaction_pooling(api, api_stack):
    response = api.get("/api/v2/schemas")
    assert response.status_code == 200, response.text

    with psycopg.connect(
        api_stack.url, autocommit=True, prepare_threshold=None
    ) as database:
        assert database.execute("SHOW server_version_num").fetchone() == ("180000",)

    admin_url = api_stack.url.rsplit("/", 1)[0] + "/pgbouncer"

    with psycopg.Connection[DictRow].connect(
        admin_url, autocommit=True, prepare_threshold=None, row_factory=dict_row
    ) as pooler:
        version = pooler.execute("SHOW VERSION").fetchone()
        assert version == {"version": "PgBouncer 1.24.1"}
        configuration = {
            row["key"]: row["value"] for row in pooler.execute("SHOW CONFIG")
        }
        assert configuration["pool_mode"] == "transaction"
        pools = pooler.execute("SHOW POOLS").fetchall()
        assert any(
            pool["database"] == "workspace" and pool["user"] == "workspace"
            for pool in pools
        ), pools
