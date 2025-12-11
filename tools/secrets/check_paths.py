import subprocess
import sys
from pathlib import Path


def main() -> int:
    """Reject staged ignored files, including empty and binary credential files."""
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    staged = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout

    if not staged:
        return 0

    ignored = subprocess.run(
        ["git", "check-ignore", "--no-index", "--stdin", "-z"],
        cwd=root,
        input=staged,
        capture_output=True,
    )

    if ignored.returncode not in (0, 1):
        raise RuntimeError("Unable to check staged paths against .gitignore")

    for path in ignored.stdout.split(b"\0"):
        if path:
            print(f"Refusing ignored staged file: {path.decode(errors='replace')}")

    return int(bool(ignored.stdout))


if __name__ == "__main__":
    sys.exit(main())
