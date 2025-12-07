import time
from collections.abc import Iterator
from typing import cast

import pytest
from redis import Redis
from testcontainers.core.container import DockerContainer
from testcontainers.core.wait_strategies import LogMessageWaitStrategy

from app.ports.tools.identity_cache import IdentityCacheError
from core.entities import Identity
from env.tools.identity_cache import ValkeyIdentityCache

IMAGE = "valkey/valkey:9.0.0-alpine"
FUTURE = 10**12


@pytest.fixture(scope="module")
def valkey_url() -> Iterator[str]:
    container = (
        DockerContainer(IMAGE)
        .with_exposed_ports(6379)
        .waiting_for(LogMessageWaitStrategy("Ready to accept connections"))
    )

    with container:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(6379)

        yield f"redis://{host}:{port}/1"


@pytest.fixture
def cache(valkey_url: str) -> Iterator[ValkeyIdentityCache]:
    client = Redis.from_url(valkey_url, decode_responses=True)
    client.flushdb()

    yield ValkeyIdentityCache(client)

    client.flushdb()
    client.close()


def ttl(client: Redis, key: str) -> int:
    return cast(int, client.ttl(key))


def identity(subject: str = "alice") -> Identity:
    return Identity(subject, frozenset({"admin", "editor"}), FUTURE, "jti", "web")


def test_token_round_trip_with_ttl_and_user_index(cache: ValkeyIdentityCache):
    cache.put_token("h1", identity(), 120, 0)
    client = cache._client

    assert cache.get_token("h1") == identity()
    assert 0 < ttl(client, "auth:token:h1") <= 120
    assert client.smembers("auth:user:alice") == {"h1"}
    assert 0 < ttl(client, "auth:user:alice") <= 120


def test_index_ttl_only_grows(cache: ValkeyIdentityCache):
    cache.put_token("h1", identity(), 300, 0)
    cache.put_token("h2", identity(), 30, 0)

    assert ttl(cache._client, "auth:user:alice") > 100


def test_delete_token_removes_it_from_the_index(cache: ValkeyIdentityCache):
    cache.put_token("h1", identity(), 120, 0)
    cache.put_token("h2", identity(), 120, 0)
    cache.delete_token("h1")

    assert cache.get_token("h1") is None
    assert cache.get_token("h2") is not None
    assert cache._client.smembers("auth:user:alice") == {"h2"}


def test_flush_subject_drops_only_that_subjects_tokens(cache: ValkeyIdentityCache):
    cache.put_token("h1", identity("alice"), 120, 0)
    cache.put_token("h2", identity("alice"), 120, 0)
    cache.put_token("h3", identity("bob"), 120, 0)
    cache.flush_subject("alice")

    assert cache.get_token("h1") is None
    assert cache.get_token("h2") is None
    assert cache.get_token("h3") is not None
    assert cache._client.exists("auth:user:alice") == 0


def test_flush_all_keeps_session_links_and_owners(cache: ValkeyIdentityCache):
    cache.put_token("h1", identity("alice"), 120, 0)
    cache.put_token("h3", identity("bob"), 120, 0)
    cache.link_oidc_session("o1", "alice")
    cache.link_session("s1", "alice")
    cache.put_owner("schema", "x", "alice")
    cache.flush_all()

    assert cache.get_token("h1") is None
    assert cache.get_token("h3") is None
    assert cache.subject_of_oidc_session("o1") == "alice"
    assert cache.subject_of_session("s1") == "alice"
    assert cache.get_owner("schema", "x") == "alice"


def test_owner_cache_expires_and_deletes(cache: ValkeyIdentityCache):
    cache.put_owner("analysis", "a1", "alice")

    assert cache.get_owner("analysis", "a1") == "alice"
    assert 0 < ttl(cache._client, "acl:analysis:a1") <= 300

    cache.delete_owner("analysis", "a1")

    assert cache.get_owner("analysis", "a1") is None


def test_unreachable_server_raises_cache_error():
    cache = ValkeyIdentityCache.from_url("redis://127.0.0.1:1/1", timeout=0.2)

    with pytest.raises(IdentityCacheError):
        cache.get_token("h")


def test_put_token_is_refused_after_a_subject_flush(cache: ValkeyIdentityCache):
    started = int(time.time() * 1000)
    cache.flush_subject("alice")

    assert cache.put_token("h1", identity("alice"), 120, started) is False
    assert cache.get_token("h1") is None
    assert cache._client.exists("auth:user:alice") == 0
    assert cache.put_token("h2", identity("bob"), 120, started) is True
    assert 0 < ttl(cache._client, "auth:revoked:alice") <= 3600


def test_put_token_is_refused_after_a_global_flush(cache: ValkeyIdentityCache):
    started = int(time.time() * 1000)
    cache.flush_all()

    assert cache.put_token("h1", identity("alice"), 120, started) is False
    assert cache.put_token("h1", identity("alice"), 120, started + 5000) is True
    assert 0 < ttl(cache._client, "auth:revoked") <= 3600


def test_put_token_after_a_flush_that_it_started_behind_is_stored(
    cache: ValkeyIdentityCache,
):
    cache.flush_subject("alice")
    started = int(time.time() * 1000) + 5000

    assert cache.put_token("h1", identity("alice"), 120, started) is True
    assert cache.get_token("h1") == identity()


def test_deleted_token_cannot_be_cached_again(cache: ValkeyIdentityCache):
    cache.delete_token("h1")

    assert cache.put_token("h1", identity("alice"), 120, 10**15) is False
    assert cache.put_token("h2", identity("alice"), 120, 10**15) is True
    assert 0 < ttl(cache._client, "auth:dead:h1") <= 12 * 3600
