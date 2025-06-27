import json
import os
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from xml_data_generator import GenerationOptions, generate_dataset

from app.use_cases.infer_schema import InferSchema
from env.tools.assignment import ScipyAssignmentTool
from env.tools.lexical import CorpusLexicalResourceTool
from env.tools.xml import ElementTreeXmlDocumentTool

from .support import evaluate_manifest, write_evaluation_artifacts

FIXTURES = Path(__file__).parents[1] / "fixtures"
MANUAL_CASES = sorted((FIXTURES / "manual").glob("*/expected.json"))


@pytest.fixture(scope="module")
def inference() -> InferSchema:
    return InferSchema(
        lexical_resource=CorpusLexicalResourceTool(), assignment=ScipyAssignmentTool()
    )


def qname(name: dict[str, str]) -> str:
    return (
        f"{{{name['namespace']}}}{name['local']}"
        if name["namespace"]
        else name["local"]
    )


def source_observations(manifest: dict[str, Any], directory: Path) -> Counter:
    observed = Counter()

    for document in manifest["documents"]:
        root = ET.parse(directory / document["path"]).getroot()
        pending: list[tuple[ET.Element, tuple[int, ...], tuple[str, ...]]] = [
            (root, (), (root.tag,))
        ]

        while pending:
            element, position, path = pending.pop()
            observed[
                (
                    path,
                    position,
                    element.text,
                    element.tail,
                    tuple(sorted(element.attrib.items())),
                    tuple(child.tag for child in element),
                )
            ] += 1
            pending.extend(
                (child, (*position, index), (*path, child.tag))
                for index, child in enumerate(element)
            )

    return observed


def assert_observations_preserved(
    manifest: dict[str, Any], directory: Path, result: dict[str, Any]
) -> None:
    expected = source_observations(manifest, directory)
    actual = Counter()
    profiles = {profile["id"]: profile for profile in result["profiles"]}
    documents = {document["id"]: document for document in result["documents"]}
    observed_documents = Counter()

    assert result["format"] == "xml-probability-space"
    assert len(profiles) == len(result["profiles"])
    assert len(documents) == len(manifest["documents"])
    assert result["statistics"]["nodes"] == sum(expected.values())

    for profile in profiles.values():
        path = tuple(qname(name) for name in profile["path"])
        observed_sequences = Counter()

        assert profile["occurrences"] == len(profile["observations"])

        for observation in profile["observations"]:
            assert observation["document"] in documents

            observed_documents[observation["document"]] += 1
            actual[
                (
                    path,
                    tuple(observation["position"]),
                    observation["text"],
                    observation["tail"],
                    tuple(
                        sorted(
                            (qname(attribute["name"]), attribute["value"])
                            for attribute in observation["attributes"]
                        )
                    ),
                    tuple(
                        qname(profiles[child]["name"])
                        for child in observation["children"]
                    ),
                )
            ] += 1
            observed_sequences[tuple(observation["children"])] += 1

        declared_sequences = {
            tuple(alternative["children"]): alternative["count"]
            for alternative in profile["content"]["alternatives"]
        }

        assert declared_sequences == dict(observed_sequences)

        for alternative in profile["content"]["alternatives"]:
            assert alternative["frequency"] == pytest.approx(
                alternative["count"] / profile["occurrences"]
            )

    assert actual == expected

    for identifier, document in documents.items():
        assert document["root"] in profiles
        assert document["nodes"] == observed_documents[identifier]

    for correspondence in result["correspondences"]:
        assert correspondence["left"] in profiles
        assert correspondence["right"] in profiles
        assert correspondence["left"] != correspondence["right"]
        assert 0 <= correspondence["score"] <= 1


