# Calculated oil–water transport: input audit and assumptions

This is a reproducible **assumption-based transport scenario**, not measured production, a calibrated reservoir simulation, or a field forecast. It uses the existing 1,870 logical cell addresses and approximate supplied static properties. It does not replace the original model or add geological cells. The Animation day label identifies the playback control; the calculation provenance remains explicit in the viewer's information panel.

## Input inventory

Audited sources: the current repository; all 21 entries in `ar-reservoir-paper-bundle.zip`; all 34 entries in the complete submission ZIP; the original build/parser scripts; the authoritative full manuscript and its technical audit. The ZIPs and manuscript remain private local originals; they are not uploaded with the site. The old draft was not treated as the authoritative manuscript.

| Input | Actually available | Use / limitation |
| --- | --- | --- |
| Grid | 17 × 22 × 5, 1,870 all-active addresses; exterior GLB with 1,138 quads | Exact existing exterior geometry is retained. No extra cells or resampling. |
| Full cell geometry | COORD, ZCORN, FEGRID, internal faces and original ACTNUM arrays absent | No physical cell volumes, areas, distances, fault transmissibilities or internal 3D cutaways can be computed reliably. |
| Units | Metadata says FIELD; PERMX in mD; TVD in ft; saturation/porosity fractions | Calculated volume normalized to total pore volume, PV. No conversion to barrels or cubic metres. |
| Porosity | Heterogeneous 0.012–0.250 and second-case 0.150–0.240 encoded rows | Heterogeneous row approximately inverted from 8-bit RGB; used as pore-capacity weights. |
| Permeability | PERMX heterogeneous 0.1–397.2 mD and second-case 66.8–306.6 mD | Heterogeneous row approximately inverted; no PERMY/PERMZ/tensor/orientation. Isotropy is assumed. Second case remains available as a static layer. |
| Initial saturation | So = 0.75 or 0, original texture; old build describes EQUIL WOC 6,750 ft and connate Sw 0.25 | Preserved exactly as encoded at day 0; Sw = 1 − So. This is constructed initialization, not a restart state. |
| Pressure | No initial pressure array or complete EQUIL record | No pressure in psi or bar is shown. The steady graph potential is only used to allocate flow. |
| PVT / fluid data | No usable PVT, viscosity, density, formation-volume factor or compressibility tables | Two incompressible components with equal viscosity and linear phase mobility; normalized volume balance, not mass in kg. |
| Relative permeability / capillary pressure | Only an endpoint cited by the old build; full SWOF/other curves absent | Assumed fractional flow fw = Sw and fo = So; no capillarity or residual trapping model. |
| Boundaries / connectivity | Logical cell numbering; no aquifer, faults, sealing boundaries or NNC records | Six-neighbor I/J/K network, unit geometric factors, no-flow outer boundary. These are scenario choices. |
| Wells | Existing four names and I/J positions, attributed to WELSPECS by original build | Preserve PROD-1 I11/J12, PROD-2 I5/J17, PROD-3 I13/J5, INJ I7/J6 and existing tubes. |
| Trajectories / completions / controls | No surveyed trajectory, completion intervals, skin, well index, BHP or schedule | Assume equal connection to all five layers; no claimed measured well depth. |
| Dynamics / history | No restart arrays, pressure/saturation time series, summary files or production history | No authentic dynamic outputs were available. Imported CSV remains a distinct mode with actual days and explicit units. |
| Other properties | No facies, polymer transport, geomechanical or compaction data | No such changes are simulated. Porosity, permeability, depth and geometry remain static. |

The authoritative submission's technical audit independently states that original grid/INCLUDE arrays and dynamic restart files are absent. File names in the build script are references, not evidence that the files were supplied.

## Model and units

Each logical source cell is a well-mixed compartment. Because its physical volume is unknown, all **bulk** cell volumes are assumed equal. Its normalized pore capacity is `PV_i = phi_i / sum(phi)`, so total model pore volume is 1 PV. This assumption does not assert that the real corner-point cells have equal volume.

Neighbor conductance is `C_ij = harmonic_mean(k_i,k_j) / mean(k)`, with the reconstructed PERMX used in every direction and unit geometric factors. This is a conductivity network, **not** a TPFA calculation on the missing corner-point faces. It cannot reproduce effects of real face areas, thickness, anisotropy, faults, non-orthogonality or non-neighbor connections.

Pure water is injected at INJ at an assumed constant 0.02 PV/day. Total extraction equals injection: each of three producers withdraws 0.02/3 PV/day, split equally over its five layers. Injection is also equally split over five layers. These controls define the scenario clock; changing the assumed rate rescales the time. Thirty assumed days correspond to 0.6 injected PV. No rate is calibrated to a field well. Rates are **PV/day**, cumulative amounts **PV**, never STB/day.

