import json
from pathlib import Path

import pytest
from documents_generator import GenerationOptions, generate_dataset

from app.use_cases.infer_schema import InferSchema
from env.tools.lexical import CorpusLexicalResourceTool
from main import build_document_reader

from .support import evaluate_manifest

FIXTURES = Path(__file__).parents[1] / "fixtures" / "claude_tests"


@pytest.fixture(scope="module")
def inference():
    return InferSchema(lexical_resource=CorpusLexicalResourceTool())


def check_collection(inference, manifest, directory):
    reader = build_document_reader()
    roots = []
    for document in manifest["documents"]:
        with (directory / document["path"]).open("rb") as source:
            roots.append(reader.read(source, document["path"]))
    space = inference.analyze(roots)
    report = evaluate_manifest(manifest, directory, space)

    assert not report["forbidden_field_merges"], report["forbidden_field_merges"]
    assert not report["missing_annotations"], report["missing_annotations"]
    assert not report["invalid_distributions"]
    assert space["statistics"]["documents"] == len(manifest["documents"])

    return space


@pytest.mark.parametrize(
    "path", sorted(FIXTURES.glob("*/expected.json")), ids=lambda path: path.parent.name
)
def test_manual_collections_preserve_roles_and_count_observed_variants(inference, path):
    check_collection(inference, json.loads(path.read_text()), path.parent)


@pytest.mark.parametrize("scenario", ["orders", "invoices", "catalog", "contacts"])
@pytest.mark.parametrize("distribution", ["geometric", "geometric_offset"])
@pytest.mark.parametrize("format", ["xml", "yaml"])
def test_generated_collections_have_consistent_distributions(
    inference, tmp_path, scenario, distribution, format
):
    manifest = generate_dataset(
        tmp_path,
        GenerationOptions(
            seed=42,
            documents=100,
            scenario=scenario,
            distribution=distribution,
            format=format,
        ),
    )
    check_collection(inference, manifest, tmp_path)
