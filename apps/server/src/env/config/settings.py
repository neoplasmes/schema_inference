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
    database_url: str = "postgresql://workspace:workspace@127.0.0.1:6432/workspace"

    @property
    def is_development(self) -> bool:
        return self.environment == "development"


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
            "DATABASE_URL", "postgresql://workspace:workspace@127.0.0.1:6432/workspace"
        ),
        cleanup_delay=float(os.environ.get("CLEANUP_DELAY", "300")),
        allowed_origins=tuple(
            origin.strip() for origin in origins.split(",") if origin.strip()
        ),
    )
