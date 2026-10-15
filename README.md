# Galaxy ✨

A browser-based **3D celestial explorer** built with TypeScript, Vite and WebGL2. Move through a shared spatial scene containing the Sun, eight planets, the Moon and a finite-distance stellar catalog.

**Live:** https://galaxy.graymammoth.com/

## Current features

- **One 3D application:** heliocentric Solar System positions, real reference radii, free flight and continuous orbit/roll navigation. The former `/space/` and `/observer/` URLs redirect to the main page; they are not separate current modes.
- **9,078 catalog stars:** a reproducible HYG v4.1 subset with finite distances, magnitudes, B−V colors and real names/catalog identifiers. Names and selection markers use the same camera frame as the scene.
- **Photographic sky:** bounded CDS/Mellinger HiPS streaming with complete coarse coverage, ancestor fallback and a bounded tile/mesh cache. This is a distant photographic background, not a traversable 3D galaxy.
- **Observation-first imagery:** 23 separately presented Solar System observation images, with per-image dates, instruments/bands, processing, coverage, source and attribution. Earth and Moon additionally have verified 2K/4K global-map products. Images load on demand, not all at startup.
- **Spacecraft library:** 12 mission records with Chinese/English search, category/body filters, instruments, achievements, historical events and official sources.
- **Spacecraft positions:** nine bounded sampled ephemerides and three historical landing sites. View source-relative coordinates, speed and coverage; switch between **orbit observation** and **following the spacecraft**. Observation mode keeps the source-path reference stable so spacecraft motion is visible as time advances.
- **Time playback:** 35 signed presets including pause, gentle `1× → 2× → 5×` steps, reverse time and **Now**. Supported scene dates are 1900–2100; individual spacecraft data have much shorter coverage.
- **Stable interactions:** left-button whole-view dragging, middle-button orbit, touch/pinch support, bounded 24/48 star-name budgets and drag-time label-priority stabilization. Current-frame visibility/occlusion remains active.

The older binary LOD catalogs, observer code and illustrative textures remain as compatibility/regression assets. They are **not** the main app's active star population or an endorsement of procedural stars/surfaces as observations.

## Controls

| Input | Action |
| --- | --- |
| Left mouse drag | Turn the whole viewing direction; background stars, names and foreground targets move together. Camera position and field of view stay fixed. |
| Middle mouse drag — hold the wheel | Orbit the selected target or the current spacecraft observation reference. |
| Left click | Select a target. |
| Mouse wheel | Move closer/farther through space; not optical zoom. |
| `W A S D` | Forward/backward/left/right translation. |
| `Q / E` | Down/up translation. |
| `Shift` | Temporarily increase movement speed. |
| Touch / pen drag | Orbit or turn according to the current mode; two fingers change distance. |
| `Space` | Pause/resume simulation time when the canvas has focus. |
| `/` | Focus search. |
| `« / »`, **Now** | Adjust signed playback speed or restore current time. |

**Spacecraft:** open **航天器** in the footer, expand a mission and choose the selected-time position or **查看可用时段**. The latter explicitly changes the simulation date and pauses. **轨道观察** shows the craft moving against its path; **跟随航天器** intentionally holds the craft in the view while the path moves relative to it.

## Run locally

Use **Node.js 22.12+ or a newer supported LTS release** and npm. **Python 3.10+** is needed for the data-reproduction tests; no Python package installation is required for those tests.

```bash
git clone git@github.com:hydavinci/galaxy.git
cd galaxy/engine
npm ci
npm run dev -- --host 127.0.0.1
```

Vite normally serves http://127.0.0.1:5173/. A WebGL2-capable browser is required. The photographic sky is fetched from the external CDS service; mission information and sampled positions are shipped as local static data.

```bash
npm run typecheck
npm test
npm run build
```

The build is written to `engine/dist/` relative to the repository root. Serve it over HTTP(S), not `file://`. See [testing](docs/testing.md) and [deployment](docs/deployment.md).

> **Existing production-host checkouts:** `engine/dist` may be the live release symlink. Do not build through it. The build command checks for this before TypeScript or Vite can write output. Use a separate clean checkout/export; never remove the live symlink just to make a build pass.

## Data accuracy and coverage

Galaxy is for visual exploration, **not spacecraft operations or professional astrometry**.

