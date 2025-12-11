"""Print shell exports of the Bruno client credentials for a target."""

import argparse
import base64
import json
import shlex
import subprocess
import sys
from pathlib import Path

CONTEXT = "k3d-schema-workspace"
NAMESPACE = "schema-workspace"
SECRETS = ("identity-clients", "server-identity")
KEYS = (
    "BRUNO_CLIENT_ID",
    "BRUNO_CLIENT_SECRET",
    "BRUNO_OTHER_CLIENT_ID",
    "BRUNO_OTHER_CLIENT_SECRET",
    "AUTH_PROJECT_ID",
    "ZITADEL_ADMIN_PAT",
)


def read_cluster() -> dict[str, str]:
    """Read the credentials from the identity Secrets of the k3d cluster."""
    values: dict[str, str] = {}

    for name in SECRETS:
        output = subprocess.run(
            [
                "kubectl",
                "--context",
                CONTEXT,
                "-n",
                NAMESPACE,
                "get",
                "secret",
                name,
                "-o",
                "json",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout

        for key, encoded in (json.loads(output).get("data") or {}).items():
            values[key] = base64.b64decode(encoded).decode()

    pat = subprocess.run(
        [
            "kubectl",
            "--context",
            CONTEXT,
            "-n",
            NAMESPACE,
            "get",
            "secret",
            "iam-admin-pat",
            "-o",
            "jsonpath={.data.pat}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    values["ZITADEL_ADMIN_PAT"] = base64.b64decode(pat).decode().strip()

    return values


def read_compose(path: Path) -> dict[str, str]:
    """Read the credentials from the env file written by the compose bootstrap."""
    values: dict[str, str] = {}

    for line in path.read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        values[key] = value

    pat = path.parent / "identity-bootstrap" / "iam-admin.pat"
    values["ZITADEL_ADMIN_PAT"] = pat.read_text(encoding="utf-8").strip()

    return values


def main() -> int:
    """Print an export line for every credential the collection needs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("cluster", "compose"), required=True)
    parser.add_argument("--file", type=Path, default=Path("env/local/identity.env"))
    arguments = parser.parse_args()

    values = (
        read_cluster()
        if arguments.target == "cluster"
        else read_compose(arguments.file)
    )

    for key in KEYS:
        print(f"export {key}={shlex.quote(values[key])}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
