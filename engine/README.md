# Galaxy Engine

The current **3D-only** WebGL2 application for https://galaxy.graymammoth.com/. Start with the [root README](../README.md) for features, controls, sources and limitations.

## Development and verification

Requirements: Node.js 22.12+ or a newer supported LTS release, npm, and Python 3.10+ for reproducible-data tests.

```bash
npm ci
npm run dev -- --host 127.0.0.1
npm run typecheck
npm test
npm run build
```

- Vite root: `src/`; static input: `public/`; build output: **this directory's `dist/`**, not a repository-root `dist/`.
- `npm test` runs the suite with bounded concurrency and per-file timeouts. Fixtures are portable repository inputs; no historical deployment directory or credentials should be required.
- The build safety check refuses a symlinked `dist` **before** TypeScript emits files. On a deployment host, that symlink may be serving the live site. Build in a separate clean checkout/export; do not remove or rebuild through it.
- No production JavaScript UI framework. Runtime astronomy uses pinned `astronomy-engine`; development uses TypeScript, Vite, `tsx` and Happy DOM.

See [testing](../docs/testing.md) and [deployment](../docs/deployment.md).

## Active architecture

`src/app.ts` mounts only `src/space/app.ts`, its stylesheet and the spatial template. The main application owns a single animation loop and WebGL context; retry/disposal cancels pending work and releases owned resources. `/space/` and `/observer/` remain static client redirects for old bookmarks.

- `space/world.ts`: ten Solar objects in one geometric heliocentric world; real reference radii and explicit coordinate conventions.
- `space/catalog.ts`, `stellar-model.ts`: 9,078 HYG-derived stars; measured/reference and estimated quantities remain distinguished.
- `space/navigation.ts`: whole-view look, physical translation, middle-button orbit and separate spacecraft observation/follow references.
- `space/labels.ts`: same-frame label projection and physical occultation; bounded ranking, stable nodes and interaction-aware priority.
- `hips/`: photographic distant-sky tiles with atomic coarse coverage and bounded ancestor/texture/mesh work.
- `space/observations.ts`: separate on-demand photo gallery and provenance; only verified Earth/Moon map products are globe textures.
- `space/spacecraft.ts`, `trajectories.ts`, `trajectory-overlay.ts`: mission facts, bounded source interpolation and projected paths/historical sites. No client-side Horizons polling or extrapolation.
- `space/dom-patches.ts`: change-only text/attributes and reusable fact rows to avoid periodic UI rebuilding.

`src/observer/` and some earlier modules/assets remain for shared helpers and regression coverage. The legacy 1.6M-star procedural LOD view, constellation/grid controls and old observer UI are **not the active main application**.

## Data contracts

The active catalog stores finite 3D positions, not just RA/Dec brightness records. Public provenance JSON accompanies catalogs, stellar parameters, maps and gallery images. Spacecraft trajectories store integer UTC milliseconds, center-relative AU positions and AU/second velocities; source ICRF axes are explicitly permuted to the scene's Y-up convention.

Historical observation dates, source processing, source-model predictions, finite coverage and unknown surfaces remain visible. See [data and attribution](../docs/data-and-attribution.md) before redistributing assets or updating their generation inputs.

## Acceptance boundaries

CPU geometry, DOM and recording-GL tests are not real browser/GPU paint tests. Verify actual browser rendering, input and frame timing separately without disabling its sandbox. A successful build or HTTP 200 is not a visual acceptance result.
