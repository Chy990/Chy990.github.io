#!/usr/bin/env python3
"""
Scan the content folders and generate content/content-index.js.

You normally do not need to edit the generated file by hand:
- Add or delete Markdown files in content/notes, content/repos, or content/updates.
- Add or delete Markdown albums and jpg/png images in content/gallery.
- Run start-blog.command again.

Note filenames work best with this format:
yyyy_mm_dd_type_title.md

Example:
2026_06_02_notes_ios2oppo.md
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
JS_OUTPUT = CONTENT / "content-index.js"
JSON_OUTPUT = CONTENT / "content-index.json"


def read_first_heading(path: Path) -> str | None:
    """Return the first Markdown H1 heading, without the leading '# '."""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("# "):
                return line[2:].strip()
    except UnicodeDecodeError:
        return None
    return None


def read_frontmatter(path: Path) -> dict[str, str]:
    """Return simple key/value frontmatter from a Markdown file."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return {}

    if not lines or lines[0].strip() != "---":
        return {}

    data: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        key, separator, value = line.partition(":")
        if separator:
            data[key.strip().lower()] = value.strip().strip('"')
    return data


def title_from_slug(slug: str) -> str:
    """Convert a filename slug like 'ios2oppo' or 'photo-wall' into a readable title."""
    words = re.split(r"[-_]+", slug)
    return " ".join(word for word in words if word).strip() or "Untitled"


def note_entry(path: Path) -> dict[str, str]:
    """
    Build one note record from a Markdown file.

    Preferred filename format:
    2026_06_02_notes_ios2oppo.md
    """
    match = re.match(r"^(\d{4})_(\d{2})_(\d{2})_([^_]+)_(.+)\.md$", path.name)
    heading = read_first_heading(path)

    if match:
        year, month, day, note_type, slug = match.groups()
        return {
            "date": f"{year}-{month}-{day}",
            "type": note_type,
            "title": heading or title_from_slug(slug),
            "file": path.name,
        }

    return {
        "date": "0000-00-00",
        "type": "note",
        "title": heading or title_from_slug(path.stem),
        "file": path.name,
    }


def repo_entry(path: Path) -> dict[str, str]:
    """Build one repository/project record from a Markdown file."""
    return {
        "status": "Project",
        "title": read_first_heading(path) or title_from_slug(path.stem),
        "file": path.name,
    }


def update_entry(path: Path) -> dict[str, str]:
    """
    Build one update-history record from a Markdown file.

    Preferred filename format:
    content_updates.md or template_updates.md
    """
    match = re.match(r"^([^_]+)_(.+)\.md$", path.name)
    heading = read_first_heading(path)

    if match:
        update_type, slug = match.groups()
        return {
            "type": update_type,
            "title": heading or title_from_slug(slug),
            "file": path.name,
        }

    return {
        "type": "update",
        "title": heading or title_from_slug(path.stem),
        "file": path.name,
    }


def gallery_entry(path: Path) -> dict[str, str]:
    """Build one gallery record from a Markdown album file."""
    compact_date_match = re.match(r"^(\d{4})(\d{2})(\d{2}).*\.md$", path.name)
    frontmatter = read_frontmatter(path)
    heading = read_first_heading(path)

    date = frontmatter.get("date", "0000-00-00")
    if compact_date_match:
        year, month, day = compact_date_match.groups()
        date = frontmatter.get("date", f"{year}-{month}-{day}")

    return {
        "date": date,
        "place": frontmatter.get("place", ""),
        "cover": frontmatter.get("cover", ""),
        "title": heading or title_from_slug(path.stem),
        "file": path.name,
    }


def collect() -> dict[str, list[dict[str, str]]]:
    """Collect all content records from notes, repos, and gallery folders."""
    notes = sorted(
        (note_entry(path) for path in (CONTENT / "notes").glob("*.md")),
        key=lambda item: (item["date"], item["file"]),
        reverse=True,
    )
    repos = sorted(
        (repo_entry(path) for path in (CONTENT / "repos").glob("*.md")),
        key=lambda item: item["title"].casefold(),
    )
    update_type_order = {"content": 0, "template": 1}
    updates = sorted(
        (update_entry(path) for path in (CONTENT / "updates").glob("*.md")),
        key=lambda item: (update_type_order.get(item["type"], 99), item["file"]),
    )
    gallery = sorted(
        (
            gallery_entry(path)
            for path in (CONTENT / "gallery").glob("*.md")
            if path.name != "README.md" and (CONTENT / "gallery" / path.stem).is_dir()
        ),
        key=lambda item: (item["date"], item["file"]),
        reverse=True,
    )
    return {"notes": notes, "repos": repos, "gallery": gallery, "updates": updates}


def main() -> None:
    CONTENT.mkdir(exist_ok=True)
    data = collect()
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    JSON_OUTPUT.write_text(f"{payload}\n", encoding="utf-8")
    JS_OUTPUT.write_text(
        "// This file is generated by generate-content-index.py. Do not edit it by hand.\n"
        f"window.BLOG_CONTENT = {payload};\n",
        encoding="utf-8",
    )
    print(f"Generated {JS_OUTPUT.relative_to(ROOT)}")
    print(f"Generated {JSON_OUTPUT.relative_to(ROOT)}")
    print(
        f"Notes: {len(data['notes'])}, Repos: {len(data['repos'])}, "
        f"Albums: {len(data['gallery'])}, Updates: {len(data['updates'])}"
    )


if __name__ == "__main__":
    main()
