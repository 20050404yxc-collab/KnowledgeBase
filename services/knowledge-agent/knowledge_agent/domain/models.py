# 文件：models.py
# 层：Python domain
# 作用：声明知识、证据、资料和接口配置的稳定业务结构。
# 说明：不访问外部资源，也不依赖界面或传输实现。
from typing import NotRequired, TypedDict


class TextBlock(TypedDict):
    id: str
    text: str
    locator: str


class EvidenceBlock(TextBlock):
    source_id: str
    name: str
    retained: NotRequired[bool]


class Document(TypedDict):
    id: str
    fingerprint: str
    name: str
    path: str
    blocks: list[TextBlock]
    warnings: list[str]
    retained: bool


class Supplement(TypedDict):
    id: str
    knowledge_id: str
    title: str
    content: str
    created_at: str
    updated_at: str
    citations: list[EvidenceBlock]
    model: str
    provider_name: str
    edited: bool


class Knowledge(TypedDict):
    id: str
    title: str
    content: str
    created_at: str
    updated_at: str
    generated: bool
    edited: bool
    bucket: str
    manual_bucket: str | None
    citations: list[EvidenceBlock]
    model: str | None
    provider_name: str | None
    theme: NotRequired[str]
    version: NotRequired[str]
    supplements: NotRequired[list[Supplement]]


class SourceSummary(TypedDict):
    id: str
    name: str
    created_at: str
    blocks: int
    warnings: list[str]


class ProviderDraft(TypedDict):
    name: str
    protocol: str
    base_url: str
    model: str
    models: list[str]
    currency: str
    input_price: float | None
    output_price: float | None


class ProviderConfig(ProviderDraft):
    id: str
    has_key: bool
    active: bool
    reasoning_effort: NotRequired[str]


class Recommendation(TypedDict):
    title: str
    reason: str
    preview: str
    knowledge_id: NotRequired[str]
