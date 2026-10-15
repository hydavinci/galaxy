# Historical negative controls

These two source files are **verbatim copies**, not simplified implementations
or generated failures. `PROVENANCE.json` records each historical release ID,
source path relative to that release, byte length and SHA-256. The stellar-label
test verifies both local copies against that manifest.

- `full-rotation-app.ts` is the original `engine/src/space/app.ts` from
  `full-rotation-20261014T113611Z`. Its real `buildLabels` / `updateLabels`
  implementation creates solar-system body labels only. The negative test
  selects the real catalog Sirius, verifies it is visible, retains the assertion
  that there are ten body labels, and verifies there is no Sirius name label.
  The same test then checks that the current app does expose the star label.
- `stellar-closeup-shaders.ts` is the original
  `engine/src/space/stellar-shaders.ts` from
  `stellar-closeup-20261014T145943Z`. Its actual procedural-noise and granulation
  code is rejected by the observation-first absence contract; the current
  shader is still required to pass that contract.

## Bounded harness and limitations

Only these two old source files are retained; no old engine, dependencies,
assets, build output, or helper implementations are copied. The old app is
bundled in memory by `space-stellar-labels.test.ts`. Its relative imports resolve
as if it were in the **current checkout's** `src/space` directory, including
`../modes` and `../observer`. The existing recording renderer replaces only the
app's renderer import, for both current and old apps. Catalog, astronomy,
navigation, projection, DOM template and styles come from this checkout.
The astronomy package resolves through Node's package resolver, so the in-memory
bundle uses the same installed dependency as the Node-side assertions.

Thus this is a genuine historical **app-algorithm** negative control, not a
reconstruction of the entire historical release. The renderer and DOM evidence
is synthetic scheduling/geometry/wiring evidence, not browser pixels. The
shader negative control inspects the exact historical source; it does not
render that old material. Do not replace either fixture with a stub or silently
rewrite it to match future helper APIs. If helpers become incompatible, retain
the original bytes and explicitly review any minimal compatibility harness.

All fixture locations derive from `import.meta.url` using `fileURLToPath`; no
historical release directory or deployment layout is required. With the
checkout's declared development dependencies available, run from `engine`:

```sh
node --import tsx --test --test-concurrency=2 --test-timeout=90000 tests/space-stellar-labels.test.ts tests/observation-materials.test.ts
```

The fixtures live under `tests/`, outside the production TypeScript include.
Tests bundle with `write: false`; no production build or deployment is needed.
