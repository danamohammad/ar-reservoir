# Reservoir Explorer: provenance and data limits

The viewer uses Dana Mohammad Khidhir's supplied 17 × 22 × 5 corner-point reservoir: **1,870 active cells**, 1,138 exterior quads and four well markers. The original GLB, USDZ, metadata and six-row property texture are preserved byte for byte. No cells, geological detail, well trajectories, property records or production results were invented.

## Available data

| Item | Source and interpretation |
| --- | --- |
| Surface geometry | Original `reservoir.glb`, exterior shell only. Internal cell geometry is not available in the deployed mesh. |
| Initial oil saturation | Original texture, EQUIL-derived using a 6,750 ft water–oil contact and connate Sw 0.25. Static initial state. |
| Permeability | Original heterogeneous and homogeneous PERMX rows, mD, logarithmic color scale. |
| Porosity | Original heterogeneous and homogeneous rows, fractions. |
| Depth | Original cell-centre true vertical depth, feet. Not measured well depth. |
| Wells | PROD-1 (I11/J12), PROD-2 (I5/J17), PROD-3 (I13/J5), INJ (I7/J6). Original positions and tubes preserved. Tubes are schematic markers, not surveyed trajectories or completion intervals. |

Per-cell numerical readouts invert the documented four-segment blue/cyan/green/yellow/red ramp in the supplied `build.py`. The PNG contains 8-bit colors, not original full-precision property arrays. Values are therefore labelled **approximate**. Tests verify the inverse against every ramp segment and quantization bounds. Grid addresses come from the original cell-indexed UV coordinate. Top-cell well depth means layer K1 of that well's grid column, not a wellhead elevation or completion depth.

## Missing data

The repository, old project bundle and full submission package contain no production rate history, elapsed-day series, pressure/saturation restart sequence, `.UNRST` restart file, or `.UNSMRY`/`.SMSPEC` summary pair. The source FEGRID and INCLUDE arrays referenced by the old build script are also absent from these supplied packages. The audit in the full manuscript explicitly identifies these limits.

To show authentic daily production, supply exported well records with elapsed days, well identifiers, rate values, explicit units and a source/case description. Dynamic property animation additionally requires timestamped per-cell saturation/pressure values aligned to the same I/J/K grid. Full-precision cell readouts require the original arrays. Detailed well depths/completions require trajectories and completion records.

## Two playback modes

- **Presentation:** a 30-second camera tour. Moving dots are illustrative direction cues along the existing well markers. They have no calibrated speed or rate, do not model fluid transport, and do not change reservoir properties. They are explicitly labelled as illustrative. No animation starts automatically.
- **Production / days:** disabled until a user loads a local history CSV. Playback advances through the actual days present, one recorded day per second at 1×. The chart shows discrete samples. No interpolation, extrapolation, carry-forward or fabricated zero is used. The geometry and static property colors do not evolve with the chart.

The browser pauses playback when its tab becomes hidden. Imported data stay in memory in the browser session; the site does not upload, persist or log them. Imports are user-supplied and are not independently authenticated or verified.

## CSV format

`production-template.csv` contains column headers only, deliberately without example production numbers.

Required columns: `day`, `well`. At least one explicitly unit-labelled rate column is required:

| Column | Meaning |
| --- | --- |
| `day` | Non-negative elapsed day from the user's case start; fractional days allowed. |
| `well` | Exactly PROD-1, PROD-2, PROD-3 or INJ. |
| `oil_stb_day` | Oil rate in stock-tank barrels per day. |
| `water_stb_day` | Produced-water rate in stock-tank barrels per day. |
| `gas_scf_day` | Gas rate in standard cubic feet per day. |
| `injection_stb_day` | Water-injection rate in stock-tank barrels per day. |

One row per day/well pair; duplicate records are rejected. Rate values must be finite and non-negative. Blank means unavailable, while an explicit zero remains zero. The user must convert different units before import. Unsupported columns are rejected to avoid silently interpreting ambiguous units. Limits: 5 MB / 50,000 rows. Imported production data never change the original model files.

## Source integrity

| Original file | SHA-256 |
| --- | --- |
| `reservoir.glb` | `3566eae7ca1ddb380f0712c34fd951eb2f64d5362fbb5a0bf71b3e32ac32d8c0` |
| `reservoir.usdz` | `a1fb0e6f3dcff29ff29735d154dded80eaa167594ae680e019a7d0b657ebdf62` |
| `model.json` | `6be5a41cedf129bebedbfbfb9012b8271e2743e6e398d0de9a7bed4808dfb825` |

## AR and availability

The original QR URL remains `https://danamohammad.github.io/ar-reservoir/`. GitHub Pages serves the static files from this repository. The QR has no expiry; continued availability depends on the account, repository, Pages service and domain. No permanent-uptime guarantee is made.

The viewer library is vendored, fonts are system fonts, and core model assets use same-origin URLs. No expiring asset links or runtime CDN dependencies were introduced. AR launch may use platform services: Android WebXR/Scene Viewer or Apple Quick Look. The iOS USDZ has initial oil saturation baked in. Annotations and history charts remain in the web view. Physical phone placement is not device-verified.

Rollback baseline: commit `797f9f22c6926736e386df009d4ecd899365043b`. The pre-upgrade repository and files were backed up as a Git bundle and ZIP. An upgrade can be reverted with a new Git revert commit, preserving history. A future Cloudflare mirror can serve the same static assets; preserving the printed github.io QR also requires retaining this GitHub Pages path or a redirect there. Moving hosting alone cannot make a github.io URL independent of GitHub. No hosting migration or new credentials were needed for this upgrade.
