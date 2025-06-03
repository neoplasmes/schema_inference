import argparse
from pathlib import Path

from xml_data_generator import GenerationOptions, generate_dataset
from xml_data_generator.scenarios import SCENARIOS


def main() -> None:
    """Generate XML collections and a separate machine-readable answer key."""
    parser = argparse.ArgumentParser(
        description="Generate heterogeneous XML collections"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scenario", choices=["all", *SCENARIOS], default="all")
    parser.add_argument(
        "--documents", type=int, default=8, help="Documents per scenario"
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--typo-rate", type=float, default=0.1)
    parser.add_argument("--omission-rate", type=float, default=0.2)
    parser.add_argument("--attribute-rate", type=float, default=0.15)
    parser.add_argument("--reorder-rate", type=float, default=0.5)
    parser.add_argument("--max-repeats", type=int, default=3)
    arguments = parser.parse_args()

    try:
        options = GenerationOptions(
            seed=arguments.seed,
            documents=arguments.documents,
            scenario=arguments.scenario,
            typo_rate=arguments.typo_rate,
            omission_rate=arguments.omission_rate,
            attribute_rate=arguments.attribute_rate,
            reorder_rate=arguments.reorder_rate,
            max_repeats=arguments.max_repeats,
        )
    except ValueError as error:
        parser.error(str(error))

    manifest = generate_dataset(arguments.output, options)
    print(f"Generated {len(manifest['documents'])} documents in {arguments.output}")
