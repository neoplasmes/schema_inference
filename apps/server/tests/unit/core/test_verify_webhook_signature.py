import hashlib
import hmac

from core.processes.verify_webhook_signature import verify_webhook_signature

KEY = "signing-key"
BODY = b'{"event_type":"user.locked"}'
NOW = 1_700_000_000


def sign(timestamp: int, body: bytes = BODY, key: str = KEY) -> str:
    return hmac.new(
        key.encode(), f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()


def test_valid_signature_is_accepted():
    header = f"t={NOW},v1={sign(NOW)}"

    assert verify_webhook_signature(KEY, header, BODY, NOW)


def test_any_listed_signature_may_match():
    header = f"t={NOW},v1={'0' * 64},v1={sign(NOW)}"

    assert verify_webhook_signature(KEY, header, BODY, NOW)


def test_wrong_key_or_body_is_rejected():
    header = f"t={NOW},v1={sign(NOW)}"

    assert not verify_webhook_signature("other", header, BODY, NOW)
    assert not verify_webhook_signature(KEY, header, BODY + b" ", NOW)


def test_stale_and_future_timestamps_are_rejected():
    old = NOW - 301
    future = NOW + 301

    assert not verify_webhook_signature(KEY, f"t={old},v1={sign(old)}", BODY, NOW)
    assert not verify_webhook_signature(KEY, f"t={future},v1={sign(future)}", BODY, NOW)
    assert verify_webhook_signature(
        KEY, f"t={NOW - 300},v1={sign(NOW - 300)}", BODY, NOW
    )


def test_malformed_headers_are_rejected():
    for header in ("", "garbage", f"v1={sign(NOW)}", "t=abc,v1=00", f"t={NOW}"):
        assert not verify_webhook_signature(KEY, header, BODY, NOW)


def test_missing_key_never_verifies():
    assert not verify_webhook_signature(
        "", f"t={NOW},v1={sign(NOW, key='')}", BODY, NOW
    )