- Solar positions use **Astronomy Engine 2.1.19**, instantaneous geometric heliocentric coordinates in a J2000-equatorial-derived Y-up frame, with JavaScript double-precision positions in AU. This is not an N-body mission propagator, apparent Earth-observer sky or full JPL navigation solution.
- HYG positions use the retained historical catalog epoch. Missing/invalid distance records are excluded, not assigned invented distances. HIP fields are existing HYG cross-identifiers; the original Hipparcos catalog and a new DE kernel have not been imported.
- Stellar close-ups are smooth, explicitly labeled **size/color models**. Reference values and estimates are distinguished. They are not measured stellar surface maps, granulation, weather, spin or invented planetary systems.
- The Earth map is a fixed August 2004 MODIS composite. The Moon product combines LRO observations and documented source processing/polar substitutions. Neither is current weather, raw unprocessed imagery or measured 3D terrain.
- Photographs, radar, infrared/false color, enhanced contrast and mosaics are labeled separately. Regional photographs are never wrapped around an entire planet as if they supplied global coverage.
- Spacecraft vectors are source-model samples, **not live telemetry**. Cubic Hermite interpolation is limited to the included time range; outside it the position is unavailable, with no local extrapolation or looping. Reported interpolation residuals are not actual-position uncertainty bounds.
- Paths are source-knot polylines in the **current center body's translating frame**, not every historical heliocentric position. Scene placement adds the application's center-body position to the source-relative vector; that alignment is not full JPL heliocentric accuracy.
- Perseverance, Tianwen-1/Zhurong and Chang'e 6 use **historical landing-location markers**, not current rover/orbiter/return-capsule positions. Their dates and spherical-display limits are documented.

### Included spacecraft ephemeris windows

This is a dated static sample prepared on **2026-10-15**, not an automatically refreshed feed. After a window expires, use **查看可用时段** to inspect it historically.

| Mission | UTC coverage | Source characterization |
| --- | --- | --- |
| Voyager 1, Voyager 2, New Horizons | 2026-08-15 to 2026-12-15 | Official predictions; Voyager fits use historical tracking data |
| Cassini | 2017-09-08 to 2017-09-14 | Historical reconstruction, before mission end |
| Juno | 2026-10-01 to 2026-11-05 | Official planning prediction |
| Parker Solar Probe | 2026-09-10 to 2026-10-30 | Prediction; partial path, not a complete closed orbit |
| LRO | 2026-10-14 to 2026-10-16 | Prediction |
| Webb | 2026-10-07 to 2026-11-01 | Earth-relative Sun–Earth L2 prediction, not low Earth orbit |
| Hubble | 2026-10-15 to 2026-10-16 | Short-window TLE-derived model |

Exact endpoints, source solution names, transformations and caveats are embedded in [`spacecraft-trajectories.json`](engine/public/data/spacecraft-trajectories.json).

## Repository layout

```text
engine/
  src/app.ts             Single-app bootstrap and mount/dispose lifecycle
  src/space/             Spatial world, navigation, renderers, labels, mission UI
  src/hips/              HiPS loading, visibility, mesh and texture caching
  src/observer/          Shared helpers and retained observer regressions
  public/data/           Catalogs, provenance, mission facts and trajectories
  public/observations/   Verified maps and separate observation gallery
  scripts/               Data generators and build-safety check
  tests/                 Geometry, input, DOM, data and lifecycle regressions
docs/                    Development, deployment and data/rights notes
test-data/               Curated portable scientific and historical test inputs
```

`releases/`, `backups/`, private QA evidence, the host-specific `DEPLOYMENT.md`, credentials, dependencies and generated build output are not committed. The old experimental Next.js wrapper is not part of this app.

## Verification limits

Regression coverage includes independent coordinate/projection oracles, source-data hashes, emitted-app DOM/recorded-WebGL behavior, pointer ownership, image/data lifecycle, cache bounds and the reproduced Revati label-priority dropout. These checks do **not** prove real-browser paint/compositor behavior, physical-device drag feel or hardware FPS. The known one-frame Revati eviction is fixed in tested drag sequences; this is not a universal flicker guarantee.

The Vite bundle-size warning is currently retained rather than hidden by a higher warning threshold. See [testing notes](docs/testing.md) for reproducible commands and the distinction between fixtures and browser evidence.

## Attribution and licenses

The project's application-code license is **MIT**. **Data, textures, images and reference fixtures are not all MIT or blanket public domain.** Their own notices take precedence; see [data and attribution](docs/data-and-attribution.md).

Key sources include HYG v4.1 (**David Nash / Astronomy Nexus, CC BY-SA 4.0**), Astronomy Engine, CDS/Mellinger HiPS, NASA/JPL and mission/instrument teams. Historical Solar System Scope/INOVE illustration assets retain **CC BY 4.0** attribution but are not the active observation-first globe fallback. MESSENGER images retain mission-specific noncommercial educational/public-information terms. Numerical spacecraft-source reuse is documented as a qualified factual-data rationale, **not express NASA/JPL endorsement or a blanket license for all source content**.
