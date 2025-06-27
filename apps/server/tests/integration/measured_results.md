# Measured algorithm results

These measurements describe the checked examples, not all possible XML schemas.
The evaluator receives an independent answer key after inference has finished.
Raw results can be reproduced using the commands in [README.md](README.md).

## Correspondence quality

Candidate recall measures whether the intended correspondence survives anywhere in
the output. The stronger `equivalent` relation requires enough contextual evidence
to suggest that two nodes represent the same role. Other relations retain possible
matches without making that stronger claim.

| Collection | Expected profile pairs | Candidate recall | Correct equivalents | Incorrect equivalents |
| --- | ---: | ---: | ---: | ---: |
| Fully renamed lowercase phrases | 8 | 100% | 6 | 0 |
| Different roles and homonyms | 10 | 100% | 2 | 0 |
| Generated seed 42, 12 documents | 98 | 87.8% | 6 | 0 |
| Generated seed 903, 12 documents | 104 | 90.4% | 7 | 0 |
| Separate weather family | 7 | 100% | 0 | 0 |

All eight correspondences in the fully renamed example rank first in both
directions. All seven weather correspondences remain within each other's five best
candidates. The opaque symmetric example retains all four possible cross-document
pairings without declaring a certain correspondence.

The generated examples remain difficult: strong equivalence recall is only 6.1%
and 6.7%. Mutual top-five candidate recall is 66.3% and 72.1%. Ancestors with weak
name evidence, changed representations and candidate limits leave correct matches
uncertain or absent. Zero observed false equivalences does not establish a universal
precision guarantee. The weather example demonstrates that retaining candidates
does not imply resolving their semantics.

Namespace-prefix changes, URI separators, mixed text, empty/nil values, correlated
child sequences and document permutation pass the preservation checks. Identical
profiles are counted separately and do not inflate correspondence recall.
Attribute matches and attribute/element transformations are reported as unscored
capabilities: the current correspondence edges connect element profiles.

## Indicative resource measurements

Each run used a fresh Python process. Inference time includes lexical resource
loading. Peak RSS includes imported libraries and input generation. The scorer was
being refined between these runs, so this table is an indicative workload check,
not a controlled comparison of one frozen implementation.

| Workload | Nodes | Profiles | Candidate pairs | Inference time | Peak RSS | JSON size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 32 mixed documents, seed 19423 | 387 | 204 | 2749 | 10.78 s | 326.85 MiB | 2.89 MB |
| 80 mixed documents, seed 80497 | 989 | 371 | 5313 | 14.01 s | 334.62 MiB | 5.65 MB |
| 12 documents repeated 20 times, seed 31991 | 2560 | 111 | 1428 | 8.66 s | 324.79 MiB | 2.50 MB |

All source profile paths, occurrence counts, full child sequences and frequencies
were checked independently, including the repetition factor of twenty. The runs
reached candidate limits and the four-round context limit; these restrictions are
visible in their warnings. Repeated documents increase observation counts without
creating new structural profiles.

Detailed outputs are stored under `artifacts/inference-review/stress/` when these
local workload checks are run. The regular evaluator recreates the smaller manual
and seeded quality reports; it does not automatically repeat the stress workloads.
