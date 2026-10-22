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
| `reservoir.glb` | unchanged original source model |
| `reservoir.usdz` | unchanged original export, retained for provenance |
| `ar/` | six unchanged textured GLB/USDZ pairs for static native AR |
| `scenario/` | calculated saturation frames, numerical checks and derived web mesh |
| `model.json` | property legend and well metadata |
| `model-viewer.min.js` | viewer library (vendored, no CDN) |

Static deployment — no server-side execution or tracking. The scenario is reproducibly precomputed with the included Python build script.

## Explorer upgrade

The interface adds well labels, selection and grid-column information, cell inspection, explicit units, camera presets, responsive controls, a readable Animation day counter and scrubber tied to well-flow playback, with a manual camera, and optional local daily-production CSV playback. It preserves the original model assets and printed QR URL.

The original six property rows are preserved. Calculated oil/water saturation now evolves in a separately identified conservative scenario; permeability, porosity and depth remain static. No authentic production time series was supplied. Recorded-history playback requires user-supplied records. Source cell values are approximate reconstructions from the original color texture. Read [DATA-PROVENANCE.md](DATA-PROVENANCE.md) for scientific limits and the exact import schema.

Preview: `python3 -m http.server 8773 --bind 127.0.0.1`, then open `http://127.0.0.1:8773/`.

Tests: `node --test tests/*.test.mjs`. The tests cover import validation, exact-day sampling, missing values, cell addressing, texture quantization bounds, and unchanged model hashes. Numerical test fixtures are synthetic test-only values and are never loaded into the live viewer.

GitHub Pages publishes `main` from `/`. Baseline before the interface upgrade: `797f9f22c6926736e386df009d4ecd899365043b`. Use a revert commit for rollback, preserving repository history. Core viewer dependencies and model files are served from this repository; no third-party runtime font or JavaScript CDN is required.

## Calculated transport upgrade

The current Animation day mode plays a conservative, assumption-based oil–water scenario, with fixed-scale dynamic saturation, normalized production, grid edges and solved surface flux cues. Original geometry and static property arrays are preserved. Read [SCENARIO-MODEL.md](SCENARIO-MODEL.md) before interpreting results. Missing internal geometry, PVT and completion controls prevent a field forecast.

Rebuild: `python scripts/build_transport.py` (numpy/Pillow). Test: `python tests/transport_test.py`, `node --test tests/*.test.mjs`, and `python tests/ar_assets_test.py` on macOS. Static native AR assets are unchanged.

The current scenario shuts PROD-3 (I13/J5) from day 7. PROD-1/2 retain their controls; approved injection reduction matches their exact sum. The original pre-day-7 trajectory is preserved, and the flow field is recalculated at shut-in.
