from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from grabfusion.errors import StudioError
from grabfusion.imaging import prepare_photo


def _jpeg_with_exif(size=(4000, 3000), orientation=6) -> bytes:
    im = Image.new("RGB", size, (200, 30, 30))
    exif = Image.Exif()
    exif[0x0112] = orientation          # Orientation
    exif[0x010F] = "SecretCameraMaker"  # Make
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2] = "N", (50.0, 27.0, 0.0)  # GPS
    out = BytesIO()
    im.save(out, "JPEG", exif=exif)
    return out.getvalue()


def test_exif_and_gps_are_stripped_and_orientation_applied():
    raw = _jpeg_with_exif()
    assert b"SecretCameraMaker" in raw
    out = prepare_photo(raw, max_side=2048)
    assert b"SecretCameraMaker" not in out and b"Exif" not in out[:200]
    im = Image.open(BytesIO(out))
    assert not im.getexif()
    # 4000×3000 з Orientation=6 — це портрет; після повороту й стиснення довша сторона 2048 по вертикалі
    assert im.size[1] == 2048 and im.size[0] < im.size[1]


def test_small_image_not_upscaled():
    im = Image.open(BytesIO(prepare_photo(_jpeg_with_exif((800, 600), 1))))
    assert im.size == (800, 600)


def test_png_with_alpha_becomes_jpeg():
    buf = BytesIO()
    Image.new("RGBA", (50, 50), (0, 0, 0, 0)).save(buf, "PNG")
    out = prepare_photo(buf.getvalue())
    im = Image.open(BytesIO(out))
    assert im.format == "JPEG" and im.getpixel((5, 5)) == (255, 255, 255)


def test_not_an_image():
    with pytest.raises(StudioError) as e:
        prepare_photo(b"hello")
    assert e.value.kind == "bad_image"


def test_respects_max_bytes_by_lowering_quality():
    import os
    noise = Image.frombytes("RGB", (600, 600), os.urandom(600 * 600 * 3))
    buf = BytesIO()
    noise.save(buf, "PNG")
    out = prepare_photo(buf.getvalue(), max_bytes=120_000)
    assert len(out) <= 120_000


def test_impossible_size_raises():
    import os
    noise = Image.frombytes("RGB", (600, 600), os.urandom(600 * 600 * 3))
    buf = BytesIO()
    noise.save(buf, "PNG")
    with pytest.raises(StudioError) as e:
        prepare_photo(buf.getvalue(), max_bytes=1000)
    assert e.value.kind == "image_too_large"
