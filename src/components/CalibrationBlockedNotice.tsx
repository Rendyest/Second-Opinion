import type { CalibrationBlock } from '../setup/checks';
import {
  CALIBRATION_CHECKS_LEAD,
  CALIBRATION_CONSENT_STALE,
  CALIBRATION_NEEDS_CAMERA,
} from '../consentCopy';

/**
 * Why a calibration capture cannot start, as text (never colour-only).
 * Consent notice first, then the failing checks each with its name and fix.
 * Returns null when nothing blocks. The caller keeps the wrapping
 * aria-live="polite" region mounted so the notice is announced; this
 * component never moves focus.
 */
export function CalibrationBlockedNotice({ blocks }: { blocks: CalibrationBlock[] }) {
  if (blocks.length === 0) return null;
  const failing = blocks.flatMap((b) => (b.kind === 'checks' ? b.failing : []));
  return (
    <div>
      {blocks.some((b) => b.kind === 'consent') && <p>{CALIBRATION_NEEDS_CAMERA}</p>}
      {blocks.some((b) => b.kind === 'stale') && <p>{CALIBRATION_CONSENT_STALE}</p>}
      {failing.length > 0 && (
        <>
          <p>{CALIBRATION_CHECKS_LEAD}</p>
          <ul>
            {failing.map((f) => (
              <li key={f.id}>
                {f.label}: {f.fix ?? 'see the setup checks above.'}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
