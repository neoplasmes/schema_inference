import argparse
from pathlib import Path

from env.tools.lexical import install_wordnet


def main() -> None:
    """Install the pinned WordNet data explicitly, outside inference execution."""
    parser = argparse.ArgumentParser(description="Install the pinned WordNet archive")
    parser.add_argument("--directory", type=Path, required=True)
    arguments = parser.parse_args()
    print(install_wordnet(arguments.directory))


if __name__ == "__main__":
    main()
