from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class EntryData(BaseModel):
    id: UUID
    habit_id: UUID
    entry_date: date
    value: Decimal
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EntryWriteRequest(BaseModel):
    value: Decimal = Field(ge=0)


class EntryResponse(BaseModel):
    entry: EntryData


class EntriesListResponse(BaseModel):
    entries: list[EntryData]
