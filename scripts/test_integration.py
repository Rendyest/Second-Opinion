
import json
from datetime import datetime, timezone
from pathlib import Path

from muse_coaching import generate_coaching

ROOT = Path(__file__).resolve().parent.parent
EVENT_DIR = ROOT / "data" / "coaching_events"


def process_struggle_event(flags, movement_data, gate_ok=True):
    """
    Simulate the handoff from System 1 to Muse Spark.

    Only request coaching when:
    - The measurement quality gate passes.
    - System 1 reports at least one struggle flag.
    """

    if not gate_ok:
        print("Skipping: movement measurements are unreliable.")
        return None

    if not flags:
        print("No struggle detected. Muse Spark not called.")
        return None

    # Package the detector's observations for Muse Spark.
    event = {
        "task": movement_data.get("task", "face_washing"),
        "struggle_flags": flags,
        "measurements": movement_data,
    }

    print("Struggle detected:", flags)
    print("Requesting coaching from Muse Spark...")

    coaching = generate_coaching(event)

    # Store the response alongside the triggering event.
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "simulated_integration_test",
        "system1_event": event,
        "muse_coaching": coaching,
    }

    EVENT_DIR.mkdir(parents=True, exist_ok=True)

    filename = (
        "coaching_"
        + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        + ".json"
    )

    output_path = EVENT_DIR / filename

    output_path.write_text(
        json.dumps(record, indent=2),
        encoding="utf-8",
    )

    print("Coaching event saved to:", output_path)

    return record


if __name__ == "__main__":

    sample_movement = {
        "task": "face_washing",
        "elbow_angle": 110,
        "hand_to_face": 1.8,
        "stall_duration_seconds": 2.0,
    }

    print("\nTEST 1: Normal movement")
    normal = process_struggle_event(
        flags=[],
        movement_data=sample_movement,
    )

    print("\nTEST 2: Unreliable measurements")
    unreliable = process_struggle_event(
        flags=["stall"],
        movement_data=sample_movement,
        gate_ok=False,
    )

    print("\nTEST 3: Detected struggle")
    struggle = process_struggle_event(
        flags=["stall"],
        movement_data=sample_movement,
        gate_ok=True,
    )

    if struggle:
        print("\nMuse Spark coaching response:")
        print(json.dumps(struggle["muse_coaching"], indent=2))

    print("\nIntegration test complete.")
