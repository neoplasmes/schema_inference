import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

ARCHITECTURES = {"amd64": "x86_64", "arm64": "aarch64"}
TOOLS = {
    "moon": (
        "https://github.com/moonrepo/moon/releases/download/v1.41.5/"
        "moon-{arch}-unknown-linux-musl",
        {
            "amd64": "74b6fa36ce21cd19e5656c19533a148a1d71a59ffb070ddfc8982171fa63451f",
            "arm64": "cf51cae1d39be65b1467c6367d36a758fee611d502a8ba1a47f1419456a77f25",
        },
    ),
    "uv": (
        "https://github.com/astral-sh/uv/releases/download/0.9.4/"
        "uv-{arch}-unknown-linux-gnu.tar.gz",
        {
            "amd64": "e02f7fc102d6a1ebfa3b260b788e9adf35802be28c8d85640e83246e61519c1e",
            "arm64": "c507e8cc4df18ed16533364013d93c2ace2c7f81a2a0d892a0dc833915b02e8b",
        },
    ),
}


def install(architecture: str) -> None:
    """Install checksum-verified historical build tools without a package manager."""
    arch = ARCHITECTURES[architecture]

    for name, (template, checksums) in TOOLS.items():
        with urllib.request.urlopen(
            template.format(arch=arch), timeout=120
        ) as response:
            archive = response.read()

        if hashlib.sha256(archive).hexdigest() != checksums[architecture]:
            raise ValueError(f"Invalid {name} archive checksum")

        data = archive

        if name == "uv":
            with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
                member = next(
                    item
                    for item in bundle.getmembers()
                    if item.isfile() and Path(item.name).name == name
                )
                binary = bundle.extractfile(member)

                if binary is None:
                    raise ValueError(f"Missing {name} executable")

                data = binary.read()

        destination = Path("/usr/local/bin") / name
        destination.write_bytes(data)
        destination.chmod(0o755)


if __name__ == "__main__":
    install(sys.argv[1])
