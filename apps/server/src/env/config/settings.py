from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    upload_root: Path
    wordnet_root: Path
    cleanup_delay: float = 300
    allowed_origins: tuple[str, ...] = ("http://localhost:3000",)
    host: str = "127.0.0.1"
    port: int = 8000
