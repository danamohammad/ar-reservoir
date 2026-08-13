# AR Reservoir

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
