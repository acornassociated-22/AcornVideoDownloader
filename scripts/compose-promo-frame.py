#!/usr/bin/env python3
"""Compose a screenshot into a 16:9 branded promo frame with an optional title."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


W, H = 1920, 1080
NAVY = (11, 58, 140)
BLUE = (27, 107, 255)
GREEN = (20, 84, 37)
NEAR_BLACK = (6, 12, 28)


def lerp(a: float, b: float, t: float) -> float:
    """Linear interpolate between a and b."""
    return a + (b - a) * t


def make_background() -> Image.Image:
    """Build a navy-to-blue gradient with soft blurred light blobs."""
    base = Image.new("RGB", (W, H))
    px = base.load()
    for y in range(H):
        ty = y / (H - 1)
        for x in range(W):
            tx = x / (W - 1)
            r = int(lerp(NEAR_BLACK[0], NAVY[0], 0.35 + 0.45 * ty + 0.15 * tx))
            g = int(lerp(NEAR_BLACK[1], 40, 0.25 + 0.5 * ty))
            b = int(lerp(NEAR_BLACK[2], BLUE[2], 0.4 + 0.5 * ty))
            px[x, y] = (r, g, b)

    blobs = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(blobs)
    draw.ellipse((-200, -180, 720, 520), fill=(*BLUE, 90))
    draw.ellipse((1200, 400, 2100, 1200), fill=(*GREEN, 55))
    draw.ellipse((700, -100, 1500, 500), fill=(80, 160, 255, 45))
    blobs = blobs.filter(ImageFilter.GaussianBlur(90))
    return Image.alpha_composite(base.convert("RGBA"), blobs)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    """Create a white rounded-rectangle alpha mask."""
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def fit_screenshot(shot: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """Scale screenshot to fit inside max box while keeping aspect ratio."""
    shot = shot.convert("RGBA")
    ratio = min(max_w / shot.width, max_h / shot.height)
    new_size = (max(1, int(shot.width * ratio)), max(1, int(shot.height * ratio)))
    return shot.resize(new_size, Image.Resampling.LANCZOS)


def load_font(size: int) -> ImageFont.ImageFont:
    """Load a bold sans font, falling back to default."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def draw_title(canvas: Image.Image, title: str) -> None:
    """Draw a premium title band near the bottom of the frame."""
    if not title:
        return
    draw = ImageDraw.Draw(canvas)
    font = load_font(54)
    pad_x, pad_y = 28, 16
    bbox = draw.textbbox((0, 0), title, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    band_w = tw + pad_x * 2 + 28
    band_h = th + pad_y * 2
    x = (W - band_w) // 2
    y = H - 88 - band_h

    band = Image.new("RGBA", (band_w, band_h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rounded_rectangle((0, 0, band_w - 1, band_h - 1), radius=18, fill=(8, 16, 36, 200))
    bd.rounded_rectangle((0, 0, band_w - 1, band_h - 1), radius=18, outline=(*BLUE, 160), width=2)
    canvas.alpha_composite(band, (x, y))

    # Green accent dot + title text
    draw.ellipse((x + 18, y + band_h // 2 - 6, x + 30, y + band_h // 2 + 6), fill=GREEN)
    draw.text((x + pad_x + 20, y + pad_y - 2), title, font=font, fill=(245, 248, 255, 255))


def compose(shot_path: Path, out_path: Path, title: str, fill: float = 0.78) -> None:
    """Compose screenshot into branded 16:9 canvas and save PNG."""
    canvas = make_background()
    shot = Image.open(shot_path)
    # Leave vertical room for title band
    max_w = int(W * fill)
    max_h = int(H * (fill - 0.06))
    fitted = fit_screenshot(shot, max_w, max_h)
    fw, fh = fitted.size
    radius = 28

    # Soft drop shadow
    shadow = Image.new("RGBA", (fw + 40, fh + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((20, 24, fw + 20, fh + 24), radius=radius, fill=(0, 0, 0, 160))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))

    mask = rounded_mask((fw, fh), radius)
    window = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    window.paste(fitted, (0, 0), mask)

    # Thin blue rim
    rim = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle((1, 1, fw - 2, fh - 2), radius=radius, outline=(*BLUE, 180), width=2)

    cx = (W - fw) // 2
    cy = (H - fh) // 2 - 36
    canvas.alpha_composite(shadow, (cx - 20, cy - 16))
    canvas.alpha_composite(window, (cx, cy))
    canvas.alpha_composite(rim, (cx, cy))

    # Subtle contrast polish
    rgb = ImageEnhance.Contrast(canvas.convert("RGB")).enhance(1.04)
    canvas = rgb.convert("RGBA")
    draw_title(canvas, title)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({out_path.stat().st_size // 1024} KB)")


def main() -> None:
    """CLI entry: compose one or a batch of titled promo frames."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shot", type=Path, help="Single screenshot path")
    parser.add_argument("--out", type=Path, help="Single output path")
    parser.add_argument("--title", default="", help="Title caption")
    parser.add_argument("--batch-premium", action="store_true", help="Compose premium UI set")
    args = parser.parse_args()

    if args.batch_premium:
        assets = Path("/home/asus/.cursor/projects/home-asus-Documents-AcornV-deoDownloader/assets")
        out_dir = Path("/home/asus/Documents/AcornV'deoDownloader/promo/youtube-16x9-premium")
        jobs = [
            ("Screenshot_From_2026-08-03_04-23-37-2737f3ba-34c5-4f75-88fc-47b8d700f96c.png", "03-home.png", "Paste a YouTube link"),
            ("Screenshot_From_2026-08-03_05-05-51-ba950a44-602f-44f8-b878-d8ec00947620.png", "04-download.png", "Choose quality & format"),
            ("Screenshot_From_2026-08-03_07-58-57-220b72c6-7127-4204-baac-aea7341810ee.png", "05-history.png", "Your download history"),
            ("Screenshot_From_2026-08-03_07-48-40-8fbb5cb7-99b4-4171-8eb4-29816671be60.png", "09-settings.png", "Tuned for your workflow"),
            ("Screenshot_From_2026-08-03_05-05-01-b844db54-21d1-4fa0-bc0b-1f5e010aeb67.png", "10-about.png", "Support Acorn Associated"),
        ]
        for name, out_name, title in jobs:
            compose(assets / name, out_dir / out_name, title)
        return

    if not args.shot or not args.out:
        parser.error("--shot and --out required unless --batch-premium")
    compose(args.shot, args.out, args.title)


if __name__ == "__main__":
    main()
