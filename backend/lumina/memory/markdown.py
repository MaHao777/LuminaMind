from __future__ import annotations

import hashlib
import re
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from ..models import MemoryNote, MemoryType


FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def normalize_link(link: str) -> str:
    match = WIKILINK_RE.search(link)
    value = match.group(1) if match else link
    return value.split("|", 1)[0].strip()


def extract_wikilinks(text: str) -> list[str]:
    seen: set[str] = set()
    links: list[str] = []
    for match in WIKILINK_RE.finditer(text):
        link = normalize_link(match.group(0))
        if link and link not in seen:
            seen.add(link)
            links.append(link)
    return links


def file_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def stable_note_id(path: Path, raw: str) -> str:
    digest = hashlib.sha1(f"{path.as_posix()}\n{raw}".encode("utf-8")).hexdigest()[:12]
    return f"mem_{digest}"


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value).split(",") if part.strip()]


def parse_markdown_note(raw: str, path: Path) -> MemoryNote:
    metadata: dict[str, Any] = {}
    body = raw
    match = FRONTMATTER_RE.match(raw)
    if match:
        metadata = yaml.safe_load(match.group(1)) or {}
        body = raw[match.end() :]

    title = str(metadata.get("title") or path.stem)
    tags = _as_list(metadata.get("tags"))
    frontmatter_links = [normalize_link(link) for link in _as_list(metadata.get("links"))]
    body_links = extract_wikilinks(body)
    links = list(dict.fromkeys([*frontmatter_links, *body_links]))

    created = str(metadata.get("created") or metadata.get("created_at") or date.today().isoformat())
    updated = str(metadata.get("updated") or metadata.get("updated_at") or created)
    return MemoryNote(
        id=str(metadata.get("id") or stable_note_id(path, raw)),
        title=title,
        type=metadata.get("type") or "concept",
        content=body.strip(),
        tags=tags,
        importance=int(metadata.get("importance") or 3),
        confidence=float(metadata.get("confidence") or 0.9),
        source=str(metadata.get("source") or "manual"),
        status=metadata.get("status") or "active",
        pinned=bool(metadata.get("pinned", False)),
        created=created,
        updated=updated,
        links=links,
        path=str(path),
        file_hash=file_hash(raw),
    )


def build_markdown(
    *,
    title: str,
    note_type: MemoryType = "concept",
    content: str,
    tags: list[str] | None = None,
    links: list[str] | None = None,
    importance: int = 3,
    confidence: float = 0.9,
    source: str = "manual",
    status: str = "active",
    pinned: bool = False,
    note_id: str | None = None,
    created: str | None = None,
    updated: str | None = None,
) -> str:
    today = date.today().isoformat()
    normalized_links = [f"[[{normalize_link(link)}]]" for link in links or [] if normalize_link(link)]
    metadata = {
        "id": note_id or f"mem_{date.today().strftime('%Y%m%d')}_{hashlib.sha1(title.encode('utf-8')).hexdigest()[:8]}",
        "title": title,
        "type": note_type,
        "tags": tags or [],
        "importance": importance,
        "confidence": confidence,
        "source": source,
        "status": status,
        "pinned": pinned,
        "created": created or today,
        "updated": updated or today,
        "links": normalized_links,
    }
    frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{frontmatter}\n---\n\n{content.strip()}\n"