We solve the steady graph equation `sum_j C_ij (h_i − h_j) = injection_i − extraction_i` with zero-mean gauge using Jacobi-preconditioned conjugate gradients. Directed total flux is `q_ij = C_ij (h_i − h_j)`. Local flux divergence is checked against each cell's source/sink. `h` has no mapped physical pressure unit and is not presented as pressure. Under equal viscosity and linear phase mobility, total mobility is constant, so this flow field does not change with saturation.

Water transport uses conservative first-order upwinding:

`PV_i dSw_i/dt = sum_in(q * Sw_upstream) − sum_out(q * Sw_i) + injection_i − extraction_i * Sw_i`.

Oil saturation is `So_i = 1 − Sw_i`. The equivalent oil equation has no oil injection and extracts `extraction_i * So_i`. Two-component saturation sums to one. The model excludes gas, gravity segregation, capillary pressure, compressibility, adsorption, polymer, residual trapping, thermal effects and rock changes. The equal-mobility assumption is deliberately simple; it is not a fitted relative-permeability law.

Explicit steps satisfy `dt * max(inflow_i,outflow_i) / PV_i ≤ 0.8`. Outflow includes production; inflow includes injection. Steps are shortened to land exactly on each saved 0.25-day frame. No saturation clipping is used to conceal balance error. All rates/volumes must be finite and nonnegative within floating-point tolerance. Cumulative volumes integrate the same upstream rates used in every transport step. The small residual at the linear solve can cause round-off of order 1e-12 at a saturation bound; tests enforce tolerance and serialized float32 frames remain within [0,1].

## Numerical verification

Run `python scripts/build_transport.py`, then `python tests/transport_test.py` with numpy and Pillow. The tests check:

- Each phase's inventory plus production minus injection equals its initial inventory.
- Cell saturation bounds and oil + water = 1; nonnegative rates/volumes; injected volume = rate × elapsed day.
- Local flux balance and stable time step.
- Half-step refinement against the default result (pore-weighted final saturation L1 difference below 0.001).
- No spontaneous transport in a closed compartment.
- A single well-mixed tank against the analytic exponential displacement solution.
- Float32 export error; all web mesh positions, normals, indices and well geometry equal the original source.
- Every displayed surface flow direction matches a solved directed connection.

Current numerical results are published in `scenario/transport.json` under `checks`. Phase inventory error is approximately 2e-15 PV in float64. Serialization adds about 1e-9 PV weighted error. CFL maximum is 0.8; maximum step about 0.050804 assumed day. Half-step final L1 difference is about 0.0001266. **These are numerical consistency checks, not history matching or field validation.** A grid-convergence study cannot recover missing geometry and is not claimed.

## What the visualization shows

The exact original build.py palette is restored: blue (low), cyan, green, yellow, red (high), with linear RGB interpolation and rounding. Oil uses the original fixed 0–0.75 scale; water uses a fixed 0–1 scale. Both remain comparable across all saved days within the selected phase. These display scales do not change the saturation calculation. Playback selects a saved 0.25-day frame, without temporal interpolation. Optional 0.1 saturation bands quantize the display only, not the calculation or cell readout. Porosity, permeability and depth retain their original static color rows. No dynamic pressure or geological change is invented.

Grid edges follow the existing exterior quads. Original vertex positions and indices are unchanged; a derived web GLB only expands per-face UV coordinates so cell borders can be drawn. Lighting and texture detail do not add geological resolution. Interior geometry was not reconstructed or displayed as a cutaway.

Surface arrows represent a distributed subset of solved horizontal connections in layer K1. Endpoints are the exact centroids of original top-shell faces, not inferred internal well paths. The moving glyph's traversal time uses mean connected pore capacity divided by connection flux. These are local network-flow cues, not tracked oil particles or validated subsurface trajectories. Vectors can be switched off; playback never rotates the camera.

The calculated production panel reports whole-model oil/water rates and cumulative oil in normalized units. The recorded-history panel is separate, preserves user-supplied units/day values and never changes the scenario. Uploaded-in-the-browser CSV files stay local in memory; nothing is transmitted.

Native AR continues to use the previously repaired static colored GLB/USDZ property assets. The AR information dialog makes the static handoff explicit; oil/water scenario views launch original initial oil saturation. Dynamic colors, chart, timeline and arrows remain in the webpage. Physical-phone AR validation is still required.

## Method references

The generic split between incompressible flow and conservative transport follows standard practice described by [SINTEF's MRST incompressible-flow module](https://www.sintef.no/projectweb/mrst/modules/incomp/). This implementation is a simplified normalized network model, not MRST and not a substitute for a full reservoir simulator. Runtime material updates use the documented [model-viewer scene-graph API](https://modelviewer.dev/examples/scenegraph/).
