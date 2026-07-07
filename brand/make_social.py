#!/usr/bin/env python3
"""
TimeMachine Instagram template generator.

Parametric so headlines regenerate without touching the layout. Matches
BRAND.md exactly: neutral-950 canvas, sky wordmark, system-adjacent sans
(Inter, the app's own wordmark family) for headlines, SF Mono for the URL.
Chrome cool, data hot; sky is brand only.

Toolchain: Pillow for compositing, segno for the optional QR (the sticker
stack). The sky wordmark is composited from brand/wordmark-1024.png so it is
pixel-identical to the shipped mark; the three-bar mark from brand/mark-1024.png.

Usage:
  python3 brand/make_social.py --format post   --variant title \
      --headline "Overdue? The Act says you're owed. Two taps." --out brand/examples/post-title.png
  python3 brand/make_social.py --format story  --variant screenshot \
      --screenshot shot.png --out brand/examples/story-screenshot.png
  python3 brand/make_social.py --all            # regenerate every example
Flags: --format {post,story}  --variant {title,screenshot}
       --headline TEXT  --eyebrow TEXT  --screenshot PATH  --qr  --out PATH
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ── Brand palette (BRAND.md / index.html tokens) ────────────────────────────
BG        = (10, 10, 10)      # #0a0a0a neutral-950
CARD      = (23, 23, 23)      # #171717 neutral-900
CARD2     = (31, 31, 31)      # #1f1f1f
BORDER    = (38, 38, 38)      # #262626 neutral-800
TEXT      = (245, 245, 245)   # #f5f5f5 neutral-100
TEXT2     = (163, 163, 163)   # #a3a3a3 neutral-400
TEXT3     = (115, 115, 115)   # #737373 neutral-500
SKY       = (14, 165, 233)    # #0ea5e9 sky-500 — brand only

CANVASES = {"post": (1080, 1350), "story": (1080, 1920)}

INTER = os.path.join(ROOT, "node_modules/@fontsource/inter/files")
MONO_CANDIDATES = ["/System/Library/Fonts/SFNSMono.ttf",
                   "/System/Library/Fonts/Menlo.ttc"]


def font(weight, size):
    return ImageFont.truetype(os.path.join(INTER, f"inter-latin-{weight}-normal.woff"), size)


def mono(size):
    for p in MONO_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def sky_glow(size, cx_frac=0.5, cy_frac=-0.06, radius_frac=0.62, alpha=90):
    """The app's signature sky radial bloom at the top of the canvas."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = int(max(w, h) * radius_frac)
    cx, cy = int(w * cx_frac), int(h * cy_frac)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*SKY, alpha))
    return layer.filter(ImageFilter.GaussianBlur(radius=int(max(w, h) * 0.16)))


def base(size):
    img = Image.new("RGBA", size, (*BG, 255))
    img.alpha_composite(sky_glow(size))
    return img


def draw_tracked(draw, xy, text, fnt, fill, tracking, anchor="la"):
    """Letter-spaced text (Pillow has no native tracking). Returns total width."""
    x, y = xy
    widths = [draw.textlength(c, font=fnt) for c in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    if anchor == "ma":
        x -= total / 2
    for c, cw in zip(text, widths):
        draw.text((x, y), c, font=fnt, fill=fill)
        x += cw + tracking
    return total


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def paste_wordmark(img, target_w, xy, anchor="l"):
    wm = Image.open(os.path.join(HERE, "wordmark-1024.png")).convert("RGBA")
    scale = target_w / wm.width
    wm = wm.resize((target_w, max(1, int(wm.height * scale))), Image.LANCZOS)
    x, y = xy
    if anchor == "c":
        x -= wm.width // 2
    img.alpha_composite(wm, (int(x), int(y)))
    return wm.height


def paste_mark(img, target_w, xy):
    mk = Image.open(os.path.join(HERE, "mark-1024.png")).convert("RGBA")
    mk = mk.resize((target_w, target_w), Image.LANCZOS)
    img.alpha_composite(mk, (int(xy[0]), int(xy[1])))


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0], size[1]], radius=radius, fill=255)
    return m


