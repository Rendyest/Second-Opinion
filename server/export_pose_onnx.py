"""One-time export of the sidecar pose model to ONNX.

CURRENTLY BLOCKED, KEPT FOR REFERENCE. Version pincer, verified Nov 2026:
torch >= 2.5 defaults to the dynamo exporter, which cannot trace the
data-dependent RPN guard (find_top_rpn_proposals); torch <= 2.4 keeps the
legacy tracer but its graph optimizer chokes on the heatmap reshape in
heatmaps_to_keypoints (aten::index, unknown rank; that torch predates the
onnx_shape_inference flag). Superseded by the RPN proposal caps in
server/pose_sidecar.py, which need no export at all.

If retried one day, the traced model takes a FIXED 3x252x448 BGR float32
tensor (the exact size the sidecar feeds it) and returns raw detection
tensors decoded with the same TracingAdapter schema the sidecar uses.

Run once on any machine with torch + detectron2 (CPU is fine):

    pip install onnx
    python3 server/export_pose_onnx.py --sample /tmp/any-person-photo.jpg

--sample should be any real photo (a person is ideal); tracing records
shapes, and real content traces far more reliably than noise. The script
never downloads weights: place the checkpoint first (see server/pose_sidecar.py).
"""

import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = REPO_ROOT / "models" / "detectron2_keypoint_rcnn_R_50_FPN_3x.pkl"
DEFAULT_OUT = REPO_ROOT / "models" / "pose_keypoint_rcnn.onnx"

# Must match TRACE_W/TRACE_H in server/pose_sidecar.py.
TRACE_W, TRACE_H = 448, 252


def main() -> int:
    ap = argparse.ArgumentParser(description="Export pose model to ONNX.")
    ap.add_argument("--sample", default=None, help="any real photo (person ideal)")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    args = ap.parse_args()

    import cv2
    import numpy as np
    import torch
    from detectron2 import model_zoo
    from detectron2.checkpoint import DetectionCheckpointer
    from detectron2.config import get_cfg
    from detectron2.export import STABLE_ONNX_OPSET_VERSION, TracingAdapter
    from detectron2.modeling import GeneralizedRCNN, build_model

    weights = Path(args.weights)
    if not weights.is_file():
        print(f"error: weights missing: {weights}", flush=True)
        return 2

    cfg = get_cfg()
    cfg.merge_from_file(model_zoo.get_config_file("COCO-Keypoints/keypoint_rcnn_R_50_FPN_3x.yaml"))
    cfg.MODEL.WEIGHTS = str(weights)
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.5
    cfg.MODEL.DEVICE = "cpu"
    cfg.freeze()

    torch_model = build_model(cfg)
    DetectionCheckpointer(torch_model).resume_or_load(cfg.MODEL.WEIGHTS)
    torch_model.eval()

    if args.sample:
        img = cv2.imread(args.sample)
        if img is None:
            print(f"error: cannot read sample {args.sample}", flush=True)
            return 2
    else:
        print("warning: no --sample given; tracing on synthetic content is less reliable", flush=True)
        img = (np.random.rand(TRACE_H, TRACE_W, 3) * 255).astype(np.uint8)
    img = cv2.resize(img, (TRACE_W, TRACE_H)).astype("float32").transpose(2, 0, 1)
    sample = torch.as_tensor(img)

    def inference(model, inputs):
        inst = model.inference(inputs, do_postprocess=False)[0]
        return [{"instances": inst}]

    assert isinstance(torch_model, GeneralizedRCNN)
    adapter = TracingAdapter(torch_model, [{"image": sample}], inference)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        # Legacy TorchScript exporter: the only path that traces
        # data-dependent RPN code (find_top_rpn_proposals). torch >= 2.5
        # needs dynamo=False; older torch is legacy by default.
        export_kwargs = dict(
            opset_version=STABLE_ONNX_OPSET_VERSION, input_names=["image"],
            # Suggested by the exporter itself: resolves the unknown-rank
            # reshape in heatmaps_to_keypoints during graph optimization.
            onnx_shape_inference=True,
        )
        try:
            torch.onnx.export(adapter, (sample,), f, dynamo=False, **export_kwargs)
        except TypeError:
            export_kwargs.pop("dynamo", None)
            torch.onnx.export(adapter, (sample,), f, **export_kwargs)
    print(f"wrote {out_path} ({out_path.stat().st_size // 1024} KiB)", flush=True)
    print(f"inputs schema: {adapter.inputs_schema}", flush=True)
    print(f"outputs schema: {adapter.outputs_schema}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
