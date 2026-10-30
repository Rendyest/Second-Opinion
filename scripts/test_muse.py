
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# Load .env from the repository root
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

api_key = os.getenv("MODEL_API_KEY")

if not api_key:
    raise ValueError("MODEL_API_KEY not found in .env")

# Connect to Meta Model API
client = OpenAI(
    api_key=api_key,
    base_url="https://api.meta.ai/v1",
)

print("Connecting to Muse Spark...")

try:
    
    response = client.responses.create(
    model="muse-spark-1.3",
    input=(
        "List three observable signs that someone "
        "is struggling with a face-washing movement. "
        "Keep your answer brief."
    ),
    reasoning={"effort": "low"},
    max_output_tokens=1000,
)


    print("\nMuse Spark response:")
    print(response.output_text)

    print("\n--- FULL API RESPONSE ---")
    print(response.model_dump_json(indent=2))

except Exception as error:
    print(f"\nAPI request failed: {type(error).__name__}")
    print(str(error))
