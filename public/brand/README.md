# Aurum Supply House — brand assets (production)

`aurum-logo.png` is the official Aurum Supply House wordmark used on the
customer-facing Invoice and Quote documents (browser preview and downloaded
PDF).

- **Format:** PNG, RGBA with true alpha transparency (renders clean navy on a
  white sheet — there is no black box; ~97% of the source canvas is fully
  transparent).
- **Dimensions:** 2579 × 745 px, aspect ≈ 3.46 : 1 — proportions preserved from
  the source.
- **Provenance:** trim-only derivative of the untouched brand master. Only the
  empty transparent canvas around the wordmark was cropped (alpha-bbox + 16 px
  transparent safety padding); no recolor, no resample of the mark, no effects.
  The original master is kept unchanged in the local `AURUM LOGO/` reference
  folder (not committed).

The document header renders this asset at a fixed height with `width: auto`, so
it always keeps its aspect ratio. In the browser preview it is served from
`/brand/aurum-logo.png`; in the PDF route it is inlined as a base64 `data:` URI
so it renders with no network/origin dependency (print-safe).
