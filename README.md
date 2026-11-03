# Mirra Call — coaching loop (MVP), slice 1: app shell + mock data mode

## Files created
- `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`
- `public/config.json` — all thresholds (gate, hysteresis, coach cooldown, fixed-interval baseline)
- `public/mock-stream.json` — 9-event mock replay (pose_frame / system1_state / coach_event)
- `src/contracts.ts` — data-contract types + validators matching the build brief
- `src/config.ts` — config loader/validator (no threshold is hard-coded in `src`)
- `src/mock/mockStreamPlayer.ts` — replay transport (play / pause / step / reset, file-timestamp pacing)
- `src/mock/MockStreamContext.tsx` — loads stream + config once, shared across routes
- `src/components/AppNav.tsx`, `src/components/MockTransport.tsx`
- `src/pages/` — `SetupPage`, `SessionPage` (participant; no dashboards), `MetricsPage`, `ReviewPage`, `ValidationPage`
- `src/App.tsx`, `src/main.tsx`, `src/styles.css`
- `tests/contracts.test.ts`, `tests/config.test.ts`, `tests/mockStreamPlayer.test.ts`

## How to run
- `npm install`, then `npm run dev` (open the printed localhost URL; webcam needs localhost or HTTPS).
- Tests: `npm test` (vitest; fixed fixtures with hand-checkable numbers).
- I could not run either command here: this machine's shell sandbox is unavailable, so **nothing above is verified yet** — please run `npm test` and `npm run dev` and tell me what fails.

## What is mocked vs live
- Mocked: the entire event stream (replayed from `public/mock-stream.json`); review/validation pages show their empty states because `review-queue.json` / `results.json` do not exist yet ("No review clips yet." / "No results yet." — mock data is never shown as a result).
- Live: nothing yet. No camera, no MediaPipe, no Muse Spark calls, no proxy (slice 4).

## Assumptions
- Dev server serves `public/` at root (`/mock-stream.json`, `/config.json`).
- One shared player across routes; navigating does not reset playback.
- Participant routes show no counters or dashboards; reviewer numbers on `/metrics` are labeled replay demos until slice 5.

Waiting for your "next" before slice 2.

## Judge demo data (synthetic clips for the reviewer routes)

Judges can exercise `/metrics`, `/review` and `/validation` without
recording anything: `scripts/make-demo-data.mjs` generates deterministic
synthetic clips (no real-person data — every joint comes from an arm model
raising to a target angle, so output is reproducible).

Generate the data (defaults to `scripts/clips/demo/`, which is gitignored
and can never be committed):

```
node scripts/make-demo-data.mjs
node scripts/make-results.mjs scripts/clips/demo
```

Then, in the app:

1. `/metrics` → Replay → Choose a clip file → any `demo-*.json`
   (`demo-front-90.json`, `demo-side-90.json`, `demo-front-45.json`).
2. `/review` → Choose a review bundle file → `review-bundle.json`
   (one clip carries a demo Muse label for the blind/assist flow; the
   other two have none, exercising the labeled path).
3. `/validation` reads the generated `results/results.json`.

Check the plumbing with `npm test -- tests/demoData.test.ts`, which
generates into a temp folder, validates every output, and scores it.

Synthetic demo data only — never use its figures for reported results.

## Live Muse tips (real cloud-model calls)

Delivered tips carry a "Live tip from the cloud model." note; when the
proxy is unreachable the panel shows the local fallback instead, and every
completed attempt is listed under "Cloud-model tips (dev)" on `/metrics`
with its outcome (live or fallback), so judges can see each real call.

To enable live calls (two shells, from the repo root):

```
# Shell 1 — create .env from the example, then open it in an editor and
# fill in the two required values: MUSE_SPARK_API_KEY is the key you were
# issued, MUSE_SPARK_BASE_URL is the Muse Spark endpoint URL you were
# given. COACH_PORT is optional (default 8787).
# Windows (PowerShell): Copy-Item .env.example .env
# macOS/Linux:          cp .env.example .env
# .env is gitignored (only .env.example is committed), so the real values
# never leave your machine via git. The proxy refuses to start if either
# required value is missing — that is the check that your .env is right.
npm run coach-proxy

# Shell 2 — start the app (the dev server forwards /api/coach to the proxy):
npm run dev
```

Then tick "Allow short summaries of my movement to be sent to the cloud
model" in consent, and either press "Get a tip" or let a struggle flag
fire. Automatic tips are on by default, so a struggle flag fetches a tip
without pressing anything; the toggle in the Coaching section turns that
off, leaving only the hand-pressed button. Without the proxy running, tips
fall back locally and the log shows "Local fallback tip" — no key or
provider URL ever lives in client code.
