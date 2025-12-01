"""Check that the Bruno collection covers every OpenAPI operation."""

import argparse
import re
import sys
from pathlib import Path

import yaml

METHODS = ("get", "post", "put", "patch", "delete", "head", "options")
EXCLUDED_FOLDERS = ("errors", "cache", "environments")
TEMPLATE_PARAMETER = re.compile(r"\{\{[^{}]+\}\}|\{[^{}]+\}")
REQUEST_BLOCK = re.compile(
    r"^(" + "|".join(METHODS) + r")\s*\{[^}]*?^\s*url:\s*(\S+)",
    re.MULTILINE | re.DOTALL,
)
Operation = tuple[str, str]


def normalize(path: str) -> str:
    """Reduce a URL or path template to a comparable form with ``{}`` parameters."""
    path = path.replace("{{baseUrl}}", "")
    path = path.split("?", 1)[0]
    path = TEMPLATE_PARAMETER.sub("{}", path)
    path = path.rstrip("/") or "/"

    return path if path.startswith("/") else f"/{path}"


def load_operations(spec: Path) -> set[Operation]:
    """Return the method and normalised path of each operation in the spec."""
    document = yaml.safe_load(spec.read_text(encoding="utf-8"))
    operations: set[Operation] = set()

    for path, item in document["paths"].items():
        for method in item:
            if method in METHODS:
                operations.add((method.upper(), normalize(path)))

    return operations


def load_requests(collection: Path) -> dict[Operation, list[Path]]:
    """Map each operation to the covering ``.bru`` files outside excluded folders."""
    requests: dict[Operation, list[Path]] = {}

    for file in sorted(collection.rglob("*.bru")):
        relative = file.relative_to(collection)

        if relative.parts[0] in EXCLUDED_FOLDERS or relative.name in (
            "folder.bru",
            "collection.bru",
        ):
            continue

        match = REQUEST_BLOCK.search(file.read_text(encoding="utf-8"))

        if match is None:
            requests.setdefault(("?", str(relative)), []).append(relative)

            continue

        operation = (match.group(1).upper(), normalize(match.group(2)))
        requests.setdefault(operation, []).append(relative)

    return requests


def report(spec: Path, collection: Path) -> int:
    """Print coverage and return the number of problems found."""
    operations = load_operations(spec)
    requests = load_requests(collection)
    missing = sorted(operations - requests.keys())
    unmapped = sorted(requests.keys() - operations)

    for method, path in missing:
        print(f"missing request: {method} {path}")

    for method, path in unmapped:
        files = ", ".join(str(file) for file in requests[(method, path)])
        print(f"request without operation: {method} {path} ({files})")

    covered = len(operations) - len(missing)
    print(f"bruno coverage: {covered}/{len(operations)} operations")

    return len(missing) + len(unmapped)


def main() -> int:
    """Run the coverage check and return the process exit code."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=Path("apps/server/openapi.yaml"))
    parser.add_argument("--collection", type=Path, default=Path("docs/bruno"))
    arguments = parser.parse_args()

    return 1 if report(arguments.spec, arguments.collection) else 0


if __name__ == "__main__":
    sys.exit(main())
