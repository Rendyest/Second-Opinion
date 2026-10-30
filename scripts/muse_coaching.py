
import os
import json
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# Locate the project root and load API credentials
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

api_key = os.getenv("MODEL_API_KEY")

if not api_key:
    raise ValueError("MODEL_API_KEY not found in .env")

client = OpenAI(
    api_key=api_key,
    base_url="https://api.meta.ai/v1",
)


def validate_coaching(result):
    """Validate Muse Spark's coaching response."""

    required_fields = {
        "struggling": bool,
        "signal": str,
        "body_part": str,
        "severity": str,
        "cue_text": str,
        "ask_pain_check": bool,
        "safety_concern": bool,
    }

    if not isinstance(result, dict):
        raise ValueError("Coaching response must be a JSON object")

    for field, expected_type in required_fields.items():
        if field not in result:
            raise ValueError(f"Missing required field: {field}")

        if not isinstance(result[field], expected_type):
            raise ValueError(f"Invalid type for field: {field}")

    allowed_severities = {"none", "mild", "moderate", "high"}

    if result["severity"] not in allowed_severities:
        raise ValueError("Invalid severity value")

    if not result["cue_text"].strip():
        raise ValueError("Coaching cue cannot be empty")

    if len(result["cue_text"]) > 200:
        raise ValueError("Coaching cue is too long")

    return result


def generate_coaching(movement_data):
    """
    Generate rehabilitation coaching using Muse Spark.

    Input:
        Movement measurements and struggle signals.

    Output:
        A dictionary containing coaching instructions
        and safety indicators.
    """

    prompt = f"""
You are the AI coaching component of Mirra Call,
an assistive rehabilitation system.

A person is performing a face-washing movement.

Movement observations:
{json.dumps(movement_data, indent=2)}

Your task:
1. Identify the observable movement difficulty.
2. Generate one short, supportive coaching cue.
3. Flag whether a pain check may be appropriate.
4. Flag any potential safety concern.

Important rules:
- Do not diagnose medical conditions.
- Do not claim the person is experiencing pain.
- Do not encourage pushing through pain.
- Do not recommend increasing movement intensity.
- Base your response only on the observations.
- If observations are insufficient, say so.
- Return valid JSON only, without markdown.

Use exactly this JSON structure:

{{
    "struggling": true,
    "signal": "timing",
    "body_part": "arm",
    "severity": "mild",
    "cue_text": "Try moving slowly and comfortably.",
    "ask_pain_check": false,
    "safety_concern": false
}}
"""

    response = client.responses.create(
        model="muse-spark-1.3",
        input=prompt,
        reasoning={"effort": "low"},
        max_output_tokens=1200,
    )

    if response.status != "completed":
        raise RuntimeError(
            f"Muse Spark response incomplete: "
            f"{response.incomplete_details}"
        )

    raw_output = response.output_text.strip()

    try:
        result = json.loads(raw_output)
        return validate_coaching(result)


    except json.JSONDecodeError as error:
        raise ValueError(
            f"Muse Spark returned invalid JSON: {raw_output}"
        ) from error


if __name__ == "__main__":

    # Example movement data for testing.
    # These are simulated measurements, not patient data.
    sample_movement = {
        "task": "face_washing",
        "elbow_angle": 70,
        "shoulder_elevation": 45,
        "struggle_signal": "stall",
        "stall_duration_seconds": 3
    }

    print("Sending movement data to Muse Spark...")

    try:
        result = generate_coaching(sample_movement)

        print("\nMuse Spark coaching response:")
        print(json.dumps(result, indent=2))

    except Exception as error:
        print(
            f"\nError: {type(error).__name__}: {error}"
        )
