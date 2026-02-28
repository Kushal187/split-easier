from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


BG = (91, 168, 140, 255)
BG_LIGHT = (121, 196, 168, 80)
BG_DARK = (74, 145, 120, 70)
WHITE = (246, 246, 246, 255)
DARK = (30, 58, 79, 255)
ACCENT = (232, 132, 92, 255)

VIEWBOX_CENTER = 60
RECEIPT_SCALE = 1.2
ICON_ART_SCALE = 0.94

RECEIPT_POINTS = [
    (34, 34),
    (39, 39),
    (44, 34),
    (49, 39),
    (54, 34),
    (59, 39),
    (64, 34),
    (69, 39),
    (74, 34),
    (79, 39),
    (84, 34),
    (84, 86),
    (79, 81),
    (74, 86),
    (69, 81),
    (64, 86),
    (59, 81),
    (54, 86),
    (49, 81),
    (44, 86),
    (39, 81),
    (34, 86),
]

LEFT_BARS = [
    (42, 48, 56, 53),
    (42, 58, 56, 63),
    (42, 68, 56, 73),
]

RIGHT_BARS = [
    (64, 48, 78, 53),
    (64, 58, 78, 63),
    (64, 68, 78, 73),
]

DIVIDER = (59, 43, 61, 77)


def scale_about_center(value):
    return VIEWBOX_CENTER + (value - VIEWBOX_CENTER) * RECEIPT_SCALE


def transform_points(points):
    return [(scale_about_center(x), scale_about_center(y)) for x, y in points]


def transform_rect(rect):
    x1, y1, x2, y2 = rect
    return (
        scale_about_center(x1),
        scale_about_center(y1),
        scale_about_center(x2),
        scale_about_center(y2),
    )


def scale_point(x, y, size):
    art = size * ICON_ART_SCALE
    offset = (size - art) / 2
    scale = art / 120
    return (offset + x * scale, offset + y * scale)


def scale_rect(rect, size):
    x1, y1, x2, y2 = rect
    p1 = scale_point(x1, y1, size)
    p2 = scale_point(x2, y2, size)
    return (*p1, *p2)


def make_background(size):
    background = Image.new("RGBA", (size, size), BG)
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for bounds, fill in [
        ((size * 0.08, size * 0.12, size * 0.78, size * 0.82), BG_LIGHT),
        ((size * 0.35, size * 0.10, size * 0.96, size * 0.72), BG_LIGHT),
        ((size * -0.05, size * 0.55, size * 0.55, size * 1.05), BG_DARK),
        ((size * 0.58, size * 0.48, size * 1.05, size * 1.00), BG_DARK),
    ]:
        draw.ellipse(bounds, fill=fill)

    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=size * 0.06))
    return Image.alpha_composite(background, overlay)


def draw_divider(draw, size, divider_rect):
    x1, y1, x2, y2 = scale_rect(divider_rect, size)
    width = max(2, round(x2 - x1))
    center_x = round((x1 + x2) / 2)
    left = center_x - width // 2
    right = left + width - 1
    draw.rounded_rectangle((left, round(y1), right, round(y2)), radius=1, fill=DARK)


def draw_bars(draw, size, bars, fill):
    for rect in bars:
        draw.rounded_rectangle(tuple(round(v) for v in scale_rect(rect, size)), radius=1, fill=fill)


def draw_icon(size, destination):
    image = make_background(size)
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)

    receipt = [scale_point(x, y, size) for x, y in transform_points(RECEIPT_POINTS)]
    shadow_draw.polygon([(x, y + size * 0.008) for x, y in receipt], fill=(47, 93, 79, 36))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=size * 0.01))
    image = Image.alpha_composite(image, shadow)

    draw = ImageDraw.Draw(image)
    draw.polygon(receipt, fill=WHITE)
    draw_divider(draw, size, transform_rect(DIVIDER))
    draw_bars(draw, size, [transform_rect(rect) for rect in LEFT_BARS], BG)
    draw_bars(draw, size, [transform_rect(rect) for rect in RIGHT_BARS], ACCENT)
    image.save(destination)


def main():
    public_dir = Path(__file__).resolve().parents[1] / "public"
    draw_icon(192, public_dir / "icon-192.png")
    draw_icon(512, public_dir / "icon-512.png")


if __name__ == "__main__":
    main()
