import { CalibrationStep } from '../components/CalibrationStep';
import { FaceReachStep } from '../components/FaceReachStep';
import { MockTransport } from '../components/MockTransport';

/** Participant route. Consent and remaining camera checks arrive in slice 6; no dashboards here. */
export function SetupPage() {
  return (
    <div>
      <h1>Setup</h1>
      <p>
        Welcome. When sessions begin, the task will be <strong>wash your face with the face towel</strong>,
        guided at your own pace. You can pause or stop at any time — no explanation needed.
      </p>
      <CalibrationStep />
      <FaceReachStep />
      <MockTransport />
      <p>
        Remaining camera setup checks (camera found, framing, lighting, measured fps) and consent
        choices arrive in slice 6. This slice makes no cloud calls.
      </p>
    </div>
  );
}
