#!/usr/bin/env python3
"""Compose the app icon from the bare brand mark.

The provided asset (`resources/icon-source.png`, exported from the brand's
`favicon_256.ico`) is a *transparent glyph*, not an icon: macOS expects an app
icon to be a filled rounded square, so a bare mark floats oddly in the Dock. This
script puts the mark on the product's own dark plate (the same #111113 the app
window uses) at Apple's usual content proportion.

Run it only when the brand mark changes:

    python3 scripts/compose-icon.py

Requires Pillow (`pip3 install pillow`). The result is committed
(`resources/icon.png`); `scripts/make-icons.mjs` then derives the macOS/Windows
icon files from it, so a build needs no Python.

Caveat worth knowing: the source mark is 256 px, so the 1024 px icon is an
upscale (~4x). It is crisp at Dock/taskbar sizes and soft in Finder previews —
a 1024 px (or vector) source would fix that, and only this script would change.
"""
from PIL import Image, ImageDraw

CANVAS = 1024
RADIUS = 228          # the rounded-square corner macOS-style icons use
PLATE = (17, 17, 19)  # #111113, the app window's background
CONTENT = 0.60        # fraction of the canvas the mark's bounding box should fill
SRC = 'resources/icon-source.png'
OUT = 'resources/icon.png'

mark = Image.open(SRC).convert('RGBA')
box = mark.getbbox()
if box is None:
    raise SystemExit(f'{SRC} is fully transparent — nothing to place')
mark_w, mark_h = box[2] - box[0], box[3] - box[1]

# Scale the source canvas so the *glyph* ends up CONTENT of the icon, then paste
# it centred. Scaling the whole canvas (rather than cropping to the bbox) keeps
# the mark's own optical margins intact.
target_glyph = CANVAS * CONTENT
scale = target_glyph / max(mark_w, mark_h)
scaled = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)

plate = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
ImageDraw.Draw(plate).rounded_rectangle([0, 0, CANVAS - 1, CANVAS - 1], radius=RADIUS, fill=PLATE + (255,))
plate.alpha_composite(scaled, ((CANVAS - scaled.width) // 2, (CANVAS - scaled.height) // 2))
plate.save(OUT)
print(f'{OUT}: {CANVAS}x{CANVAS}, glyph {round(mark_w * scale)}x{round(mark_h * scale)} '
      f'({mark_w * scale / CANVAS * 100:.0f}% of the canvas, from a {mark.width}px source)')
