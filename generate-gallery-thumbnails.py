#!/usr/bin/env python3
"""
Generate lightweight gallery thumbnails.

Original photos stay untouched. Thumbnails are written to:
content/gallery/_thumbs/<album>/<image-stem>.jpg
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
GALLERY = ROOT / "content" / "gallery"
THUMBS = GALLERY / "_thumbs"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_SIZE = (1600, 1600)
QUALITY = 72


def iter_gallery_images() -> list[Path]:
    return sorted(
        path
        for path in GALLERY.glob("*/*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and "_thumbs" not in path.parts
    )


def thumbnail_path(source: Path) -> Path:
    album = source.parent.name
    return THUMBS / album / f"{source.stem}.jpg"


def is_fresh(source: Path, target: Path) -> bool:
    return target.exists() and target.stat().st_mtime >= source.stat().st_mtime


def generate_one(source: Path) -> bool:
    target = thumbnail_path(source)
    if is_fresh(source, target):
        return False

    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
        image.save(target, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return True


def main() -> None:
    images = iter_gallery_images()
    generated = 0

    for image in images:
        if generate_one(image):
            generated += 1

    print(f"Gallery images: {len(images)}, thumbnails generated: {generated}")
    print(f"Thumbnail folder: {THUMBS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
