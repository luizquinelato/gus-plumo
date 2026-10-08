# -*- coding: utf-8 -*-
"""Schemas compartilhados para operações em lote."""

from pydantic import BaseModel, Field


class BulkIdsRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)


class BulkDeleteResponse(BaseModel):
    deleted: int
    skipped: int


class TemplateItemDeleteRef(BaseModel):
    template_id: int
    item_id: int


class BulkDeleteTemplatesRequest(BaseModel):
    template_ids: list[int] = Field(default_factory=list)
    items: list[TemplateItemDeleteRef] = Field(default_factory=list)


class BulkDeleteTagsRequest(BaseModel):
    tag_ids: list[int] = Field(default_factory=list)
    subtag_ids: list[int] = Field(default_factory=list)