def add_qr(img, xy, box):
    import segno
    qr = segno.make("https://timemachineapp.co.uk", error="m")
    tmp = os.path.join(HERE, "examples", "_qr_tmp.png")
    qr.save(tmp, scale=10, border=2, dark="#f5f5f5", light=None)
    q = Image.open(tmp).convert("RGBA").resize((box, box), Image.NEAREST)
    img.alpha_composite(q, (int(xy[0]), int(xy[1])))
    os.remove(tmp)


# ── Title card ──────────────────────────────────────────────────────────────
def title_card(fmt, headline, eyebrow, want_qr):
    size = CANVASES[fmt]
    W, H = size
    img = base(size)
    d = ImageDraw.Draw(img)
    M = 96                                    # side margin
    y = 150 if fmt == "post" else 230

    # Eyebrow microlabel — sky, uppercase, wide-tracked.
    eb = font(700, 26)
    draw_tracked(d, (M, y), eyebrow.upper(), eb, SKY, tracking=6)
    y += 62

    # Wordmark (sky), left.
    y += paste_wordmark(img, int(W * 0.60), (M, y)) + 46

    # Sky rule (the app's hero underline).
    d.rectangle([M, y, M + int(W * 0.30), y + 5], fill=SKY)
    y += 60

    # Headline — Inter 800, primary text, wrapped, left.
    hs = 92 if fmt == "post" else 100
    hf = font(800, hs)
    for line in wrap(d, headline, hf, W - 2 * M):
        d.text((M, y), line, font=hf, fill=TEXT)
        y += int(hs * 1.14)

    # Footer: URL in mono (data tone), the mark bottom-right, optional QR.
    fy = H - (150 if fmt == "post" else 190)
    draw_tracked(d, (M, fy), "timemachineapp.co.uk", mono(30), TEXT3, tracking=2)
    if want_qr:
        add_qr(img, (W - M - 150, fy - 70), 150)
    else:
        paste_mark(img, 116, (W - M - 116, fy - 34))
    return img


