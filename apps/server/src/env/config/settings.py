from dataclasses import dataclass
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    upload_root: Path = SERVER_ROOT / "uploaded_files"
    wordnet_root: Path = SERVER_ROOT / "nltk_data"
    semantic_model_root: Path = SERVER_ROOT / "FinetunedModel" / "bge_finetuned_nouns"
    cleanup_delay: float = 300
    allowed_origins: tuple[str, ...] = ("http://localhost:3000",)
    host: str = "127.0.0.1"
    port: int = 8000
