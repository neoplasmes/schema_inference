import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from xml_data_generator import GenerationOptions, generate_dataset


def files(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in directory.rglob("*")
        if path.is_file()
    }


def test_seed_reproduces_bytes_and_annotations(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    options = GenerationOptions(seed=905, documents=3)
    generate_dataset(first, options)
    generate_dataset(second, options)

    assert files(first) == files(second)


def test_manifest_references_every_emitted_node(tmp_path: Path) -> None:
    manifest = generate_dataset(tmp_path, GenerationOptions(seed=17, documents=5))

    for document in manifest["documents"]:
        root = ET.parse(tmp_path / document["path"]).getroot()
        expected_count = sum(1 + len(element.attrib) for element in root.iter())
        assert len(document["nodes"]) == expected_count

        for node in document["nodes"]:
            element = root

            for index in node["locator"]:
                element = element[index]

            if node["kind"] == "attribute":
                assert node["attribute"] in element.attrib
            else:
                assert element.tag == node["name"]

    assert ["order.billing", "order.shipping"] in manifest["forbidden_role_pairs"]


def test_different_seeds_change_documents(tmp_path: Path) -> None:
    generate_dataset(tmp_path / "first", GenerationOptions(seed=1))
    generate_dataset(tmp_path / "second", GenerationOptions(seed=2))
    first = {
        name: data
        for name, data in files(tmp_path / "first").items()
        if name.endswith(".xml")
    }
    second = {
        name: data
        for name, data in files(tmp_path / "second").items()
        if name.endswith(".xml")
    }

    assert first != second


def test_cli_writes_requested_collection(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "xml_data_generator",
            "--output",
            str(tmp_path),
            "--scenario",
            "orders",
            "--documents",
            "2",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    assert len(manifest["documents"]) == 2
    assert "Generated 2 documents" in result.stdout


def test_recorded_typos_change_names_and_cover_all_edits(tmp_path: Path) -> None:
    manifest = generate_dataset(
        tmp_path, GenerationOptions(seed=74, documents=12, typo_rate=1)
    )
    edits = [
        transformation
        for document in manifest["documents"]
        for transformation in document["transformations"]
        if "from" in transformation
    ]

    assert all(edit["from"] != edit["to"] for edit in edits)
    assert {edit["operation"] for edit in edits} == {
        "substitution",
        "insertion",
        "deletion",
        "transposition",
    }


def test_manifest_parameters_replay_collection(tmp_path: Path) -> None:
    manifest = generate_dataset(
        tmp_path / "first",
        GenerationOptions(seed=19, documents=2, attribute_rate=0.6, typo_rate=0.4),
    )
    generate_dataset(tmp_path / "second", GenerationOptions(**manifest["parameters"]))

    assert files(tmp_path / "first") == files(tmp_path / "second")


@pytest.mark.parametrize(
    "options",
    [
        {"documents": 0},
        {"typo_rate": 1.1},
        {"omission_rate": -1},
        {"scenario": "unknown"},
        {"max_repeats": 0},
    ],
)
def test_invalid_options_are_rejected(options: dict) -> None:
    with pytest.raises(ValueError):
        GenerationOptions(**options)
