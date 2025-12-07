import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast, get_args

from dotenv import load_dotenv

Environment = Literal["development", "production"]


@dataclass(frozen=True)
class Settings:
    environment: Environment
    host: str
    port: int
    upload_root: Path
    wordnet_root: Path
    cleanup_delay: float
    allowed_origins: tuple[str, ...]
    database_url: str = "postgresql://workspace:REDACTED@127.0.0.1:6432/workspace"
    cache_purge_url: str = ""
    cache_purge_user: str = ""
    cache_purge_password: str = ""
    valkey_url: str = ""
    auth_issuer: str = ""
    auth_internal_url: str = ""
    auth_client_id: str = ""
    auth_client_secret: str = ""
    auth_api_client_id: str = ""
    auth_api_client_secret: str = ""
    auth_project_id: str = ""
    auth_redirect_uri: str = ""
    auth_post_logout_uri: str = "/"
    auth_cookie_secure: bool = False
    auth_cache_ttl: int = 300
    auth_trust_gateway: bool = False
    auth_webhook_signing_key: str = ""

    @property
    def is_development(self) -> bool:
        return self.environment == "development"


def flag(name: str) -> bool:
    """Read a boolean environment variable, false when unset."""
    return os.environ.get(name, "false").strip().lower() in ("1", "true", "yes")


def load_settings(env_file: Path = Path(".env")) -> Settings:
    """Read settings from the process environment completed by the ``.env`` file.

    Variables already present in the process environment take priority over
    the file, so deployments can override any value without editing it.
    """
    load_dotenv(env_file)

    environment = os.environ.get("APP_ENV", "production")

    if environment not in get_args(Environment):
        raise ValueError(f"Unknown APP_ENV '{environment}'")

    origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")

    return Settings(
        environment=cast(Environment, environment),
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        upload_root=Path(os.environ.get("UPLOAD_ROOT", "uploaded_files")).resolve(),
        wordnet_root=Path(os.environ.get("WORDNET_ROOT", "nltk_data")).resolve(),
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql://workspace:REDACTED@127.0.0.1:6432/workspace"
        ),
        cache_purge_url=os.environ.get("CACHE_PURGE_URL", ""),
        cache_purge_user=os.environ.get("CACHE_PURGE_USER", ""),
        cache_purge_password=os.environ.get("CACHE_PURGE_PASSWORD", ""),
        valkey_url=os.environ.get("VALKEY_URL", ""),
        auth_issuer=os.environ.get("AUTH_ISSUER", ""),
        auth_internal_url=os.environ.get("AUTH_INTERNAL_URL", ""),
        auth_client_id=os.environ.get("AUTH_CLIENT_ID", ""),
        auth_client_secret=os.environ.get("AUTH_CLIENT_SECRET", ""),
        auth_api_client_id=os.environ.get("AUTH_API_CLIENT_ID", ""),
        auth_api_client_secret=os.environ.get("AUTH_API_CLIENT_SECRET", ""),
        auth_project_id=os.environ.get("AUTH_PROJECT_ID", ""),
        auth_redirect_uri=os.environ.get("AUTH_REDIRECT_URI", ""),
        auth_post_logout_uri=os.environ.get("AUTH_POST_LOGOUT_URI", "/"),
        auth_cookie_secure=flag("AUTH_COOKIE_SECURE"),
        auth_cache_ttl=int(os.environ.get("AUTH_CACHE_TTL", "300")),
        auth_trust_gateway=flag("AUTH_TRUST_GATEWAY"),
        auth_webhook_signing_key=os.environ.get("AUTH_WEBHOOK_SIGNING_KEY", ""),
        cleanup_delay=float(os.environ.get("CLEANUP_DELAY", "300")),
        allowed_origins=tuple(
            origin.strip() for origin in origins.split(",") if origin.strip()
        ),
    )
