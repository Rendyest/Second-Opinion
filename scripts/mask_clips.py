"""Face-mask local clips for the labelling step. Standalone; shares no code
with the web app.

Reads mp4 files from a folder, masks every head it can find (SAM 3.1
person-mask head region UNION YuNet face boxes, opaque fill), and writes
video-only masked copies to scripts/masked/<random-id>.mp4 plus a local-only
scripts/masked/_index.csv mapping ids to source names.

No network calls anywhere: model files live in scripts/models/ and the
script aborts when they are missing. Never writes unmasked frames to disk.
The only clips this project ever writes live under scripts/masked/.

Thresholds come from the repo-root config.default.json (mask.*); a missing
key is an error. Tuned values belong in gitignored config.local.json, which
this script does not read.
"""

import argparse
import csv
import secrets
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import cv2
import numpy as np

# Head points are sampled from the SAM 3.1 person mask (upper region), so
# this keeps the historical name only: detectors return mask samples, not
# BlazePose indices.
HEAD_LANDMARKS = (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)

SAM_MODEL_NAME = "sam3_1_person.pt"
FACE_MODEL_NAME = "face_detection_yunet_2023mar.onnx"
# Upper fraction of a person mask treated as the head region. Upright
# framing puts the head at the top; the margin config still applies after.
HEAD_TOP_FRAC = 0.28
# Grid stride (px) when sampling head-mask points for head_box_from_points.
MASK_SAMPLE_STRIDE = 8
# YuNet detection threshold. Higher misses small faces; lower adds noise.
YUNET_SCORE_THRESH = 0.6

# (x0, y0, x1, y1) in pixels, x1 > x0 and y1 > y0.
Box = tuple

CATEGORIES = ("pose", "face", "both", "stale", "full", "dropped")


class MaskError(Exception):
    """Fatal, fail-closed error: abort with no output."""


@dataclass
class MaskConfig:
    min_landmark_visibility: float
    min_landmarks: int
    pose_margin_frac: float
    face_margin_frac: float
    stale_box_frames: int
    stale_expand_frac: float
    on_miss: str
    max_unusable_frac: float

    @classmethod
    def from_dict(cls, raw: object) -> "MaskConfig":
        if not isinstance(raw, dict):
            raise MaskError("config.default.json has no mask.* section")
        missing = [k for k in _REQUIRED_KEYS if k not in raw]
        if missing:
            raise MaskError(f"config.default.json is missing mask keys: {', '.join(missing)}")
        try:
            cfg = cls(
                min_landmark_visibility=float(raw["min_landmark_visibility"]),
                min_landmarks=int(raw["min_landmarks"]),
                pose_margin_frac=float(raw["pose_margin_frac"]),
                face_margin_frac=float(raw["face_margin_frac"]),
                stale_box_frames=int(raw["stale_box_frames"]),
                stale_expand_frac=float(raw["stale_expand_frac"]),
                on_miss=str(raw["on_miss"]),
                max_unusable_frac=float(raw["max_unusable_frac"]),
            )
        except (TypeError, ValueError) as e:
            raise MaskError(f"config.default.json has non-numeric mask values: {e}")
        if cfg.min_landmarks <= 0:
            raise MaskError("mask.min_landmarks must be a positive integer")
        if cfg.stale_box_frames < 0:
            raise MaskError("mask.stale_box_frames must be 0 or more")
        if cfg.on_miss not in ("full_mask", "drop"):
            raise MaskError('mask.on_miss must be "full_mask" or "drop"')
        return cfg


