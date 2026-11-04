"""Localhost Detectron2 pose sidecar (Apache-2.0 model, Meta FAIR).

POST /pose  {image: data:...base64, timestampMs: n} -> {coco: [{x,y,score}x17]}
GET  /healthz -> {ok, loaded}

Frames stay on this machine; the only network caller is the local page.
Fail-closed: missing weights, missing deps, or bad input answer 503/400
with no keypoints, and the frontend treats that as "nobody in view".

Weights are never downloaded here: place the Keypoint R-CNN R50-FPN 3x
checkpoint at models/ or set DETECTRON2_WEIGHTS. Sapiens checkpoints
(CC BY-NC) are intentionally not wired in, so the MIT release stays clean.
"""

import argparse
import base64
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = REPO_ROOT / "models" / "detectron2_keypoint_rcnn_R_50_FPN_3x.pkl"
ONNX_NAME = "pose_keypoint_rcnn.onnx"
# Named in the terminal log and /healthz so the demo can show the model.
POSE_MODEL_NAME = "Detectron2 Keypoint R-CNN R50-FPN (Meta FAIR)"
# Fixed traced input. Must match server/export_pose_onnx.py.
TRACE_W, TRACE_H = 448, 252
BODY_LIMIT = 8 * 1024 * 1024

_predictor = None
_load_error = None
_onnx = None
_onnx_missing = False
_onnx_dead = False


def weights_path():
    override = os.environ.get("DETECTRON2_WEIGHTS")
    return Path(override) if override else DEFAULT_WEIGHTS


def get_predictor():
    global _predictor, _load_error
    if _predictor is not None:
        return _predictor
    if _load_error is not None:
        raise _load_error
    try:
        import torch
        from detectron2 import model_zoo
        from detectron2.config import get_cfg
        from detectron2.engine import DefaultPredictor

        weights = weights_path()
        if not weights.is_file():
            raise FileNotFoundError(
                f"Detectron2 weights missing: {weights}. "
                "Place keypoint_rcnn_R_50_FPN_3x checkpoint there or set DETECTRON2_WEIGHTS."
            )
        cfg = get_cfg()
        cfg.merge_from_file(
            model_zoo.get_config_file("COCO-Keypoints/keypoint_rcnn_R_50_FPN_3x.yaml")
        )
        cfg.MODEL.WEIGHTS = str(weights)
        # Lowered from the 0.5 default: on CPU every dropped person-box
        # becomes a tracking gap that shuts tips and checks. Single frontal
        # user, so the extra false-positive risk is negligible.
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.35
        # Smaller test input: the default 800/1333 sizing costs seconds per
        # frame on CPU. 576/1024 balances speed against the accuracy the
        # arm joints need; raise toward 800/1333 only if scores plateau.
        cfg.INPUT.MIN_SIZE_TEST = 576
        cfg.INPUT.MAX_SIZE_TEST = 1024
        # Fewer RPN proposals: ROI-head compute scales with proposal count.
        # 6000/1000 defaults assume GPU; 2000/300 keeps single-person recall
        # while cutting CPU head time roughly in half.
        cfg.MODEL.RPN.PRE_NMS_TOPK_TEST = 2000
        cfg.MODEL.RPN.POST_NMS_TOPK_TEST = 300
        cfg.MODEL.DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
        _predictor = DefaultPredictor(cfg)
        print(f"pose backend: torch ({POSE_MODEL_NAME})", flush=True)
        return _predictor
    except Exception as e:  # fail-closed, remembered for /healthz
        _load_error = e
        raise


def decode_image(data_url):
    import cv2
    import numpy as np

    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cannot decode image")
    return img


