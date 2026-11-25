from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
JS_OUTPUT = CONTENT / "content-index.js"
JSON_OUTPUT = CONTENT / "content-index.json"
HTML_PATH = ROOT / "index.html"


def read_first_heading(path: Path) -> str | None:

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
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except UnicodeDecodeError:
        return {}

    if not lines or lines[0].strip() != "---":
        return {}

    data: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return data
        key, separator, value = line.partition(":")
        if separator:
            data[key.strip().lower()] = value.strip().strip('"')
    return {}


def title_from_slug(slug: str) -> str:
    """Convert a filename slug like 'ios2oppo' or 'photo-wall' into a readable title."""
    words = re.split(r"[-_]+", slug)
    return " ".join(word for word in words if word).strip() or "Untitled"


def note_entry(path: Path) -> dict[str, str]:

    match = re.match(r"^(\d{4})_(\d{2})_(\d{2})_([^_]+)_(.+)\.md$", path.name)
    heading = read_first_heading(path)

    if match:
        year, month, day, note_type, slug = match.groups()
        entry = {
            "date": f"{year}-{month}-{day}",
            "type": note_type,
            "title": heading or title_from_slug(slug),
            "file": path.name,
        }

    else:
        entry = {
            "date": "0000-00-00",
            "type": "note",
            "title": heading or title_from_slug(path.stem),
            "file": path.name,
        }

    updated = read_frontmatter(path).get("updated")
    if updated:
        try:
            iso_date = date.fromisoformat(updated).isoformat()
        except ValueError:
            iso_date = ""
        if iso_date == updated and updated >= entry["date"]:
            entry["updated"] = updated
        else:
            raise ValueError(f"{path.name} 的 updated 应为 YYYY-MM-DD 格式的有效日期，且不得早于创建日期")
    return entry


def repo_entry(path: Path) -> dict[str, str]:
    """Build one repository/project record from a Markdown file."""
    return {
        "status": "Project",
        "title": read_first_heading(path) or title_from_slug(path.stem),
        "file": path.name,
    }


def template_updates() -> list[dict[str, str]]:
    path = CONTENT / "updates" / "template_updates.md"
    if not path.is_file():
        return []

    entry = {"type": "template", "title": read_first_heading(path) or "模板更新历史", "file": path.name}
    date = re.search(r"^#{2,4}[ \t]+(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b", path.read_text(encoding="utf-8"), re.M)
    if date:
        year, month, day = date.groups()
        entry["date"] = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    return [entry]


GALLERY_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def natural_key(name: str) -> list:
    """Sort 'mel2' before 'mel10' by comparing digit runs as numbers."""
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", name)]


def gallery_photos(path: Path) -> list[dict[str, str]]:
    """List every photo in the album's same-name folder, in natural filename order."""
    folder = path.parent / path.stem
    files = sorted(
        (
            item
            for item in folder.iterdir()
            if item.is_file()
            and not item.name.startswith(".")
            and item.suffix.lower() in GALLERY_IMAGE_EXTENSIONS
        ),
        key=lambda item: natural_key(item.name),
    )
    # macOS may hand back decomposed (NFD) names; URLs and Markdown use NFC.
    return [{"src": unicodedata.normalize("NFC", f"{path.stem}/{item.name}"), "alt": ""} for item in files]


def gallery_entry(path: Path) -> dict:
    """Build one gallery record from a Markdown album file."""
    compact_date_match = re.match(r"^(\d{4})(\d{2})(\d{2}).*\.md$", path.name)
    frontmatter = read_frontmatter(path)
    heading = read_first_heading(path)

    date = frontmatter.get("date", "0000-00-00")
    if compact_date_match:
        year, month, day = compact_date_match.groups()
        date = frontmatter.get("date", f"{year}-{month}-{day}")

    photos = gallery_photos(path)
    return {
        "date": date,
        "place": frontmatter.get("place", ""),
        # Without a cover in the frontmatter, the first photo becomes the cover.
        "cover": frontmatter.get("cover", "") or (photos[0]["src"] if photos else ""),
        "title": heading or title_from_slug(path.stem),
        "file": path.name,
        "photos": photos,
    }


def collect() -> dict[str, list[dict]]:
    notes = sorted(
        (note_entry(path) for path in (CONTENT / "notes").glob("*.md")),
        key=lambda item: (item.get("updated", item["date"]), bool(item.get("updated")), item["date"], item["file"]),
        reverse=True,
    )
    repos = sorted(
        (repo_entry(path) for path in (CONTENT / "repos").glob("*.md")),
        key=lambda item: item["title"].casefold(),
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
    return {"notes": notes, "repos": repos, "gallery": gallery, "updates": template_updates()}


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
    # Change the URL when the index changes so browsers fetch the new album list.
    version = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    html = HTML_PATH.read_text(encoding="utf-8")
    html, replacements = re.subn(
        r'(src="\./content/content-index\.js)(?:\?v=[^\"]*)?("\s*>)',
        lambda match: f"{match.group(1)}?v={version}{match.group(2)}",
        html,
    )
    if replacements != 1:
        raise RuntimeError("Expected exactly one content-index.js script in index.html")
    HTML_PATH.write_text(html, encoding="utf-8")
    print(f"Generated {JS_OUTPUT.relative_to(ROOT)}")
    print(f"Generated {JSON_OUTPUT.relative_to(ROOT)}")
    print(
        f"Notes: {len(data['notes'])}, Repos: {len(data['repos'])}, "
        f"Albums: {len(data['gallery'])}, Updates: {len(data['updates'])}"
    )


if __name__ == "__main__":
    main()
