# TRAXING PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing static HoraTrade app an installable Android PWA named TRAXING and prepare it for public GitHub Pages deployment.

**Architecture:** Keep the app dependency-free and static. Use project-relative URLs so the site works below `/traxing/`, a web manifest and install icons, and a service worker that caches only same-origin app files. Deploy the repository root through GitHub Actions; keep Bybit REST/WebSocket requests online and outside the cache.

**Tech Stack:** HTML, CSS, browser JavaScript modules, Web App Manifest, Service Worker, GitHub Pages, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-27-traxing-pwa-design.md`

## Global Constraints

- Product name is `TRAXING`; keep the existing market analysis, pairs, 1H/4H behavior, and forecast journal.
- Site is public on GitHub Pages; do not place credentials, keys, or private user data in the repository.
- Project Pages is served beneath `/<repository>/`; app assets, manifest, icons, and worker must respect that scope.
- Market data remains online-only from Bybit; the service worker may cache app shell assets only.
- The forecast journal remains in browser-local storage and does not migrate from `localhost` to `github.io`.
- Keep the existing `horatrade.forecast-journal.v1` storage key so local development data is still visible on its current origin.
- Preserve `node server.mjs` as a local preview server; GitHub Pages does not run the Node server.
- No automated test files or test suite runs; use syntax, manifest, service-worker, and HTTP resource checks.
- Prepare the repository for Pages, but do not push code or activate public deployment before the final review/approval step.

## Review Focus

- Project paths must resolve beneath `/traxing/` and must not accidentally point to the domain root.
- Service-worker scope must remain `/traxing/`, with no caching of Bybit REST/WebSocket traffic.
- Old cached shell versions must not keep TRAXING on stale JavaScript after a deployment.
- Offline launch must still show the local journal while making it clear that market data is paused.
- The final repository and Pages site are public, and localStorage from localhost remains separate.

---

### Task 1: Rename the app and make the static page path-safe

**Files:**
- Modify: `index.html`
- Modify: `README.md`
- Modify: `server.mjs`

**Interfaces:**
- Page assets use paths relative to the current GitHub Pages project URL.
- `index.html` links `manifest.webmanifest`; the existing module entry remains `src/app.js`.

- [ ] Change visible branding, page title, description, and accessible app labels to TRAXING.
- [ ] Change root-absolute asset and home links to project-relative URLs so `/traxing/` works.
- [ ] Add a manifest link and theme metadata without changing market-analysis behavior.
- [ ] Update README with local run, GitHub Pages install, online-data, public-site, and per-browser journal notes.
- [ ] Inspect all local URL references for remaining root-absolute paths.

### Task 2: Add Android-installable PWA metadata and app-shell caching

**Files:**
- Create: `manifest.webmanifest`
- Create: `service-worker.js`
- Create: `icons/traxing-192.png`
- Create: `icons/traxing-512.png`
- Modify: `src/app.js`

**Interfaces:**
- Manifest values: `name` and `short_name` `TRAXING`, `start_url` `./`, `scope` `./`, `display` `standalone`, theme/background colors from the existing UI, and 192/512 icons.
- Worker script URL and scope are relative to the deployed project root.
- Worker fetch policy is same-origin network-first with offline cache fallback; cross-origin Bybit traffic is never cached.

- [ ] Create matching TRAXING launcher icons at the manifest's declared PNG sizes.
- [ ] Add and validate the manifest fields and project-relative icon URLs.
- [ ] Register the worker only in secure contexts (HTTPS or local development).
- [ ] Pre-cache the static app shell, serve offline fallback, and remove older cache versions on activation.
- [ ] Verify the journal UI can load from cached app files while market data status remains paused offline.

### Task 3: Prepare automatic GitHub Pages deployment

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Workflow deploys the repository root as static content on pushes to `main` and supports manual dispatch.
- No build command or runtime dependencies are required.

- [ ] Add a least-privilege Pages workflow with checkout, Pages setup, artifact upload, and deploy steps.
- [ ] Confirm the artifact includes the page, manifest, worker, icons, styles, and JavaScript modules.
- [ ] Document the expected project URL shape `https://<usuario>.github.io/<repositorio>/` and the Android install steps.
- [ ] Keep the actual repository push and Pages activation for after the local artifact review and final user approval.

### Task 4: Perform static and local delivery checks

**Files:**
- Review: `index.html`, `manifest.webmanifest`, `service-worker.js`, `src/app.js`, `.github/workflows/pages.yml`, and all icon assets.

- [ ] Run `node --check` on the existing app modules and service worker.
- [ ] Parse the manifest as JSON and verify the icon files have the declared dimensions.
- [ ] Serve the project locally and request the page, manifest, worker, icons, and JavaScript modules; require successful HTTP responses.
- [ ] Inspect the deployment workflow permissions, artifact root, branch trigger, and GitHub Pages path assumptions.
- [ ] Present the complete local result and any GitHub connection/publishing blocker before deployment.
