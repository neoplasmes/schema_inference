# XML data generator

This package uses only the Python standard library. It deliberately does not import
the server, its word lists, its segmentation rules, or its matching algorithm.

From the repository root:

```bash
uv run --package xml-data-generator xml-data-generator --output /tmp/xml-corpus --scenario all --documents 8 --seed 42
moon run xml-data-generator:generate
```

The moon task writes to `packages/xml_data_generator/generated/`, which is ignored
by Git. The CLI's `--output` option lets you choose a different directory.

`--documents` is the number per family. Families are `orders`, `invoices`, `catalog`
and `contacts`. The same seed and options reproduce identical XML and manifest bytes.
Rates configure typos, omissions, attribute representation, and child reordering.
`--max-repeats` limits repeated collections. Names include lowercase compound
phrases, aliases, abbreviations and four character edit operations. Prefixes vary
while their namespace URI stays identical. Billing/shipping and payer/payee retain
separate semantic roles despite equal child shapes.

The output directory contains `documents/*.xml` and `manifest.json`. Existing files
with the same generated names are replaced; unrelated files are not removed. Always
read the paths in the manifest instead of globbing a reused output directory.

Manifest version 1 represents each node with a zero-based `locator` of child indexes
from its document root (`[]`). Attribute references add `attribute`, its expanded
QName, to their owner's locator. `documents[].nodes` associates each reference with
an independent canonical `role`. `correspondence_groups` groups equal roles;
`forbidden_role_pairs` marks deliberately distinct roles. These annotations describe
semantic correspondence, including representations which require a transformation;
they do not authorize destructive XML merging. Repeated instances share a role.

Only XML goes into inference. The evaluator alone reads the manifest. All families
are synthetic evaluation data, not a language model training corpus or a lexical
dictionary. Handwritten server fixtures cover additional ambiguities and edge cases.
