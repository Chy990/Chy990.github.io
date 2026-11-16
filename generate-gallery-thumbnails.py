#!/usr/bin/env python3
"""
Generate lightweight gallery thumbnails.

Original photos stay untouched. Two sizes are written:
content/gallery/_thumbs/<album>/<image-stem>.jpg  (long side 1600px, lightbox preview)
content/gallery/_grid/<album>/<image-stem>.jpg    (short side 480px, album grid tiles)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
GALLERY = ROOT / "content" / "gallery"
THUMBS = GALLERY / "_thumbs"
GRID = GALLERY / "_grid"
GENERATED_FOLDERS = {"_thumbs", "_grid"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
THUMB_MAX_SIZE = (1600, 1600)
THUMB_QUALITY = 72
# Grid tiles are square crops shown at up to ~200 CSS px; 480px covers 2x screens.
GRID_SHORT_SIDE = 480
GRID_QUALITY = 70


def iter_gallery_images() -> list[Path]:
    return sorted(
        path
        for path in GALLERY.glob("*/*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and not GENERATED_FOLDERS.intersection(path.parts)
    )


def target_path(folder: Path, source: Path) -> Path:
    return folder / source.parent.name / f"{source.stem}.jpg"


def is_fresh(source: Path, target: Path) -> bool:
    return target.exists() and target.stat().st_mtime >= source.stat().st_mtime


def save_jpeg(image: Image.Image, target: Path, quality: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "JPEG", quality=quality, optimize=True, progressive=True)


def generate_one(source: Path) -> int:
    thumb = target_path(THUMBS, source)
    grid = target_path(GRID, source)
    stale = [target for target in (thumb, grid) if not is_fresh(source, target)]
    if not stale:
        return 0

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")

    if thumb in stale:
        large = image.copy()
        large.thumbnail(THUMB_MAX_SIZE, Image.Resampling.LANCZOS)
        save_jpeg(large, thumb, THUMB_QUALITY)

    if grid in stale:
        # Keep the aspect ratio: the page crops with CSS, and the lightbox needs the true ratio.
        scale = GRID_SHORT_SIDE / min(image.size)
        small = image if scale >= 1 else image.resize(
            (round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS
        )
        save_jpeg(small, grid, GRID_QUALITY)

    return len(stale)


def main() -> None:
    images = iter_gallery_images()
    generated = sum(generate_one(image) for image in images)

    print(f"Gallery images: {len(images)}, thumbnails generated: {generated}")
    print(f"Thumbnail folders: {THUMBS.relative_to(ROOT)}, {GRID.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
