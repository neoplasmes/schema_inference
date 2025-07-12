import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from main import build_document_reader


def evaluate_manifest(manifest: dict, input_directory: Path, result: dict) -> dict:
    """Check counted fields against annotated roles, reporting deliberate normalization."""
    references = {}
    for node in result["nodes"]:
        for source in node["sources"]:
            attribute = (
                source["name"] if source["representation"] == "attribute" else ""
            )
            references[(source["document"], tuple(source["position"]), attribute)] = (
                node["id"]
            )
    variants = {variant["id"]: variant for variant in manifest.get("variants", [])}
    roles: dict[str, set[str]] = defaultdict(set)
    missing, normalized = [], []
    reader = build_document_reader()

    for index, document in enumerate(manifest["documents"]):
        annotations = document.get("nodes")
        if annotations is None:
            annotations = variants[document["variant"]]["nodes"]
        with (input_directory / document["path"]).open("rb") as source:
            root = reader.read(source, document["path"])
        discarded = set()
        pending: list[tuple[Any, tuple[int, ...], bool]] = [(root, (), False)]
        while pending:
            node, position, inherited = pending.pop()
            nil = getattr(node, "attributes", {}).get(
                "{http://www.w3.org/2001/XMLSchema-instance}nil"
            ) in ("true", "1")
            mixed = (
                bool(node.children)
                and getattr(node, "format", "") == "xml"
                and (
                    bool((node.text or "").strip())
                    or any(
                        (getattr(child, "tail", None) or "").strip()
                        for child in node.children
                    )
                )
            )
            if inherited:
                discarded.add(position)
            pending.extend(
                (child, (*position, child_index), inherited or mixed or nil)
                for child_index, child in enumerate(node.children)
            )
        for annotation in annotations:
            position = tuple(annotation["locator"])
            attribute = annotation.get("attribute", "")
            identifier = references.get((index, position, attribute))
            if identifier is not None:
                roles[identifier].add(annotation["role"])
            elif position in discarded or attribute.startswith(
                "{http://www.w3.org/2001/XMLSchema-instance}"
            ):
                normalized.append({"document": document["id"], **annotation})
            else:
                missing.append({"document": document["id"], **annotation})
    forbidden = []
    for left, right in manifest.get("forbidden_role_pairs", []):
        for identifier, found in roles.items():
            if left in found and right in found:
                forbidden.append({"field": identifier, "roles": [left, right]})
    invalid = []
    for node in result["nodes"]:
        if not 0 < node["presence_probability"] <= 1:
            invalid.append(node["id"])
        for entries in (
            node["name_alternatives"],
            node["data_types"],
            node["representations"],
            node["content"]["alternatives"],
        ):
            if (
                sum(item["count"] for item in entries) != node["occurrences"]
                or abs(sum(item["probability"] for item in entries) - 1) > 1e-9
            ):
                invalid.append(node["id"])
    return {
        "scenario": manifest["scenario"],
        "documents": len(manifest["documents"]),
        "fields": len(result["nodes"]),
        "forbidden_field_merges": forbidden,
        "missing_annotations": missing,
        "normalized_annotations": normalized,
        "invalid_distributions": sorted(set(invalid)),
    }


def write_evaluation_artifacts(
    directory: Path, name: str, space: dict[str, Any], report: dict[str, Any]
) -> None:
    """Write the observed schema and audit report as separate JSON artifacts."""
    directory.mkdir(parents=True, exist_ok=True)
    for suffix, data in (("space", space), ("evaluation", report)):
        (directory / f"{name}.{suffix}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        )