def matching_observations(
    reference: dict[str, Any],
    manifest: dict[str, Any],
    directory: Path,
    result: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    document = next(
        document
        for document in manifest["documents"]
        if document["id"] == reference["document"]
    )
    element = ET.parse(directory / document["path"]).getroot()
    path = [element.tag]

    for index in reference["locator"]:
        element = element[index]
        path.append(element.tag)

    profile = next(
        profile
        for profile in result["profiles"]
        if [qname(name) for name in profile["path"]] == path
    )
    observations = [
        observation
        for observation in profile["observations"]
        if observation["position"] == reference["locator"]
        and observation["text"] == element.text
        and observation["tail"] == element.tail
        and {
            qname(attribute["name"]): attribute["value"]
            for attribute in observation["attributes"]
        }
        == element.attrib
    ]

    assert observations

    return profile, observations


def assert_manual_constraints(
    manifest: dict[str, Any], directory: Path, result: dict[str, Any]
) -> None:
    constraints = manifest.get("constraints", {})

    for reference in constraints.get("nil_nodes", []):
        _, observations = matching_observations(reference, manifest, directory, result)

        assert all(observation["nil"] is True for observation in observations)

    for reference in constraints.get("non_nil_nodes", []):
        _, observations = matching_observations(reference, manifest, directory, result)

        assert all(observation["nil"] is not True for observation in observations)

    for reference in constraints.get("mixed_content", []):
        _, observations = matching_observations(reference, manifest, directory, result)

        assert all(observation["kind"] == "mixed" for observation in observations)
        assert all(
            observation["text"] == reference["text"] for observation in observations
        )

    invalid_dates: Counter[str] = Counter()
    profiles = {}

    for reference in constraints.get("invalid_calendar_dates", []):
        profile, _ = matching_observations(reference, manifest, directory, result)
        invalid_dates[profile["id"]] += 1
        profiles[profile["id"]] = profile

    for identifier, invalid_count in invalid_dates.items():
        types = profiles[identifier]["value_types"]
        date_support = sum(
            candidate["supported_values"]
            for candidate in types["candidates"]
            if candidate["type"] == "date"
        )

        assert date_support <= types["total"] - invalid_count


def run_collection(
    inference: InferSchema,
    manifest: dict[str, Any],
    directory: Path,
    artifacts: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    reader = ElementTreeXmlDocumentTool()
    roots = []

    for document in manifest["documents"]:
        with (directory / document["path"]).open("rb") as source:
            roots.append(reader.read(source))

    result = json.loads(inference.execute(roots))
    report = evaluate_manifest(manifest, directory, result)
    destination = Path(os.environ.get("XML_INFERENCE_ARTIFACT_DIR", artifacts))
    name = manifest["scenario"]

    if "seed" in manifest:
        name += f"-seed-{manifest['seed']}"

    write_evaluation_artifacts(destination, name, result, report)
    assert_observations_preserved(manifest, directory, result)
    assert_manual_constraints(manifest, directory, result)

    assert not report["missing_profile_annotations"]

    return result, report


@pytest.mark.parametrize(
    "manifest_path", MANUAL_CASES, ids=lambda path: path.parent.name
)
def test_manual_collection_preserves_evidence_and_distinct_roles(
    inference: InferSchema, manifest_path: Path, tmp_path: Path
) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _, report = run_collection(inference, manifest, manifest_path.parent, tmp_path)

    assert not report["forbidden_equivalent_pairs"], report["false_positive_details"]
    assert not report["forbidden_group_pairs"]
    assert report["equivalent"]["false_positive"] == 0, report["false_positive_details"]

    if manifest["scenario"] == "fully_renamed":
        assert report["element_profile_pairs_expected"] == 8
        assert report["candidate_recall"] == 1
        assert report["mutual_top_k_candidate_recall"]["1"] == 1

    for ambiguity in report["ambiguities"]:
        assert ambiguity["retained_alternatives"] == ambiguity["expected_alternatives"]
        assert ambiguity["high_confidence_equivalences"] == 0


@pytest.mark.parametrize("seed", [42, 903])
def test_generated_collections_produce_reviewable_json(
    inference: InferSchema, seed: int, tmp_path: Path
) -> None:
    """Guard the measured baseline against empty suggestions and lost candidates."""
    directory = tmp_path / "corpus"
    manifest = generate_dataset(
        directory, GenerationOptions(seed=seed, documents=3, scenario="all")
    )
    _, report = run_collection(inference, manifest, directory, tmp_path / "artifacts")

    assert not report["forbidden_equivalent_pairs"], report["false_positive_details"]
    assert not report["forbidden_group_pairs"]
    assert report["equivalent"]["false_positive"] == 0, report["false_positive_details"]
    assert report["equivalent"]["true_positive"] > 0
    assert report["candidate_recall"] >= 0.8


def test_independent_weather_family_reports_quality(
    inference: InferSchema, tmp_path: Path
) -> None:
    directory = FIXTURES / "holdout" / "weather"
    manifest = json.loads((directory / "expected.json").read_text(encoding="utf-8"))
    _, report = run_collection(inference, manifest, directory, tmp_path)

    assert not report["forbidden_equivalent_pairs"], report["false_positive_details"]
    assert not report["forbidden_group_pairs"]
    assert report["element_profile_pairs_expected"] == 7
    assert report["mutual_top_k_candidate_recall"]["5"] == 1


def test_document_permutation_does_not_change_space(inference: InferSchema) -> None:
    directory = FIXTURES / "manual" / "order_correlations"
    reader = ElementTreeXmlDocumentTool()
    roots = []

    for path in sorted(directory.glob("*.xml")):
        with path.open("rb") as source:
            roots.append(reader.read(source))

    assert json.loads(inference.execute(roots)) == json.loads(
        inference.execute(list(reversed(roots)))
    )
