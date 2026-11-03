import { CalibrationStep } from '../components/CalibrationStep';
import { FaceReachStep } from '../components/FaceReachStep';
import { ConsentForm } from '../components/ConsentForm';
import { DeleteMyClips } from '../components/DeleteMyClips';
import { SetupChecks } from '../components/SetupChecks';
import { MockTransport } from '../components/MockTransport';
import { useConsent } from '../consent/consent';

/** Participant route. Consent choices first, then the arm and face steps. No dashboards here. */
export function SetupPage() {
  const { consent, set: setConsent } = useConsent();
  return (
    <div>
      <h1>Setup</h1>
      <p>
        Welcome. When sessions begin, the task will be <strong>wash your face with the face towel</strong>,
        guided at your own pace. You can pause or stop at any time — no explanation needed.
      </p>
      <ConsentForm consent={consent} onChange={setConsent} />
      <CalibrationStep />
      <FaceReachStep />
      <SetupChecks />
      <DeleteMyClips />
      <MockTransport />
      <p>This page makes no cloud calls.</p>
    </div>
  );
}
