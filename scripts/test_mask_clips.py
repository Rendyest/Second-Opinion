"""Tests for scripts/mask_clips.py. Synthetic frames only, no real faces.

Detectors are injected fakes, so no model file is needed. Real OpenCV
encode/decode is used for the no-audio and frame-count checks.
"""

import json
import re
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from mask_clips import (
    ClipOutcome,
    MaskConfig,
    MaskError,
    append_index,
    check_counts,
    contiguous_ranges,
    expand_box,
    fresh_id,
    head_box_from_points,
    is_unusable,
    load_config,
    mask_clip,
    process_frames,
    union_boxes,
)

HEAD_PTS = [(50, 50), (40, 40), (60, 40), (35, 50), (65, 50), (45, 60), (55, 60)]


def make_cfg(**over):
    base = dict(
        min_landmark_visibility=0.5,
        min_landmarks=4,
        pose_margin_frac=0.5,
        face_margin_frac=0.25,
        stale_box_frames=0,
        stale_expand_frac=0.2,
        on_miss="full_mask",
        max_unusable_frac=0.5,
    )
    base.update(over)
    return MaskConfig.from_dict(base)


def pts(vis=0.9):
    return [(x, y, vis) for (x, y) in HEAD_PTS]


def white(h=100, w=100):
    return np.full((h, w, 3), 255, dtype=np.uint8)


def black_assert(frame, y, x):
    assert (frame[y, x] == 0).all(), f"pixel {(y, x)} should be masked"


def white_assert(frame, y, x):
    assert (frame[y, x] == 255).all(), f"pixel {(y, x)} should stay white"


def test_pose_box_masks_inside_and_keeps_outside():
    cfg = make_cfg()
    out = process_frames([white()], lambda rgb, idx: pts(), lambda rgb, idx: [], cfg, 30.0)
    assert out.counts["pose"] == 1
    frame = out.outputs[0]
    # bbox x 35..65, y 40..60, scale 30, margin 15 -> x 20..80, y 25..75
    black_assert(frame, 50, 50)
    black_assert(frame, 30, 30)
    white_assert(frame, 10, 10)
    white_assert(frame, 90, 90)


def test_face_only_frame_is_masked():
    cfg = make_cfg()
    out = process_frames(
        [white()], lambda rgb, idx: [], lambda rgb, idx: [(30, 30, 60, 60)], cfg, 30.0
    )
    assert out.counts["face"] == 1
    black_assert(out.outputs[0], 45, 45)
    white_assert(out.outputs[0], 10, 10)


def test_disagreeing_sources_cover_both_boxes():
    cfg = make_cfg(pose_margin_frac=0.0, face_margin_frac=0.0)
    pose = [(12, 12, 0.9), (18, 12, 0.9), (12, 18, 0.9), (18, 18, 0.9)]
    out = process_frames(
        [white()],
        lambda rgb, idx: pose,
        lambda rgb, idx: [(70, 70, 80, 80)],
        cfg,
        30.0,
    )
    assert out.counts["both"] == 1
    frame = out.outputs[0]
    black_assert(frame, 15, 15)
    black_assert(frame, 75, 75)
    white_assert(frame, 5, 5)


def test_miss_full_mask_blackens_everything():
    cfg = make_cfg(on_miss="full_mask")
    out = process_frames([white()], lambda rgb, idx: [], lambda rgb, idx: [], cfg, 30.0)
    assert out.counts["full"] == 1
    assert (out.outputs[0] == 0).all()


def test_miss_drop_omits_the_frame():
    cfg = make_cfg(on_miss="drop")
    out = process_frames([white()], lambda rgb, idx: [], lambda rgb, idx: [], cfg, 30.0)
    assert out.counts["dropped"] == 1
    assert out.outputs == []


def test_low_visibility_landmarks_are_ignored():
    assert head_box_from_points(pts(vis=0.2), make_cfg(), 100, 100) is None


def test_too_few_landmarks_counts_as_not_found():
    few = [(50, 50, 0.9), (40, 40, 0.9), (60, 40, 0.9)]
    assert head_box_from_points(few, make_cfg(), 100, 100) is None


def test_detector_exception_masks_that_frame():
    cfg = make_cfg(on_miss="full_mask")

    def flaky(rgb, idx):
        if idx == 2:
            raise RuntimeError("tracking glitch")
        return pts()

    frames = [white() for _ in range(4)]
    out = process_frames(frames, flaky, lambda rgb, idx: [], cfg, 30.0)
    assert out.counts["pose"] == 3
    assert out.counts["full"] == 1
    assert out.full_idx == [2]
    assert (out.outputs[2] == 0).all()


def test_stale_box_reuse_then_miss():
    cfg = make_cfg(on_miss="full_mask", stale_box_frames=2, stale_expand_frac=0.0)

    def pose(rgb, idx):
        return pts() if idx == 0 else []

    out = process_frames([white() for _ in range(4)], pose, lambda rgb, idx: [], cfg, 30.0)
    assert out.counts["pose"] == 1
    assert out.counts["stale"] == 2
    assert out.counts["full"] == 1


def scripted_fns():
    def pose(rgb, idx):
        return pts() if idx <= 6 else []

    def face(rgb, idx):
        return [(70, 70, 80, 80)] if idx <= 4 or idx == 7 else []

    return pose, face


def test_ten_scripted_frames_full_mask():
    cfg = make_cfg(on_miss="full_mask")
    pose, face = scripted_fns()
    out = process_frames([white() for _ in range(10)], pose, face, cfg, 30.0)
    assert out.counts["both"] == 5
    assert out.counts["pose"] == 2
    assert out.counts["face"] == 1
    assert out.counts["stale"] == 0
    assert out.n_masked == 8
    assert out.counts["full"] == 2
    assert out.counts["dropped"] == 0
    assert len(out.outputs) == 10
    check_counts(out)
    assert not is_unusable(out, cfg)


