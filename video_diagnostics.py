import cv2
import pandas as pd
import numpy as np
import os

def visualize_telemetry(video_path, csv_path):
    if not os.path.exists(csv_path) or not os.path.exists(video_path):
        print("Error: Check your file paths!")
        return

    df = pd.read_csv(csv_path)
    df['t'] = df['t'].astype(float)
    
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0: fps = 30 # Fallback for certain video types

    paused = False
    current_time = 0.0

    print("Controls:")
    print("  [Space] - Pause / Resume")
    print("  [A]     - Rewind 2s")
    print("  [D]     - Fast-Forward 2s")
    print("  [R]     - Reset to Start")
    print("  [Q]     - Quit")

    while cap.isOpened():
        key = cv2.waitKey(int(1000/fps)) & 0xFF
        
        # --- INPUT HANDLING ---
        if key == ord('q'):
            break
        elif key == ord(' '):
            paused = not paused
        elif key == ord('r') or key == ord('R'):
            current_time = 0.0
            cap.set(cv2.CAP_PROP_POS_MSEC, 0)
        elif key == ord('d') or key == ord('D'):
            current_time += 2.0
        elif key == ord('a') or key == ord('A'):
            current_time -= 2.0

        # --- VIDEO/TIME MANAGEMENT ---
        if not paused:
            # Advance the video by one frame step
            ret, frame = cap.read()
            if not ret:
                # Loop back to start if end reached
                cap.set(cv2.CAP_PROP_POS_MSEC, 0)
                ret, frame = cap.read()
                current_time = 0.0
            else:
                # Update our tracking time based on the actual video position
                current_time = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        else:
            # While paused, we grab the current frame without advancing the video head
            ret, frame = cap.read()
            # Since we didn't advance, we must move the "playhead" back 
            # so the next 'read' gets the same frame again.
            cap.set(cv2.CAP_PROP_POS_MSEC, current_time * 1000)

        if not ret: continue

        # --- DATA SYNCING ---
        # Find the row in CSV that matches our current timestamp
        idx = df[df['t'] <= current_time].index
        row = df.iloc[idx[-1]] if len(idx) > 0 else df.iloc[0]

        # --- RENDERING ---
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (450, int(frame.shape[0])), (0, 0, 0), -1)
        frame = cv2.addWeighted(overlay, 0.4, frame, 0.6, 0)

        status_color = (0, 255, 0) if row['ok'] == 1 else (0, 0, 255)
        reason_text = str(row['reasons']) if pd.notna(row['reasons']) else "None"
        if row['ok'] == 0:
            reason_text = f"REASON: {reason_text}"

        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(frame, f"TIME: {current_time:.2f}s {'[PAUSED]' if paused else ''}", (10, 30), font, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, f"STATUS: {'OK' if row['ok'] == 1 else 'GATED'}", (10, 60), font, 0.7, status_color, 2)
        cv2.putText(frame, f"Angle: {row['angle2d_smooth']:.1f}°", (10, 90), font, 0.6, (255, 255, 255), 1)
        cv2.putText(frame, f"{reason_text}", (10, 120), font, 0.5, (255, 255, 255), 1)

        cv2.imshow('Second Opinion - Advanced Diagnostic', frame)

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    visualize_telemetry("clip.mp4", "clip.csv")
