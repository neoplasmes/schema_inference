#!/usr/bin/env python3
import hashlib
import os
import platform
import sys
import urllib.request
from pathlib import Path
from tempfile import NamedTemporaryFile

VERSION = "2.40.1"
CHECKSUMS = {
    "x86_64": "5bc26235e4de0be2aa350c13c33bd226d760d3b44cbd29820708788e02a2b6f2",
    "aarch64": "ec4a385c4cd2afa4f5d429e6fe7dd6b2ae3dc251dc4e9332f1ad2cef8fa44554",
}
ROOT = Path(__file__).resolve().parents[2]


def executable() -> Path:
    """Resolve the verified historical Compose binary for Linux and WSL."""
    architecture = platform.machine()

    if platform.system() != "Linux" or architecture not in CHECKSUMS:
        raise RuntimeError("Container tasks require Linux or WSL (amd64/arm64)")

    destination = ROOT / ".proto" / "docker-compose" / VERSION / architecture
    expected = CHECKSUMS[architecture]

    if destination.is_file():
        if hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
            return destination

    url = (
        f"https://github.com/docker/compose/releases/download/v{VERSION}/"
        f"docker-compose-linux-{architecture}"
    )
    print(f"Installing Docker Compose {VERSION}", file=sys.stderr, flush=True)

    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()

    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Invalid Docker Compose checksum")

    destination.parent.mkdir(parents=True, exist_ok=True)

    with NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)

    temporary_path.chmod(0o755)
    temporary_path.replace(destination)

    return destination


if __name__ == "__main__":
    arguments = sys.argv[1:]

    if arguments[:1] == ["compose"]:
        arguments = arguments[1:]

    os.execv(executable(), ["docker-compose", *arguments])
