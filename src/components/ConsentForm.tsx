import { useState } from 'react';
import { canRecord, storageWorks } from '../consent/consent';
import type { ConsentKey, ConsentState } from '../consent/consent';
import {
  CONSENT_CAMERA_LABEL,
  CONSENT_CAMERA_TEXT,
  CONSENT_CLIPS_LABEL,
  CONSENT_CLIPS_TEXT,
  CONSENT_DEMO_NOTE,
  CONSENT_MASKING_NOTE,
  CONSENT_RECORDING_LABEL,
  CONSENT_RECORDING_TEXT,
  CONSENT_SUMMARY_LABEL,
  CONSENT_SUMMARY_TEXT,
  CONSENT_TITLE,
} from '../consentCopy';

interface Props {
  consent: ConsentState;
  onChange: (key: ConsentKey, value: boolean) => void;
}

const ROWS: Array<{ key: ConsentKey; label: string; text: string }> = [
  { key: 'camera', label: CONSENT_CAMERA_LABEL, text: CONSENT_CAMERA_TEXT },
  { key: 'recording', label: CONSENT_RECORDING_LABEL, text: CONSENT_RECORDING_TEXT },
  { key: 'cloud_summary', label: CONSENT_SUMMARY_LABEL, text: CONSENT_SUMMARY_TEXT },
  { key: 'cloud_clips', label: CONSENT_CLIPS_LABEL, text: CONSENT_CLIPS_TEXT },
];

/**
 * The four consent boxes, shared by /setup (choosing) and /session
 * (withdrawing mid-session). Box 4 needs box 2; unticking box 2 unticks
 * box 4 in the consent module itself.
 */
export function ConsentForm({ consent, onChange }: Props) {
  const recordingOn = canRecord(consent);
  return (
    <section aria-label={CONSENT_TITLE}>
      <h2>{CONSENT_TITLE}</h2>
      {ROWS.map(({ key, label, text }) => {
        const needsRecording = key === 'cloud_clips' && !recordingOn;
        return (
          <div key={key}>
            <label>
              <input
                type="checkbox"
                checked={consent[key]}
                disabled={needsRecording}
                onChange={(e) => onChange(key, e.target.checked)}
              />
              {label}
            </label>
            <p>{text}</p>
          </div>
        );
      })}
      <p>{CONSENT_MASKING_NOTE}</p>
      <p>{CONSENT_DEMO_NOTE}</p>
    </section>
  );
}
