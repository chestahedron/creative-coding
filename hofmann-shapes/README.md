# Hofmann Shapes

A small p5.js sketch for exploring shapes in the manner of Armin Hofmann's
*Graphic Design Manual*: a regular grid of circles where filled circles that
touch fuse into a single smooth, blobby form.

## Run

No build step. Either open `index.html` directly in a browser, or serve the
folder:

```bash
cd hofmann-shapes
python3 -m http.server 8000
# open http://localhost:8000
```

## Use

- **Click / drag** on the canvas to fill or clear circles.
- **Columns / Rows** — grid resolution (existing pattern is preserved).
- **Dot size** — circle diameter relative to the grid cell. Above 100% the
  circles overlap and merge more aggressively.
- **Fusion** — how strongly touching circles melt together (0 = plain circles).
- **Show grid** — toggle the empty-circle outlines.
- Keyboard: `R` random, `I` invert, `C` clear, `S` save PNG (exports at 4×).

## How the fusion works

Filled circles are drawn black-on-white into an offscreen canvas, which is then
composited onto the page through a `blur() contrast()` canvas filter. The blur
melts neighboring circles together; the contrast step snaps the soft gradient
back to a hard edge, producing the smooth concave fillets between shapes.
