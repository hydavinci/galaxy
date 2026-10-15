# Static deployment and safe builds

Galaxy is a static Vite application. Build and validate a **separate checkout or source export**, then publish that completed artifact. This repository update does not itself redeploy the live site.

## Build in isolation

```bash
# Run in a clean, non-serving checkout.
cd engine
npm ci
npm run typecheck
npm test
npm run build
```

Serve `engine/dist/` using a static HTTP(S) server. The main document is `index.html`; all current module URLs and data paths must resolve from the same app base. The public `space/index.html` and `observer/index.html` files are HTTP-200 client-side redirects to `/`, not standalone applications or HTTP-301 server rules.

**Do not run a build over the served directory.** On the existing deployment host, `engine/dist` is a symlink to a versioned release. Vite empties its output directory and TypeScript also emits there. `scripts/check-build-output.mjs` rejects a symlink before either tool writes output. Keep the live symlink intact; use an isolated checkout/export rather than bypassing the guard.

## Release contract

1. Preserve the prior release, current Git changes and any necessary rollback metadata outside Git. Never include credentials in a generic backup.
2. Build in a new real directory, with the lockfile and all required repository test data.
3. Run typecheck, the full suite, build and any feature-specific emitted-application/browser checks. Bind results to the exact source and complete generated module graph.
4. Retain old **content-hashed** assets in the candidate so open tabs with an old HTML document can still fetch their modules. Reject same-name/different-byte collisions. Check compatibility of unversioned data separately.
5. Prepare a rollback to the exact previous target. Guard the publication against any intervening release change.
6. On a symlink-based static root, atomically replace a sibling temporary symlink with the new target. Do not remove the live root first. No application-service restart is normally needed for a static root switch.
7. Fetch the public document and all referenced/current data resources. Compare expected content types and hashes, not HTTP status alone. A CDN may add a known analytics script; attribute the exact HTML difference rather than declaring raw HTML byte-identical or stripping arbitrary scripts.
8. Verify the previous source/data and original checkout remain preserved. Roll back if the public artifact fails acceptance, but refuse rollback if a newer release has since been published.

The production host keeps its own detailed `DEPLOYMENT.md`, release directories, raw verification reports and guarded switch scripts. Those contain local paths/history and are intentionally ignored by Git; this document is the portable deployment contract, not a command to overwrite a running host.

## Browser verification is separate

A real visual gate should open the published URL in a sandboxed WebGL2-capable browser, exercise the mouse/touch controls, capture screenshots or video and inspect console/context errors. DOM emulators and recording-WebGL tests cannot establish compositor paint, physical input feel or FPS.

Do not use `--no-sandbox`, change host/AppArmor permissions or restart unrelated services as an automatic build workaround. Browser-environment changes require their own approval. Public HTTP validation does not close that gap.
