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
    <div className="page setup-page">
      <header className="page-heading setup-heading">
        <h1>Set up your session</h1>
        <p>Get your camera ready before practicing washing your face with a towel. You can pause or finish whenever you need to.</p>
        <ol className="setup-steps" aria-label="Setup steps">
          <li><a href="#setup-privacy">Privacy choices</a></li>
          <li><a href="#setup-camera">Camera and readiness</a></li>
          <li><a href="#setup-calibration">Calibration</a></li>
        </ol>
      </header>
      <div className="setup-grid">
        <section className="panel setup-privacy" id="setup-privacy" aria-label="Privacy choices">
          <ConsentForm consent={consent} onChange={setConsent} />
          <DeleteMyClips />
          <p className="muted">Camera processing stays on this device. Setup makes no cloud calls.</p>
        </section>
        <div className="setup-workspace">
          <section className="panel" id="setup-camera" aria-label="Camera and readiness">
            <h2>Camera and readiness</h2>
            <p className="muted">Sit facing the camera with your face, shoulders, and right arm in view.</p>
            <SetupChecks />
          </section>
          <div className="calibration-grid" id="setup-calibration">
            <CalibrationStep />
            <FaceReachStep />
          </div>
        </div>
      </div>
      <details className="disclosure">
        <summary>Simulated replay tools</summary>
        <MockTransport />
      </details>
    </div>
  );
}
