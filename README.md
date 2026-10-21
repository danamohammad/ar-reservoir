# AR Reservoir — Reservoir Explorer

Scan-to-view 3D / augmented-reality viewer for a reservoir simulation model.

**Live:** https://danamohammad.github.io/ar-reservoir/

Open the link on a phone and tap the AR button to place the reservoir on a real
surface at 50 cm scale. Works without installing anything — Scene Viewer on Android,
AR Quick Look on iOS.

## Model

17 × 22 × 5 corner-point grid, 1,870 active cells, shown at true 1:1 vertical scale.
Three producers and one injector. Switchable properties: initial oil saturation,
permeability (log scale), porosity, and depth.

## Contents

| File | |
|---|---|
| `index.html` | the viewer |
| `reservoir.glb` | model for web + Android AR |
| `reservoir.usdz` | model for iOS AR Quick Look |
| `model.json` | property legend and well metadata |
| `model-viewer.min.js` | viewer library (vendored, no CDN) |

Static files only — no build step, no server, no tracking.

## Explorer upgrade

The interface adds well labels, selection and grid-column information, cell inspection, explicit units, camera presets, responsive controls, a presentation tour, and optional local daily-production CSV playback. It preserves the original model assets and printed QR URL.

The six reservoir properties are **static**. No production time series was supplied. Presentation motion is explicitly illustrative; daily production playback requires user-supplied records. Cell values are approximate reconstructions from the original color texture. Read [DATA-PROVENANCE.md](DATA-PROVENANCE.md) for scientific limits and the exact import schema.

Preview: `python3 -m http.server 8773 --bind 127.0.0.1`, then open `http://127.0.0.1:8773/`.

Tests: `node --test tests/data.test.mjs`. The tests cover import validation, exact-day sampling, missing values, cell addressing, texture quantization bounds, and unchanged model hashes. Numerical test fixtures are synthetic test-only values and are never loaded into the live viewer.

GitHub Pages publishes `main` from `/`. Baseline before the interface upgrade: `797f9f22c6926736e386df009d4ecd899365043b`. Use a revert commit for rollback, preserving repository history. Core viewer dependencies and model files are served from this repository; no third-party runtime font or JavaScript CDN is required.
