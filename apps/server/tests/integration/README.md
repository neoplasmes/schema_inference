# Algorithm evaluation

These integration tests run the XML → use case → JSON path without HTTP or
WebSockets. They connect the XML reader, lexical resources, assignment tool and
inference use case. `tests/e2e` is reserved for tests through the API layer.

```bash
PYTHONPATH=apps/server/tests uv run --no-sync python -m integration.evaluate --all --output /tmp/xml-inference-review
```

For a particular generated or handwritten collection:

```bash
PYTHONPATH=apps/server/tests uv run --no-sync python -m integration.evaluate --manifest /tmp/xml-corpus/manifest.json --output /tmp/xml-inference-review
```

`--all` evaluates the six manual families, the separate weather family and two seeded
generated collections. Each case produces `<name>.space.json` (the actual result),
`<name>.evaluation.json` (oracle comparison), and a row in `summary.json`. Generated
input XML and manifests are also retained under the output directory. An optional
`--fail-on-forbidden` flag returns a failing exit code after evaluating all cases if
any explicitly forbidden equivalence or grouping was suggested.

The evaluator compares complete expanded QName paths resolved from the oracle's XML
locators. It cannot change inference and the algorithm never receives the oracle.
Identical profiles already represent the same observed name/context; these are
counted separately instead of inflating matching recall. Repeated instances also do
not inflate the number of unique profile pairs. Attribute/element representation
changes and attribute correspondences are counted as unscored capabilities, because
this element-profile contract does not yet expose corresponding attribute edges.

Candidate recall measures whether an expected correspondence remains available at
all. Equivalence precision and recall measure the stronger `equivalent` suggestions.
The report includes thresholds 0.6–0.9; those values are heuristic scores, not
calibrated probabilities. A missing denominator is represented by JSON `null`.
Same-namespace equivalence results are also reported separately: cross-namespace
semantic candidates may deliberately remain uncertain. Mutual top-k candidate recall
shows the fraction of expected pairs which rank within each other's k best scores.
Known incorrect role pairs, unexplained equivalences, missed correspondences and
retained symmetric alternatives are reported explicitly.

The integration tests enforce lossless observations and sequences, correct references,
document-order independence and preservation of distinct roles. Generated collections
must retain at least 80% of expected candidates, suggest at least one correct
equivalence, and avoid incorrect equivalences. The 80% floor is a regression guard
based on the measured baseline, not an independently validated quality target.
All eight fully renamed fields must be mutual first choices; the seven weather
correspondences must remain mutual top-five choices. These inspected examples are
regression fixtures, not a blind estimate of performance on arbitrary schemas.

See [measured_results.md](measured_results.md) for the observed strengths and gaps.
To keep pytest JSON artifacts outside its temporary directories:

```bash
XML_INFERENCE_ARTIFACT_DIR=/tmp/xml-inference-review uv run --no-sync pytest apps/server/tests/integration
```
