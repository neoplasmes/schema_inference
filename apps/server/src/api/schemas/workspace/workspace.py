from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SourceDocumentInput(Input):
    name: str = Field(min_length=1, max_length=255)
    format: Literal["xml", "json", "yaml"]
    size: int = Field(ge=0, le=5_000_000)
    content: str = Field(max_length=5_000_000)

    @model_validator(mode="after")
    def validate_size(self):
        """Require the declared size to describe the submitted UTF-8 document."""
        if len(self.content.encode()) != self.size:
            raise ValueError("Document size does not match its UTF-8 content.")

        return self


class AnalysisInput(Input):
    title: str = Field(min_length=1, max_length=255)
    documents: list[SourceDocumentInput] = Field(min_length=1, max_length=100)


class AnalysisSource(Input):
    kind: Literal["analysis"]
    analysisId: str
    revision: str
    seedId: str
    rootAlternativeId: str


class DraftInput(Input):
    title: str = Field(min_length=1, max_length=255)
    source: AnalysisSource


class ExpandedName(Input):
    namespaceUri: str | None
    localName: str = Field(min_length=1, max_length=255)


class RenameProperty(Input):
    kind: Literal["renameProperty"]
    memberId: str
    name: str = Field(min_length=1, max_length=255)


class XmlTarget(Input):
    kind: Literal["node", "member"]
    id: str


class RenameXmlName(Input):
    kind: Literal["renameXmlName"]
    target: XmlTarget
    name: ExpandedName


class MoveMember(Input):
    kind: Literal["moveMember"]
    memberId: str
    targetCollectionId: str
    beforeMemberId: str | None


Operation = Annotated[
    RenameProperty | RenameXmlName | MoveMember, Field(discriminator="kind")
]


class ChangesetInput(Input):
    clientMutationId: str = Field(
        min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_-]+$"
    )
    baseRevision: str
    operations: list[Operation] = Field(min_length=1, max_length=1000)