# ── Screenshot frame ─────────────────────────────────────────────────────────
def screenshot_frame(fmt, screenshot, eyebrow, want_qr):
    size = CANVASES[fmt]
    W, H = size
    img = base(size)
    d = ImageDraw.Draw(img)
    M = 96

    # Small wordmark + eyebrow, top, centred.
    top = 96 if fmt == "post" else 150
    wm_h = paste_wordmark(img, int(W * 0.42), (W // 2, top), anchor="c")
    draw_tracked(d, (W // 2, top + wm_h + 20), eyebrow.upper(), font(700, 24), TEXT3,
                 tracking=6, anchor="ma")

    # Phone slot: a rounded frame whose aspect matches the screenshot, so the
    # WHOLE screen shows (contain, never crop). Subtle padding inside the frame.
    area_top = top + wm_h + 96
    area_bot = H - (150 if fmt == "post" else 210)
    area_h = area_bot - area_top
    max_w = int(W * 0.66)
    pad = 20                                    # subtle padding around the screenshot
    radius = 62

    ar = 1170 / 2532                            # phone aspect (portrait)
    if screenshot and os.path.exists(screenshot):
        shot = Image.open(screenshot).convert("RGBA")
        ar = shot.width / shot.height
    # Fit a phone of aspect `ar` inside (max_w, area_h).
    frame_h = area_h
    frame_w = int(frame_h * ar) + 2 * pad
    if frame_w > max_w:
        frame_w = max_w
        frame_h = int((frame_w - 2 * pad) / ar) + 2 * pad
    slot_x = (W - frame_w) // 2
    slot_top = area_top + (area_h - frame_h) // 2

    # Soft sky glow behind the phone.
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle(
        [slot_x, slot_top, slot_x + frame_w, slot_top + frame_h], radius=radius, fill=(*SKY, 55))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(48)))

    # Card + border (the phone body).
    d.rounded_rectangle([slot_x, slot_top, slot_x + frame_w, slot_top + frame_h],
                        radius=radius, fill=CARD, outline=BORDER, width=2)

    inner = (frame_w - 2 * pad, frame_h - 2 * pad)
    if screenshot and os.path.exists(screenshot):
        shot = shot.resize(inner, Image.LANCZOS)          # exact fit — whole screen, no crop
        shot.putalpha(rounded_mask(inner, radius - pad))
        img.alpha_composite(shot, (slot_x + pad, slot_top + pad))
    else:
        # Template placeholder slot.
        d.rounded_rectangle([slot_x + pad, slot_top + pad,
                             slot_x + frame_w - pad, slot_top + frame_h - pad],
                            radius=radius - pad, fill=CARD2)
        paste_mark(img, 150, (W // 2 - 75, slot_top + frame_h // 2 - 110))
        draw_tracked(d, (W // 2, slot_top + frame_h // 2 + 70), "YOUR SCREENSHOT",
                     font(700, 24), TEXT3, tracking=6, anchor="ma")

    fy = H - (100 if fmt == "post" else 150)
    draw_tracked(d, (W // 2, fy), "timemachineapp.co.uk", mono(28), TEXT3, tracking=2, anchor="ma")
    if want_qr:
        add_qr(img, (W - M - 130, fy - 60), 120)
    return img


def render(fmt, variant, headline, eyebrow, screenshot, want_qr):
    if variant == "title":
        return title_card(fmt, headline, eyebrow, want_qr)
    return screenshot_frame(fmt, screenshot, eyebrow, want_qr)


DEFAULT_HEADLINE = "Overdue? The Act says you're owed interest and a fixed fee. Two taps."
DEFAULT_EYEBROW = "APA timesheets · UK crew"


def main():
    ap = argparse.ArgumentParser(description="TimeMachine Instagram templates")
    ap.add_argument("--format", choices=CANVASES, default="post")
    ap.add_argument("--variant", choices=["title", "screenshot"], default="title")
    ap.add_argument("--headline", default=DEFAULT_HEADLINE)
    ap.add_argument("--eyebrow", default=DEFAULT_EYEBROW)
    ap.add_argument("--screenshot", default=None)
    ap.add_argument("--qr", action="store_true")
    ap.add_argument("--out", default=None)
    ap.add_argument("--all", action="store_true", help="regenerate every example")
    a = ap.parse_args()

    if a.all:
        ex = os.path.join(HERE, "examples")
        os.makedirs(ex, exist_ok=True)
        shot = os.path.join(ex, "_screenshot-src.png")
        shot = shot if os.path.exists(shot) else None
        jobs = [
            ("post", "title", DEFAULT_HEADLINE, None),
            ("post", "screenshot", None, shot),
            ("story", "title", "Sunday rate, bank hols, the 11-hour turnaround. All caught for you.", None),
            ("story", "screenshot", None, shot),
        ]
        for fmt, var, hl, sc in jobs:
            img = render(fmt, var, hl or DEFAULT_HEADLINE, DEFAULT_EYEBROW, sc, False)
            out = os.path.join(ex, f"{fmt}-{var}.png")
            img.convert("RGB").save(out, "PNG")
            print("wrote", out, img.size)
        # one QR demo
        img = render("post", "title", DEFAULT_HEADLINE, DEFAULT_EYEBROW, None, True)
        img.convert("RGB").save(os.path.join(ex, "post-title-qr.png"), "PNG")
        print("wrote", os.path.join(ex, "post-title-qr.png"))
        return

    img = render(a.format, a.variant, a.headline, a.eyebrow, a.screenshot, a.qr)
    out = a.out or os.path.join(HERE, "examples", f"{a.format}-{a.variant}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.convert("RGB").save(out, "PNG")
    print("wrote", out, img.size)


if __name__ == "__main__":
    main()
