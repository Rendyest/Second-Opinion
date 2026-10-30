
import os
import json
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

client = OpenAI(
    api_key=os.environ["MODEL_API_KEY"],
    base_url="https://api.meta.ai/v1",
)

LABEL_DIR = ROOT / "data" / "labels"
LABEL_DIR.mkdir(parents=True, exist_ok=True)


def label_movement(movement):
    """Generate a preliminary struggle label."""

    prompt = f"""
You are labeling rehabilitation movement observations
for the Mirra Call research prototype.

Movement data:
{json.dumps(movement, indent=2)}

Classify whether the observations show signs of
difficulty performing the movement.

Rules:
- Use only the supplied observations.
- Do not infer pain, diagnoses, or emotions.
- If evidence is insufficient, mark uncertain.
- Return only valid JSON.

Required fields:
- struggling: true, false, or null
- signal: stall, compensation, jitter, none, or uncertain
- reason: short explanation based on observations
- needs_review: true or false
"""

    response = client.responses.create(
        model="muse-spark-1.3",
        input=prompt,
        reasoning={"effort": "low"},
        max_output_tokens=1200,
    )

    if response.status != "completed":
        raise RuntimeError(
            f"Incomplete response: {response.incomplete_details}"
        )

    result = json.loads(response.output_text.strip())

    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object")

    required = {"struggling", "signal", "reason", "needs_review"}

    if not required.issubset(result):
        raise ValueError("Missing required labeling fields")

    if result["struggling"] is not None and not isinstance(
        result["struggling"], bool
    ):
        raise ValueError("Invalid struggling label")

    if result["signal"] not in {
        "stall", "compensation", "jitter", "none", "uncertain"
    }:
        raise ValueError("Invalid signal")

    if not isinstance(result["reason"], str):
        raise ValueError("Invalid reason")

    if not isinstance(result["needs_review"], bool):
        raise ValueError("Invalid needs_review value")

    return result


if __name__ == "__main__":

    # Synthetic example for testing only
    sample = {
        "clip_id": "synthetic_001",
        "task": "face_washing",
        "elbow_angles": [160, 140, 110, 110, 110, 112],
        "shoulder_angles": [15, 20, 30, 45, 48, 50],
        "trunk_lean_angles": [2, 3, 5, 12, 18, 20],
        "sampling_interval_seconds": 0.5,
    }

    print("Sending sample movement to Muse Spark...")

    label = label_movement(sample)

    output = {
        "clip_id": sample["clip_id"],
        "source": "synthetic_test",
        "model": "muse-spark-1.3",
        **label,
    }

    output_file = LABEL_DIR / "synthetic_001.json"

    output_file.write_text(
        json.dumps(output, indent=2),
        encoding="utf-8",
    )

    print("\nGenerated label:")
    print(json.dumps(output, indent=2))

    print(f"\nSaved to: {output_file}")