_REQUIRED_KEYS = (
    "min_landmark_visibility",
    "min_landmarks",
    "pose_margin_frac",
    "face_margin_frac",
    "stale_box_frames",
    "stale_expand_frac",
    "on_miss",
    "max_unusable_frac",
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = REPO_ROOT / "config.default.json"
DEFAULT_MODELS_DIR = Path(__file__).resolve().parent / "models"
DEFAULT_MASKED_DIR = Path(__file__).resolve().parent / "masked"


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> MaskConfig:
    import json

    try:
        raw = json.loads(path.read_text())
    except OSError as e:
        raise MaskError(f"cannot read {path}: {e}")
    except ValueError as e:
        raise MaskError(f"{path} is not valid JSON: {e}")
    if not isinstance(raw, dict) or "mask" not in raw:
        raise MaskError(f"{path} has no mask.* section")
    return MaskConfig.from_dict(raw["mask"])


def expand_box(box: Box, frac: float, width: int, height: int) -> Box:
    """Grow a box by frac of its own scale on every side, clipped to frame."""
    x0, y0, x1, y1 = box
    scale = max(x1 - x0, y1 - y0)
    d = int(round(frac * scale))
    return (
        max(0, x0 - d),
        max(0, y0 - d),
        min(width, x1 + d),
        min(height, y1 + d),
    )


def union_boxes(boxes: list) -> Box | None:
    boxes = [b for b in boxes if b is not None]
    if not boxes:
        return None
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def head_box_from_points(points: list, cfg: MaskConfig, width: int, height: int) -> Box | None:
    """Bounding box of the head landmarks that clear the visibility bar.

    points are (x, y, visibility) in pixels. Fewer than min_landmarks
    usable points counts as not found.
    """
    kept = [(x, y) for (x, y, vis) in points if vis is not None and vis >= cfg.min_landmark_visibility]
    if len(kept) < cfg.min_landmarks:
        return None
    box: Box = (
        int(min(p[0] for p in kept)),
        int(min(p[1] for p in kept)),
        int(max(p[0] for p in kept)),
        int(max(p[1] for p in kept)),
    )
    if box[2] <= box[0] or box[3] <= box[1]:
        return None
    return expand_box(box, cfg.pose_margin_frac, width, height)


def fill_box(frame: np.ndarray, box: Box) -> None:
    """Opaque solid fill, in place. Never blur or pixelation."""
    cv2.rectangle(frame, (box[0], box[1]), (box[2], box[3]), (0, 0, 0), -1)


def contiguous_ranges(indices: list, fps: float) -> list:
    """Contiguous frame runs as (start_s, end_s) seconds for manual review."""
    if not indices:
        return []
    ordered = sorted(indices)
    ranges = []
    start = prev = ordered[0]
    for i in ordered[1:]:
        if i == prev + 1:
            prev = i
        else:
            ranges.append((round(start / fps, 2), round((prev + 1) / fps, 2)))
            start = prev = i
    ranges.append((round(start / fps, 2), round((prev + 1) / fps, 2)))
    return ranges


def format_ranges(ranges: list) -> str:
    if not ranges:
        return "none"
    return ", ".join(f"{a:.2f}-{b:.2f} s" for a, b in ranges)


class ClipOutcome:
    def __init__(self) -> None:
        self.counts = {c: 0 for c in CATEGORIES}
        self.full_idx: list = []
        self.dropped_idx: list = []
        self.single_idx: list = []
        self.outputs: list = []

    @property
    def n_in(self) -> int:
        return sum(self.counts.values())

    @property
    def n_masked(self) -> int:
        return self.counts["pose"] + self.counts["face"] + self.counts["both"] + self.counts["stale"]


def detect_boxes(rgb, idx, pose_fn, face_fn, cfg: MaskConfig, width: int, height: int):
    """Run both detectors fail-closed. Returns (pose_box_or_None, face_box_or_None)."""
    try:
        pose_box = head_box_from_points(pose_fn(rgb, idx), cfg, width, height)
    except Exception:
        pose_box = None
    try:
        face_box = union_boxes(
            [expand_box(b, cfg.face_margin_frac, width, height) for b in face_fn(rgb, idx)]
        )
    except Exception:
        face_box = None
    return pose_box, face_box


class Masker:
    """One clip's masking state: stale-box reuse plus outcome tallies."""

    def __init__(self, cfg: MaskConfig) -> None:
        self.cfg = cfg
        self.stale_box: Box | None = None
        self.stale_left = 0
        self.outcome = ClipOutcome()

    def step(self, frame: np.ndarray, pose_box, face_box, idx: int):
        """Mask one frame. Returns (masked_frame_or_None, category)."""
        height, width = frame.shape[:2]
        union = union_boxes([pose_box, face_box])
        if union is not None:
            self.stale_box, self.stale_left = union, self.cfg.stale_box_frames
            masked = frame.copy()
            fill_box(masked, union)
            if pose_box is not None and face_box is not None:
                self.outcome.counts["both"] += 1
                return masked, "both"
            if pose_box is not None:
                self.outcome.counts["pose"] += 1
                self.outcome.single_idx.append(idx)
                return masked, "pose"
            self.outcome.counts["face"] += 1
            self.outcome.single_idx.append(idx)
            return masked, "face"
        if self.stale_box is not None and self.stale_left > 0:
            self.stale_left -= 1
            masked = frame.copy()
            fill_box(masked, expand_box(self.stale_box, self.cfg.stale_expand_frac, width, height))
            self.outcome.counts["stale"] += 1
            return masked, "stale"
        if self.cfg.on_miss == "full_mask":
            self.outcome.counts["full"] += 1
            self.outcome.full_idx.append(idx)
            return np.zeros_like(frame), "full"
        self.outcome.counts["dropped"] += 1
        self.outcome.dropped_idx.append(idx)
        return None, "dropped"


def process_frames(frames, pose_fn, face_fn, cfg: MaskConfig, fps: float, keep_outputs: bool = True) -> ClipOutcome:
    """Mask one clip in memory. pose_fn/face_fn are injected detectors.

    pose_fn(rgb, idx) -> [(x, y, visibility)] in pixels.
    face_fn(rgb, idx) -> [(x0, y0, x1, y1)] in pixels.
    """
    masker = Masker(cfg)
    frames = list(frames)
    for idx, frame in enumerate(frames):
        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pose_box, face_box = detect_boxes(rgb, idx, pose_fn, face_fn, cfg, width, height)
        masked, _ = masker.step(frame, pose_box, face_box, idx)
        if keep_outputs and masked is not None:
            masker.outcome.outputs.append(masked)
    check_counts(masker.outcome, len(frames))
    return masker.outcome


def check_counts(outcome: ClipOutcome, n_read: int) -> None:
    """Every decoded frame must land in exactly one bucket."""
    kept = outcome.n_masked + outcome.counts["full"] + outcome.counts["dropped"]
    if n_read != kept:
        raise MaskError(f"count mismatch: read={n_read} masked={outcome.n_masked} "
                        f"full={outcome.counts['full']} dropped={outcome.counts['dropped']}")


def is_unusable(outcome: ClipOutcome, cfg: MaskConfig) -> bool:
    if outcome.n_in == 0:
        return True
    return (outcome.counts["full"] + outcome.counts["dropped"]) > cfg.max_unusable_frac * outcome.n_in


def build_detectors(models_dir: Path):
    """Load the real detectors. Missing files abort with no output.

    Returns (sam_predictor, yunet_detector). Sapiens checkpoints are
    deliberately not wired in: they are CC BY-NC and must stay out of the
    MIT release, so this path is SAM 3.1 plus OpenCV YuNet only.
    """
    sam_path = models_dir / SAM_MODEL_NAME
    face_path = models_dir / FACE_MODEL_NAME
    missing = [p.name for p in (sam_path, face_path) if not p.is_file()]
    if missing:
        raise MaskError(
            f"model file(s) missing in {models_dir}: {', '.join(missing)}. "
            "Place them there manually; this script never downloads models."
        )
    try:
        sam = load_sam_predictor(sam_path)
        yunet = cv2.FaceDetectorYN.create(
            str(face_path), "", (320, 320), YUNET_SCORE_THRESH
        )
    except Exception as e:
        raise MaskError(f"detectors cannot load: {e}")
    return sam, yunet


def load_sam_predictor(sam_path: Path):
    """Load a SAM 3.1 person-segmentation predictor from a local checkpoint.

    Supports the `sam3` package (`Sam3Processor`/`Sam3Model`) when installed;
    anything else raises and build_detectors fails closed. No downloads.
    """
    try:
        from sam3 import Sam3Model, Sam3Processor  # type: ignore
    except Exception as e:
        raise MaskError(f"SAM 3.1 backend missing (pip install sam3): {e}")
    try:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = Sam3Model.from_pretrained(str(sam_path)).to(device).eval()
        return (Sam3Processor.from_pretrained(str(sam_path)), model, device)
    except Exception as e:
        raise MaskError(f"SAM 3.1 weights cannot load: {e}")


def sam_person_mask(sam, rgb: np.ndarray) -> np.ndarray | None:
    """Largest person mask for the frame, or None when no person is found."""
    processor, model, device = sam
    import torch

    inputs = processor(images=rgb, return_tensors="pt")
    inputs = {k: (v.to(device) if hasattr(v, "to") else v) for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model(**inputs)
    masks = processor.post_process_masks(outputs)[0]
    if masks is None or len(masks) == 0:
        return None
    import numpy as np

    areas = [float((m > 0).sum()) for m in masks]
    best = masks[int(np.argmax(areas))]
    return (best > 0).astype(np.uint8)


def make_pose_fn(pose, width: int, height: int):
    """Sample head-region points from the SAM 3.1 person mask.

    Keeps the historical pose_fn signature so head_box_from_points and the
    injected-fake tests are untouched: returns [(x, y, visibility)] in
    pixels, visibility 1.0 inside the head region, [] when no person mask.
    """

    def pose_fn(rgb: np.ndarray, idx: int, fps: float = 30.0):
        try:
            mask = sam_person_mask(pose, rgb)
        except Exception:
            return []
        if mask is None:
            return []
        ys, xs = np.nonzero(mask)
        if len(xs) == 0:
            return []
        top = int(ys.min() + HEAD_TOP_FRAC * (ys.max() - ys.min() + 1))
        head = mask.copy()
        head[top + 1 :, :] = 0
        out = []
        for y in range(0, height, MASK_SAMPLE_STRIDE):
            for x in range(0, width, MASK_SAMPLE_STRIDE):
                if head[y, x]:
                    out.append((float(x), float(y), 1.0))
        return out

    return pose_fn


def make_face_fn(face, width: int, height: int):
    """YuNet face boxes in pixels. Empty when no face or on backend errors."""

    def face_fn(rgb: np.ndarray, idx: int, fps: float = 30.0):
        try:
            face.setInputSize((width, height))
            _, faces = face.detect(rgb)
        except Exception:
            return []
        if faces is None:
            return []
        boxes = []
        for f in faces:
            x, y, w, h = (int(v) for v in f[:4])
            boxes.append((x, y, x + w, y + h))
        return boxes

    return face_fn


def open_capture(path: Path):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise MaskError(f"cannot decode {path}")
    if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
        # Bake rotation metadata into the decoded frames.
        cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    return cap


def fresh_id(masked_dir: Path) -> str:
    taken = {p.stem for p in masked_dir.glob("*.mp4")} if masked_dir.is_dir() else set()
    while True:
        candidate = secrets.token_hex(8)
        if candidate not in taken:
            return candidate


def describe(outcome: ClipOutcome, fps: float) -> str:
    c = outcome.counts
    lines = [
        f"in={outcome.n_in} masked={outcome.n_masked} "
        f"(pose={c['pose']} face={c['face']} both={c['both']} stale={c['stale']}) "
        f"full={c['full']} dropped={c['dropped']}",
        f"fully masked ranges: {format_ranges(contiguous_ranges(outcome.full_idx, fps))}",
        f"dropped ranges: {format_ranges(contiguous_ranges(outcome.dropped_idx, fps))}",
        f"single-source ranges: {format_ranges(contiguous_ranges(outcome.single_idx, fps))}",
    ]
    return "\n  ".join(lines)


def mask_clip(source: Path, masked_dir: Path, cfg: MaskConfig, pose, face, dry_run: bool) -> tuple:
    cap = open_capture(source)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not (fps and fps > 0):
        fps = 30.0

    pose_bound = None
    face_bound = None

    masker = Masker(cfg)
    writer = None
    temp_path = final_path = None
    clip_id = None
    try:
        if not dry_run:
            masked_dir.mkdir(parents=True, exist_ok=True)
            clip_id = fresh_id(masked_dir)
            temp_path = masked_dir / f"{clip_id}.part.mp4"
            final_path = masked_dir / f"{clip_id}.mp4"
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            if pose_bound is None:
                # Pixel scale comes from the decoded frames, not the
                # container header, so rotation-baked frames stay correct.
                pose_bound = partial(make_pose_fn(pose, w, h), fps=fps)
                face_bound = partial(make_face_fn(face, w, h), fps=fps)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pose_box, face_box = detect_boxes(rgb, idx, pose_bound, face_bound, cfg, w, h)
            masked, _ = masker.step(frame, pose_box, face_box, idx)
            idx += 1
            if dry_run or masked is None:
                continue
            if writer is None:
                writer = cv2.VideoWriter(str(temp_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
                if not writer.isOpened():
                    raise MaskError(f"cannot encode {temp_path}")
            writer.write(masked)
    finally:
        cap.release()
        if writer is not None:
            writer.release()
    outcome = masker.outcome
    check_counts(outcome, idx)
    if outcome.n_in == 0:
        raise MaskError(f"{source.name}: no frames decoded")
    if dry_run:
        return None, outcome, fps
    if is_unusable(outcome, cfg):
        temp_path.unlink(missing_ok=True)
        return None, outcome, fps
    if (writer is None) or (outcome.n_masked + outcome.counts["full"] == 0):
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise MaskError(f"{source.name}: nothing to encode")
    temp_path.rename(final_path)
    return clip_id, outcome, fps


def append_index(masked_dir: Path, clip_id: str, source_name: str) -> None:
    index_path = masked_dir / "_index.csv"
    new_file = not index_path.is_file() or index_path.stat().st_size == 0
    with index_path.open("a", newline="") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["id", "source"])
        writer.writerow([clip_id, source_name])


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Face-mask local clips for labelling.")
    parser.add_argument("clips_folder", help="folder of local .mp4 files")
    parser.add_argument("--dry-run", action="store_true", help="print counts, write no video")
    parser.add_argument("--models-dir", default=str(DEFAULT_MODELS_DIR))
    args = parser.parse_args(argv)

    try:
        cfg = load_config()
    except MaskError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    folder = Path(args.clips_folder)
    sources = sorted(p for p in folder.glob("*.mp4") if p.is_file()) if folder.is_dir() else []
    if not sources:
        print(f"error: no .mp4 files in {folder}", file=sys.stderr)
        return 2

    try:
        pose, face = build_detectors(Path(args.models_dir))
    except MaskError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    totals = ClipOutcome()
    bad = 0
    for source in sources:
        try:
            clip_id, outcome, fps = mask_clip(source, DEFAULT_MASKED_DIR, cfg, pose, face, args.dry_run)
        except MaskError as e:
            print(f"{source.name}: error: {e}", file=sys.stderr)
            return 2
        for key in CATEGORIES:
            totals.counts[key] += outcome.counts[key]
        print(f"{source.name} -> {clip_id if clip_id else 'dry run'}")
        print(f"  {describe(outcome, fps)}")
        if is_unusable(outcome, cfg):
            print(f"  unusable for labelling (over {cfg.max_unusable_frac} fully masked or dropped)")
            bad += 1
            continue
        if not args.dry_run and clip_id is not None:
            append_index(DEFAULT_MASKED_DIR, clip_id, source.name)
    print(
        f"total in={totals.n_in} masked={totals.n_masked} "
        f"full={totals.counts['full']} dropped={totals.counts['dropped']}"
    )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
