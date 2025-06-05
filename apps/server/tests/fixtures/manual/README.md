# Handwritten algorithm fixtures

Each directory is a deliberately authored collection, independent of the generator.
`expected.json` follows manifest version 1 documented in the generator README.
`constraints` adds scenario-specific facts which should survive inference. The oracle
is available to the evaluator only; the algorithm receives the XML files.

- `fully_renamed`: lowercase compound synonyms throughout, including root and parents.
  Billing and shipping are different roles although their structures are identical.
- `role_collisions`: payer/payee, opposite flags, date endpoints, and two senses of bank.
- `namespace_separators`: slash/hyphen namespace URIs, namespaced attributes, changing
  prefixes, and equal local names in different namespaces.
- `order_correlations`: preserve complete observed sequences, including noncontiguous
  repetition. Independent choices would invent unobserved combinations.
- `empty_nil_mixed`: distinguish absence, empty and nil; retain mixed text and tails;
  preserve leading-zero identifiers and reject an impossible calendar date.
- `unknown_symmetry`: two equally plausible opaque matches; preserve uncertainty and
  Unicode names. There is no hidden unique answer for the opaque pairs.

Roles name intended semantic fields, not XML tag spellings. A role shared by multiple
instances does not mean the instances or their values should be destructively merged.
