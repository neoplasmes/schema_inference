import pytest
from support import FakeIdentityCache, FakeTokenIntrospection

from app.ports.tools.identity_cache import IdentityCacheError
from app.use_cases.authenticate_token import AuthenticateToken, hash_token
from core.entities import Identity, Principal

NOW = 1_000.0
TOKEN = "opaque-token"


def identity(expires_at: int = 5_000) -> Identity:
    return Identity("alice", frozenset({"editor"}), expires_at)


def build(expires_at: int = 5_000, ttl: int = 300, now: list[float] | None = None):
    clock = now if now is not None else [NOW]
    introspection = FakeTokenIntrospection({TOKEN: identity(expires_at)})
    cache = FakeIdentityCache(lambda: clock[0])

    return (
        AuthenticateToken(introspection, cache, ttl, lambda: clock[0]),
        introspection,
        cache,
    )


def test_miss_introspects_and_caches_by_digest():
    use_case, introspection, cache = build()

    assert use_case.execute(TOKEN) == Principal("alice", frozenset({"editor"}))
    assert introspection.introspected == [TOKEN]
    assert list(cache.tokens) == [hash_token(TOKEN)]
    assert TOKEN not in cache.tokens


def test_token_ended_here_is_refused_although_the_provider_still_accepts_it():
    use_case, introspection, cache = build()
    cache.delete_token(hash_token(TOKEN))

    assert use_case.execute(TOKEN) is None
    assert introspection.introspected == []


def test_hit_skips_introspection():
    use_case, introspection, _ = build()

    use_case.execute(TOKEN)
    use_case.execute(TOKEN)

    assert introspection.introspected == [TOKEN]


def test_ttl_is_the_smaller_of_remaining_lifetime_and_setting():
    use_case, _, cache = build(expires_at=1_100, ttl=300)
    use_case.execute(TOKEN)

    assert cache.ttls[hash_token(TOKEN)] == 100

    use_case, _, cache = build(expires_at=9_000, ttl=300)
    use_case.execute(TOKEN)

    assert cache.ttls[hash_token(TOKEN)] == 300


def test_inactive_token_is_rejected_and_not_cached():
    use_case, _, cache = build()

    assert use_case.execute("unknown") is None
    assert cache.tokens == {}


def test_expired_cache_entry_is_introspected_again():
    clock = [NOW]
    use_case, introspection, _ = build(expires_at=1_100, now=clock)
    use_case.execute(TOKEN)
    clock[0] = 1_200.0

    assert use_case.execute(TOKEN) is not None
    assert len(introspection.introspected) == 2


def test_already_expired_identity_is_authenticated_but_not_cached():
    use_case, _, cache = build(expires_at=900)

    assert use_case.execute(TOKEN) is not None
    assert cache.tokens == {}


def test_cache_outage_falls_back_to_introspection():
    class Broken(FakeIdentityCache):
        def get_token(self, token_hash):
            raise IdentityCacheError("down")

        def put_token(self, token_hash, identity, ttl, started_at):
            raise IdentityCacheError("down")

    introspection = FakeTokenIntrospection({TOKEN: identity()})
    use_case = AuthenticateToken(introspection, Broken(), 300, lambda: NOW)

    assert use_case.execute(TOKEN) is not None


def test_revoked_subject_flush_forces_reintrospection():
    use_case, introspection, cache = build()
    use_case.execute(TOKEN)
    cache.flush_subject("alice")
    use_case.execute(TOKEN)

    assert len(introspection.introspected) == 2


@pytest.mark.parametrize("roles", [frozenset(), frozenset({"admin"})])
def test_roles_flow_into_the_principal(roles):
    introspection = FakeTokenIntrospection({TOKEN: Identity("u", roles, 5_000)})
    use_case = AuthenticateToken(introspection, FakeIdentityCache(), 300, lambda: NOW)

    assert use_case.execute(TOKEN) == Principal("u", roles)


def test_flush_between_introspection_and_put_is_not_cached():
    use_case, introspection, cache = build()
    introspection.after_introspect = lambda: cache.flush_subject("alice")

    assert use_case.execute(TOKEN) is not None
    assert cache.tokens == {}


def test_global_flush_between_introspection_and_put_is_not_cached():
    use_case, introspection, cache = build()
    introspection.after_introspect = cache.flush_all

    assert use_case.execute(TOKEN) is not None
    assert cache.tokens == {}


def test_flush_before_introspection_started_does_not_block_caching():
    clock = [NOW]
    use_case, _, cache = build(now=clock)
    cache.flush_subject("alice")
    clock[0] = NOW + 1

    use_case.execute(TOKEN)

    assert list(cache.tokens) == [hash_token(TOKEN)]
