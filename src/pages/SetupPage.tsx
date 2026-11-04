import { CalibrationStep } from '../components/CalibrationStep';
import { FaceReachStep } from '../components/FaceReachStep';
import { ConsentForm } from '../components/ConsentForm';
import { DeleteMyClips } from '../components/DeleteMyClips';
import { SetupChecks } from '../components/SetupChecks';
import { MockTransport } from '../components/MockTransport';
import { useConsent } from '../consent/consent';

/** Participant route. Consent, then the checks camera, then the arm and face steps. No dashboards here. */
export function SetupPage() {
  const { consent, set: setConsent } = useConsent();
  return (
    <div>
      <h1>Setup</h1>
      <p>
        Welcome. When sessions begin, the task will be <strong>wash your face with the face towel</strong>,
        guided at your own pace. You can pause or stop at any time — no explanation needed.
      </p>
      <p>
        Work down this page in order. First press Turn on camera for setup checks, then do the
        arm and face steps below. Each step turns on its own camera picture when you press its
        button, and a picture goes dark again when its step finishes; the pass or fail line is
        the result.
      </p>
      <ConsentForm consent={consent} onChange={setConsent} />
      <div className="setup-layout">
        <aside className="setup-side" aria-label="Setup camera and checks">
          <SetupChecks />
        </aside>
        <div className="setup-main">
          <CalibrationStep />
          <FaceReachStep />
          <p>
            When the arm and face steps are done, press <a href="#setup-checks">Start session</a> in
            the setup checks to begin.
          </p>
          <DeleteMyClips />
          <MockTransport />
          <p>This page makes no cloud calls.</p>
        </div>
      </div>
    </div>
  );
}
