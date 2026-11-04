# Mirra Call — coaching loop (MVP), slice 1: app shell + mock data mode

The slice 1 notes below describe the original mock-only shell. For the
current webcam coaching demo, follow [Live Muse Spark coaching](#live-muse-spark-coaching).

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

The generated Validation page identifies this source as synthetic and omits
participant counts. Do not use its figures as recorded evidence. Regenerate
older result files from the original clips to establish provenance.

## Live Muse Spark coaching

Use Node.js 22 or later. From the repository root in Windows PowerShell,
copy the example if you do not already have a `.env`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Set `MODEL_API_KEY` in `.env` using the same Meta key as the Python scripts.
The Node proxy loads that file automatically. Start the proxy and frontend
in separate PowerShell windows from the repository root:

```powershell
# Window 1
npm run coach-proxy
# Window 2
npm run dev
```

Open the localhost URL Vite prints. In an active webcam session, opt in to
cloud summaries and press **Get a tip**, or let System 1 detect a struggle.
When cloud coaching is disabled or a request fails, the app labels the
available fallback as a **Local tip**. Metrics shows the outcome of completed
cloud attempts. The proxy forwards only an aggregate movement summary to
the Meta Responses API and keeps the key server-side.

For a local rehearsal from a production build, run `npm run build` followed
by `npm run preview` with the proxy still running. Both Vite commands forward
`/api/coach` to the loopback proxy on port 8787 by default. To use another
port, set `COACH_PORT` in the root `.env` and restart both commands. A static host needs its own
same-origin forwarding for that route.
