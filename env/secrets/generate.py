import argparse
import json
import os
import re
import secrets
import string
import subprocess
import sys
from pathlib import Path

PLACEHOLDER = re.compile(r"\$\{([a-z][a-z0-9_]*)\}")
FROM_LINE = re.compile(r"^FROM\s+(caddy:\S+-alpine\S*)", re.MULTILINE)
STORE_NAME = "values.json"
DIRECTORIES: tuple[str, ...] = ()
EXAMPLE_GLOBS = (
    "env/**/secret.example.yaml",
    "env/**/.env.example",
    "env/**/*.example.txt",
)


def target_path(example: Path) -> Path:
    """Return the git-ignored file generated from a committed example."""
    if example.name == ".env.example":
        return example.with_name(".env")

    return example.with_name(example.name.replace(".example", ""))


def discover_examples(root: Path) -> list[Path]:
    """Collect every committed example file below the env directory."""
    found: set[Path] = set()

    for pattern in EXAMPLE_GLOBS:
        found.update(root.glob(pattern))

    return sorted(found)


def gateway_image(root: Path) -> str:
    """Read the pinned Caddy runtime image from the gateway Dockerfile."""
    dockerfile = (root / "env/cache/Dockerfile").read_text(encoding="utf-8")
    matches = FROM_LINE.findall(dockerfile)

    if not matches:
        raise ValueError("env/cache/Dockerfile has no caddy alpine runtime stage")

    return matches[-1]


def bcrypt_hash(plaintext: str, image: str) -> str:
    """Hash a password with the Caddy binary of the pinned gateway image."""
    result = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            image,
            "caddy",
            "hash-password",
            "--plaintext",
            plaintext,
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    return result.stdout.strip()


class Generator:
    """Produce and remember generated values so related files stay consistent."""

    def __init__(self, store: Path, image: str) -> None:
        """Load previously generated values from the store file."""
        self.store = store
        self.image = image
        self.values: dict[str, str] = (
            json.loads(store.read_text(encoding="utf-8")) if store.exists() else {}
        )

    def get(self, name: str) -> str:
        """Return the value of a placeholder, generating it on first use."""
        if name not in self.values:
            self.values[name] = self.create(name)
            self.save()

        return self.values[name]

    def create(self, name: str) -> str:
        """Generate a value whose shape depends on the placeholder name."""
        if name == "host_uid":
            return str(os.getuid())

        if name == "host_gid":
            return str(os.getgid())

        if name.endswith("_hash"):
            return bcrypt_hash(self.get(name.removesuffix("_hash")), self.image)

        if name.endswith("_masterkey"):
            alphabet = string.ascii_letters + string.digits

            return "".join(secrets.choice(alphabet) for _ in range(32))

        if name.endswith("_login_password"):
            return secrets.token_hex(12) + "Aa1!"

        return secrets.token_hex(16)

    def save(self) -> None:
        """Persist the values with owner-only permissions."""
        self.store.write_text(
            json.dumps(self.values, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        self.store.chmod(0o600)

    def render(self, template: str) -> str:
        """Substitute every placeholder of a template."""
        return PLACEHOLDER.sub(lambda match: self.get(match.group(1)), template)


def main() -> int:
    """Create every missing secret file from its example without overwriting."""
    parser = argparse.ArgumentParser(
        description="Generate git-ignored secret files from committed examples."
    )
    parser.add_argument("--root", type=Path, default=Path.cwd())
    arguments = parser.parse_args()

    root = arguments.root.resolve()
    generator = Generator(root / "env/secrets" / STORE_NAME, gateway_image(root))

    for directory in DIRECTORIES:
        (root / directory).mkdir(parents=True, exist_ok=True)

    for example in discover_examples(root):
        target = target_path(example)

        if target.exists():
            continue

        target.write_text(
            generator.render(example.read_text(encoding="utf-8")), encoding="utf-8"
        )
        target.chmod(0o644 if target.suffix == ".txt" else 0o600)
        print(f"created {target.relative_to(root)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
