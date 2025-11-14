import argparse
from pathlib import Path

from documents_generator import GenerationOptions, generate_collections
from documents_generator.generation import DISTRIBUTIONS, FORMATS
from documents_generator.scenarios import SCENARIOS


def main() -> None:
    """Generate repeated XML and YAML collections with known variant counts."""
    parser = argparse.ArgumentParser(
        description="Generate heterogeneous document collections"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scenario", choices=["all", *SCENARIOS], default="all")
    parser.add_argument(
        "--documents", type=int, default=100, help="Documents per collection"
    )
    parser.add_argument(
        "--distribution", choices=["all", *DISTRIBUTIONS], default="all"
    )
    parser.add_argument("--format", choices=["all", *FORMATS], default="all")
    parser.add_argument("--seed", type=int, default=42)
    arguments = parser.parse_args()
    distributions = (
        DISTRIBUTIONS if arguments.distribution == "all" else (arguments.distribution,)
    )
    formats = FORMATS if arguments.format == "all" else (arguments.format,)

    try:
        options = GenerationOptions(
            seed=arguments.seed,
            documents=arguments.documents,
            scenario=arguments.scenario,
            distribution=distributions[0],
            format=formats[0],
        )
        manifests = generate_collections(
            arguments.output, options, distributions, formats
        )
    except ValueError as error:
        parser.error(str(error))

    print(
        f"Generated {len(manifests)} collections of "
        f"{arguments.documents} documents in {arguments.output}"
    )