def test_ten_scripted_frames_drop():
    cfg = make_cfg(on_miss="drop")
    pose, face = scripted_fns()
    out = process_frames([white() for _ in range(10)], pose, face, cfg, 30.0)
    assert out.n_masked == 8
    assert out.counts["full"] == 0
    assert out.counts["dropped"] == 2
    assert len(out.outputs) == 8


def test_counts_mismatch_raises():
    out = process_frames([white() for _ in range(4)], lambda rgb, idx: pts(), lambda rgb, idx: [], make_cfg(), 30.0)
    check_counts(out, 4)
    with pytest.raises(MaskError):
        check_counts(out, 5)


def test_unusable_boundary_is_strict():
    cfg = make_cfg(max_unusable_frac=0.5)
    out = ClipOutcome()
    out.counts["full"] = 5
    out.counts["pose"] = 5
    assert not is_unusable(out, cfg)  # exactly at the frac is usable
    out.counts["full"] = 6
    out.counts["pose"] = 4
    assert is_unusable(out, cfg)


def test_ranges_group_contiguous_seconds():
    assert contiguous_ranges([0, 1, 2, 5], 10.0) == [(0.0, 0.3), (0.5, 0.6)]
    assert contiguous_ranges([], 10.0) == []


def test_union_and_expand_helpers():
    assert union_boxes([None, None]) is None
    assert union_boxes([(10, 10, 20, 20), (30, 30, 40, 40)]) == (10, 10, 40, 40)
    assert expand_box((10, 10, 20, 20), 0.5, 100, 100) == (5, 5, 25, 25)
    assert expand_box((0, 0, 10, 10), 1.0, 100, 100) == (0, 0, 20, 20)


def test_load_config_rejects_missing_key(tmp_path):
    bad = {"mask": {"min_landmarks": 4}}
    path = tmp_path / "config.default.json"
    path.write_text(json.dumps(bad))
    with pytest.raises(MaskError):
        load_config(path)
    with pytest.raises(MaskError):
        load_config(tmp_path / "absent.json")


def test_fresh_id_is_hex_and_unique(tmp_path):
    first = fresh_id(tmp_path)
    assert re.fullmatch(r"[0-9a-f]{16}", first)
    assert fresh_id(tmp_path) != first


def test_end_to_end_clip_with_real_encode(tmp_path):
    src_dir = tmp_path / "in"
    src_dir.mkdir()
    source = src_dir / "family-party.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (100, 100))
    assert writer.isOpened()
    for _ in range(4):
        writer.write(white())
    writer.release()

    landmarks = []
    for i in range(33):
        landmarks.append(SimpleNamespace(x=0.0, y=0.0, visibility=0.0))
    for n, (x, y) in enumerate(HEAD_PTS):
        landmarks[n] = SimpleNamespace(x=x / 100.0, y=y / 100.0, visibility=0.9)
    fake_pose = SimpleNamespace(
        detect_for_video=lambda image, ts: SimpleNamespace(pose_landmarks=[landmarks])
    )
    fake_face = SimpleNamespace(detect_for_video=lambda image, ts: SimpleNamespace(detections=[]))

    cfg = make_cfg()
    masked_dir = tmp_path / "masked"
    clip_id, outcome, fps = mask_clip(source, masked_dir, cfg, fake_pose, fake_face, dry_run=False)

    assert re.fullmatch(r"[0-9a-f]{16}", clip_id)
    assert "family-party" not in clip_id
    assert outcome.counts["pose"] == 4
    encoded = (masked_dir / f"{clip_id}.mp4").read_bytes()
    assert len(encoded) > 0
    assert b"soun" not in encoded
    cap = cv2.VideoCapture(str(masked_dir / f"{clip_id}.mp4"))
    frames = 0
    while True:
        ok, _ = cap.read()
        if not ok:
            break
        frames += 1
    cap.release()
    assert frames == 4

    append_index(masked_dir, clip_id, source.name)
    assert {p.name for p in masked_dir.iterdir()} == {f"{clip_id}.mp4", "_index.csv"}
    index_text = (masked_dir / "_index.csv").read_text()
    assert clip_id in index_text and "family-party.mp4" in index_text


def test_dry_run_writes_nothing(tmp_path):
    source = tmp_path / "clip.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (100, 100))
    writer.write(white())
    writer.release()
    fake = SimpleNamespace(detect_for_video=lambda image, ts: SimpleNamespace(pose_landmarks=None))
    empty_face = SimpleNamespace(detect_for_video=lambda image, ts: SimpleNamespace(detections=[]))
    masked_dir = tmp_path / "masked"
    clip_id, outcome, _ = mask_clip(source, masked_dir, make_cfg(), fake, empty_face, dry_run=True)
    assert clip_id is None
    assert outcome.counts["full"] == 1
    assert not masked_dir.exists()


def test_no_network_imports_in_scripts():
    banned = {
        "requests", "urllib", "urllib2", "urllib3", "http", "socket",
        "ftplib", "smtplib", "telnetlib", "ssl", "httplib",
    }
    scripts_dir = Path(__file__).resolve().parent
    found = sorted(scripts_dir.glob("*.py"))
    assert found, "expected python files beside this test"
    pattern = re.compile(r"^\s*(import|from)\s+([A-Za-z0-9_\.]+)")
    for path in found:
        for line in path.read_text().splitlines():
            match = pattern.match(line)
            if match:
                root = match.group(2).split(".")[0]
                assert root not in banned, f"{path.name} imports banned module {root}"
