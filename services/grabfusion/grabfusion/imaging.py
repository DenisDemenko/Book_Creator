"""Підготовка фото: поворот за EXIF, стиснення до recommendedMaxSidePx, прибирання EXIF/GPS (Pillow)."""
from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import StudioError


def prepare_photo(raw: bytes, *, max_side: int = 2048, max_bytes: int = 10 * 1024 * 1024,
                  quality: int = 85) -> bytes:
    """Повертає JPEG без метаданих, довша сторона ≤ max_side, розмір ≤ max_bytes.

    Метадані (EXIF, GPS, ICC-коментарі) не переносяться: зображення перекодовується з нуля.
    Не зображення → StudioError(bad_image).
    """
    try:
        im = Image.open(BytesIO(raw))
        im.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise StudioError("bad_image", "Файл не схожий на зображення (потрібен JPEG, PNG або WEBP).") from None
    im = ImageOps.exif_transpose(im)  # повертає за EXIF Orientation, після чого тег не потрібен
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    q = quality
    while True:
        out = BytesIO()
        im.save(out, format="JPEG", quality=q, optimize=True)  # без exif=…: метаданих не буде
        data = out.getvalue()
        if len(data) <= max_bytes or q <= 40:
            break
        q -= 10
    if len(data) > max_bytes:
        raise StudioError("image_too_large", "Фото завелике навіть після стиснення.")
    return data
