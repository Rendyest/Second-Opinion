# Second Opinion — webcam coaching demo

A webcam demo that guides a participant through washing their face with a face
towel, with live movement feedback and coaching tips. Participant routes are
`/setup` (consent, camera checks, arm and face calibration) and `/session`
(guided exercise with live coaching). Reviewer routes are `/metrics`,
`/review`, and `/validation`.

## Stack

- Web app: React + TypeScript + Vite. Pose estimation runs on MediaPipe —
  Tasks Vision in the browser for live sessions, Python scripts
  (`system1_loop.py`, `replay.py`, `quality_gate.py`, `struggle_detector.py`,
  `video_diagnostics.py`) for the offline loop, replay harness, and
  diagnostics.
- Live coaching: with consent, a Node proxy (`server/proxy.mjs`) forwards an
  aggregate movement summary to the Muse Spark Responses API and returns a
  tip. When cloud coaching is disabled or a request fails, the app labels the
  fallback as a **Local tip**. No video ever leaves the browser.
- Mock and synthetic data (never results): `public/mock-stream.json` replays
  a fixed event stream, and `scripts/make-demo-data.mjs` generates
  deterministic synthetic clips for the reviewer routes (gitignored output).
- No SAM is used and no external datasets are used. (`third_party/sam/`
  is vendored but unused — nothing imports it.)

## Live status

Working: webcam setup checks, calibration, live pose with frame gates,
struggle detection with cooldown, cloud and local coaching tips, session
controls, and the reviewer routes.

## How to run

Use Node.js 22 or later. From the repository root in Windows PowerShell:

```powershell
npm install
npm run dev        # open the printed localhost URL (webcam needs localhost or HTTPS)
npm test           # vitest suite
```

For live cloud coaching, copy the example env if you do not already have a
`.env`, set `MODEL_API_KEY`, and run the proxy alongside the frontend in
separate PowerShell windows from the repository root:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run coach-proxy
npm run dev
```

Open the localhost URL Vite prints. In an active webcam session, opt in to
cloud summaries and press **Get a tip**, or let System 1 detect a struggle.
Metrics shows the outcome of completed cloud attempts.

For a local rehearsal from a production build, run `npm run build` followed
by `npm run preview` with the proxy still running. Both Vite commands forward
`/api/coach` to the loopback proxy on port 8787 by default; to use another
port, set `COACH_PORT` in the root `.env` and restart both commands.

To exercise the reviewer routes, generate synthetic demo data (defaults to
`scripts/clips/demo/`, which is gitignored and can never be committed):

```powershell
node scripts/make-demo-data.mjs
node scripts/make-results.mjs scripts/clips/demo
```

Then: `/metrics` → Replay → Choose a clip file; `/review` → Choose a review
bundle file; `/validation` reads the generated `results/results.json`. Check
the plumbing with `npm test -- tests/demoData.test.ts`, which generates into
a temp folder, validates every output, and scores it.

## Recording a real clip and measuring call policies

Synthetic clips and `?source=mock` must never back reported numbers. For real
figures, record a clip from the webcam and replay it on `/metrics`:

1. Enable the dev recorder by creating gitignored
   `src/config/config.local.json` containing
   `{ "ui": { "dev_controls": true } }`, then restart `npm run dev`.
2. On `/setup`, tick both the recording consent choice and the face-masked
   clips choice. Without the first, recording will not start; without the
   second, download is refused.
3. On `/metrics`, enter an anonymous label (a code like `P1`, never a name),
   tick the recorder's own consent checkbox, and press **Start recording**.
   Optionally use **Mark struggle start/end** around the hard part — those
   labels power the needed-help coverage rows. Recording caps at 120 seconds
   and stores landmark numbers only, never video or images.
4. Press **Stop recording**, then **Download clip** (`<label>.clip.json`,
   `source: "recorded"`). Calibrate beforehand if you want a calibrated
   replay. An existing video file can be converted instead via the importer
   below the recorder.
5. In the Replay workspace use **Choose a clip file** with that file (not
   "Replay synthetic fixture"). Take calls-made per policy (`every_frame`,
   `fixed_interval` at the 2 s default, `gated_trigger`) and calls-saved
   against the baselines from the Loop comparison, then **Download results
   (JSON)** and **(CSV)**.
6. System 2 latency is not in that export by design (the replay never calls
   the cloud model). Time real `/session` cloud calls instead — DevTools
   Network on `POST /api/coach`, or the proxy log — with the proxy running.
   Each tip costs one billed call and the 60 s cooldown spaces them out, so
   with only a handful of calls report the median and the count rather than
   a p95.

Keep exported files and screenshots out of `results/` (gitignored build
output): save them elsewhere and never overwrite `results/results.json`.

## License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 Rendyest.
