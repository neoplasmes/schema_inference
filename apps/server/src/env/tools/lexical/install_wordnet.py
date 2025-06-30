import json
import os
import urllib.request
from hashlib import sha256
from importlib import resources
from pathlib import Path
from tempfile import NamedTemporaryFile


def install_wordnet(directory: Path) -> Path:
    """Install only the documented historical archive after size and hash checks."""
    manifest = json.loads(
        resources.files("env.tools.lexical")
        .joinpath("resource_manifest.json")
        .read_text(encoding="utf-8")
    )
    source = next(item for item in manifest["sources"] if item["name"] == "WordNet")
    destination = directory / "corpora" / "wordnet.zip"

    if destination.is_file():
        existing = destination.read_bytes()

        if (
            len(existing) == source["size_bytes"]
            and sha256(existing).hexdigest() == source["sha256"]
        ):
            return destination

    with urllib.request.urlopen(source["url"], timeout=60) as response:
        archive = response.read(source["size_bytes"] + 1)

    if (
        len(archive) != source["size_bytes"]
        or sha256(archive).hexdigest() != source["sha256"]
    ):
        raise ValueError(
            "The downloaded WordNet archive does not match its pinned manifest."
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None

    try:
        with NamedTemporaryFile(
            dir=destination.parent, suffix=".part", delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(archive)

        os.replace(temporary_path, destination)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    return destination