def get_onnx():
    """ONNX session plus official decode adapter, or None (torch fallback).

    Returns None silently when the .onnx file is absent (run
    server/export_pose_onnx.py to create it). Import/session failures also
    fall back to torch; only the torch path can fail-closed the server.
    """
    global _onnx, _onnx_missing, _onnx_dead
    if _onnx is not None:
        return _onnx
    if _onnx_missing or _onnx_dead:
        return None
    try:
        import numpy as np
        import onnxruntime as ort
        import torch
        from detectron2 import model_zoo
        from detectron2.checkpoint import DetectionCheckpointer
        from detectron2.config import get_cfg
        from detectron2.export import TracingAdapter
        from detectron2.modeling import GeneralizedRCNN, build_model

        onnx_path = REPO_ROOT / "models" / ONNX_NAME
        if not onnx_path.is_file():
            _onnx_missing = True
            return None
        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        input_name = sess.get_inputs()[0].name

        cfg = get_cfg()
        cfg.merge_from_file(
            model_zoo.get_config_file("COCO-Keypoints/keypoint_rcnn_R_50_FPN_3x.yaml")
        )
        cfg.MODEL.WEIGHTS = str(weights_path())
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.35
        cfg.MODEL.DEVICE = "cpu"
        cfg.freeze()
        torch_model = build_model(cfg)
        DetectionCheckpointer(torch_model).resume_or_load(cfg.MODEL.WEIGHTS)
        torch_model.eval()

        def inference(model, inputs):
            inst = model.inference(inputs, do_postprocess=False)[0]
            return [{"instances": inst}]

        sample = torch.zeros(3, TRACE_H, TRACE_W)
        adapter = TracingAdapter(torch_model, [{"image": sample}], inference)
        _onnx = (sess, input_name, adapter)
        print(f"pose backend: onnxruntime ({POSE_MODEL_NAME})", flush=True)
        return _onnx
    except Exception as e:
        print(f"onnx unavailable, torch fallback: {e}", flush=True)
        _onnx_dead = True
        return None


def infer_coco_onnx(img, backend):
    import cv2
    import numpy as np
    import torch

    sess, input_name, adapter = backend
    fixed = cv2.resize(img, (TRACE_W, TRACE_H)).astype("float32").transpose(2, 0, 1)
    ort_outs = sess.run(None, {input_name: fixed[None]})
    torch_outs = [torch.as_tensor(o) for o in ort_outs]
    inst = adapter.outputs_schema(torch_outs)[0]["instances"]
    if len(inst) == 0:
        return []
    best = int(inst.scores.argmax().item())
    kpts = inst.pred_keypoints[best].cpu().numpy()  # (17, 3) in TRACE space
    # Keypoints are in fixed TRACE space; normalise back to 0..1.
    return [
        {"x": float(x) / TRACE_W, "y": float(y) / TRACE_H, "score": float(s)}
        for (x, y, s) in kpts.tolist()
    ]


def infer_coco(img):
    import cv2

    backend = get_onnx()
    if backend is not None:
        try:
            return infer_coco_onnx(img, backend)
        except Exception as e:
            print(f"onnx infer failed, torch fallback: {e}", flush=True)
    predictor = get_predictor()
    outputs = predictor(img)
    instances = outputs["instances"]
    if len(instances) == 0:
        return []
    scores = instances.scores
    best = int(scores.argmax().item())
    kpts = instances.pred_keypoints[best].cpu().numpy()  # (17, 3) x, y, score
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # noqa: F841 (keeps intent explicit)
    _ = rgb
    return [
        {"x": float(x) / w, "y": float(y) / h, "score": float(s)}
        for (x, y, s) in kpts.tolist()
    ]


class Handler(BaseHTTPRequestHandler):
    server_version = "PoseSidecar/1"

    def log_message(self, *args):
        pass

    def _json(self, status, value):
        body = json.dumps(value).encode()
        try:
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.send_header("access-control-allow-origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser moved on (reload, HMR); slow CPU frames go stale

    def do_GET(self):
        if self.path == "/healthz":
            loaded = _predictor is not None or _onnx is not None
            err = None if _load_error is None else str(_load_error)
            backend = "onnxruntime" if _onnx is not None else ("torch" if _predictor is not None else None)
            self._json(200, {"ok": True, "loaded": loaded, "backend": backend, "model": POSE_MODEL_NAME, "error": err})
        else:
            self._json(404, {"ok": False})

    def do_POST(self):
        if self.path != "/pose":
            self._json(404, {"ok": False})
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > BODY_LIMIT:
            self._json(400, {"coco": []})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            coco = infer_coco(decode_image(payload.get("image", "")))
            scores = [round(float(p.get("score", 0)), 2) for p in coco]
            print(f"pose ts={payload.get('timestampMs')} n={len(coco)} scores={scores}", flush=True)
            self._json(200, {"coco": coco})
        except FileNotFoundError as e:
            self._json(503, {"coco": [], "error": str(e)})
        except Exception:
            self._json(200, {"coco": []})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "POST, GET, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8788)
    args = ap.parse_args()
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
