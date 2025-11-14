import random
from dataclasses import dataclass, field

from documents_generator.scenarios import Field


@dataclass
class DocumentNode:
    """One named field in a repeatable document variant."""

    role: str
    name: str
    value: str = ""
    children: list["DocumentNode"] = field(default_factory=list)
    repeated: bool = False


def build_variant(field: Field, variant: int, seed: int) -> DocumentNode:
    """Choose names and structure once, before producing document copies."""
    rng = random.Random(seed + variant)
    names: dict[str, str] = {}
    typo_role = ""

    def build(source: Field, root: bool = False) -> DocumentNode:
        nonlocal typo_role

        name_index = {1: 1, 2: 2, 4: 1, 6: 2}.get(variant, 0)

        if root and variant not in (4, 6):
            name_index = 0

        name = source.names[name_index % len(source.names)]

        if variant == 3 and not source.children and len(name) > 3 and not typo_role:
            index = rng.randrange(1, len(name) - 1)
            name = name[:index] + name[index + 1] + name[index] + name[index + 2 :]
            typo_role = source.role

        name = names.setdefault(source.role, name)

        node = DocumentNode(source.role, name, source.value, repeated=source.repeated)
        children = list(source.children)

        if variant == 5:
            children.reverse()

        for child in children:
            if child.optional and variant in (2, 5):
                continue

            repeats = 1 + variant % 3 if child.repeated else 1

            for _ in range(repeats):
                node.children.append(build(child))

        return node

    return build(field, root=True)
