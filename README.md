# Second Opinion — webcam coaching demo

A webcam demo that guides a participant through washing their face with a face
towel, with live movement feedback and coaching tips. Participant routes are
`/setup` (consent, camera checks, arm and face calibration) and `/session`
(guided exercise with live coaching). Reviewer routes are `/metrics`,
`/review`, and `/validation`.

## Stack

- Web app: React + TypeScript + Vite. Pose estimation runs in a localhost
  Python sidecar (Detectron2 Keypoint R-CNN R50-FPN, Meta FAIR) on
  127.0.0.1 — frames never leave the machine; see "Pose sidecar" below.
  Offline clip masking (`scripts/mask_clips.py`) uses an OpenCV YuNet face
  detector today; SAM 3.1 person masks are the wired next step (weights and
  the `sam3` package not yet installed).
- Live coaching: with consent, a Node proxy (`server/proxy.mjs`) forwards an
  aggregate movement summary to the Muse Spark Responses API and returns a
  tip. When cloud coaching is disabled or a request fails, the app labels the
  fallback as a **Local tip**. No video ever leaves the browser.
- Mock and synthetic data (never results): `public/mock-stream.json` replays
  a fixed event stream, and `scripts/make-demo-data.mjs` generates
  deterministic synthetic clips for the reviewer routes (gitignored output).
- No external datasets are used. (`third_party/sam/` is vendored but unused
  — nothing imports it; masking uses the `sam3` package instead.)

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

## Pose sidecar (WSL2 Ubuntu)

Live pose needs the sidecar: Detectron2 has no Windows wheels, so it runs in
WSL2 Ubuntu while the browser, dev server, and coach proxy stay on Windows
(`localhost` forwards across automatically). Expect roughly 1–2 s per frame
on CPU — hold still for checks, calibration, and tips.

One-time setup (Ubuntu terminal):

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip git build-essential python3-dev curl
cd /path/to/Second-Opinion
python3 -m venv server/.venv
source server/.venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install opencv-contrib-python numpy
pip install "git+https://github.com/facebookresearch/detectron2.git" --no-build-isolation
```

Place weights manually (never downloaded): `models/detectron2_keypoint_rcnn_R_50_FPN_3x.pkl` from the Detectron2 model zoo, or set `DETECTRON2_WEIGHTS`. Sapiens checkpoints stay out (CC BY-NC, demo-only).

Every session, three terminals — sidecar (Ubuntu), proxy and dev (Windows PowerShell):

```bash
python3 server/pose_sidecar.py --port 8788
```

```powershell
npm run coach-proxy   # needs MODEL_API_KEY in .env (see .env.example)
npm run dev
```

Verify: `Invoke-RestMethod http://127.0.0.1:8788/healthz` answers with the
model name; the sidecar terminal prints the backend on first detection; each
live tip logs `coach_live` with `muse-spark-1.3` in the proxy terminal and
reads "Live tip from Muse Spark." on screen.

Local tuning lives in gitignored `src/config/config.local.json` (for example
`{ "gate": { "vis_min": 0.3 } }`); the tip button states its own block reason
on screen when disabled.

## Model licenses

Our code is MIT. Model weights are never committed — each is placed manually
and keeps its own license:

- Detectron2 Keypoint R-CNN (pose sidecar): Apache-2.0, Meta FAIR.
- YuNet face detector (masking weights): MIT (OpenCV Zoo).
- OpenCV library: Apache-2.0.
- SAM 3.1 (planned masking backend, not active): Meta SAM License —
  custom terms with field-of-use restrictions, not OSI-approved; accept
  its terms if you fetch the gated weights.
- Sapiens: deliberately unused — CC BY-NC 4.0, incompatible with this
  MIT release.
- Muse Spark (cloud tips): proprietary Model API, key-gated (`MODEL_API_KEY`).

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
