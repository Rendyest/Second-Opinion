# Clip masking (standalone Python)

`mask_clips.py` re-exports face-masked copies of local video files for the
labelling step. It is separate from the web app and shares no code with it.

- Python 3.10, 3.11, 3.12 or 3.13 (64-bit). Pins target 3.13+; `mediapipe==0.10.14`
  has no wheels for 3.13, so the file pins `0.10.35` with `numpy==2.1.3`.
- No network calls: model files are placed manually in `scripts/models/`
  (`pose_landmarker.task` and `face_detector.task` from the official
  MediaPipe model releases). The script never downloads anything and fails
  with a clear message when a model file is missing.
- Thresholds come from the repo-root `config.default.json` (`mask.*`).
  A missing key is an error; tuned values belong in gitignored
  `config.local.json`, which this script does not read.

Setup (project-local environment, never the system interpreter):

```
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt
```

Windows (PowerShell):

```
py -m venv scripts\.venv
scripts\.venv\Scripts\pip install -r scripts\requirements.txt
```

Run:

```
scripts/.venv/bin/python scripts/mask_clips.py <clips-folder> [--dry-run]
```

Tests (no model files needed; detectors are injected fakes):

```
scripts/.venv/bin/python -m pytest scripts/test_mask_clips.py
```

Outputs: `scripts/masked/<random-id>.mp4` plus a local-only
`scripts/masked/_index.csv` mapping ids to source names. The csv must
never go into any bundle or be committed.
