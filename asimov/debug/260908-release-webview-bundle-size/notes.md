# Bundle size release gate

## Symptom

`pnpm package` failed because `media/webview.js` was 4.81 MB, above the 4.50 MB ceiling.

## Repro

`node scripts/check-bundle-size.mjs` exited 1 at 5,045,190 bytes.

## Root cause

A user-owned `pnpm run watch` process in this repository kept rebuilding `media/webview.js` with the development configuration. It overwrote the 4,162,938-byte production bundle between the production build and the size check.

## Eliminated

Real production bundle growth. An independent build using the exact production configuration and `node esbuild.js --production` both produced 4,162,938 bytes (3.97 MB), below the ceiling.

## Fix and verification

Stopped the repository watcher before release and rebuilt production output. The formal repro and `pnpm check-types` regression are green.

## Scope and residual risk

No production-code change was required for the size failure. The same watcher can overwrite generated `media/webview.js` during packaging, so release packaging must run without the development watcher. The existing size gate caught the contamination; a future release preflight could explicitly reject an active repository watcher.
