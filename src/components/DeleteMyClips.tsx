import { useRef, useState } from 'react';
import { clearCalibration, useCalibration } from '../pose/calibration';
import { clearAllBuffers } from '../recording/clipBuffer';
import {
  DELETE_CLIPS_CONFIRM,
  DELETE_CLIPS_DONE,
  DELETE_CLIPS_LABEL,
} from '../consentCopy';

/**
 * "Delete my clips": clears in-memory clips and recording buffers plus the
 * stored calibration and face data. Consent choices stay. Confirms first
 * with a native dialog; the result line has no digits.
 */
export function DeleteMyClips() {
  const { refresh } = useCalibration();
  const [done, setDeleted] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const confirmDelete = () => {
    clearAllBuffers();
    clearCalibration();
    refresh();
    setDeleted(true);
    dialogRef.current?.close();
  };

  return (
    <section aria-label={DELETE_CLIPS_LABEL}>
      <button type="button" onClick={() => dialogRef.current?.showModal()}>
        {DELETE_CLIPS_LABEL}
      </button>
      <dialog ref={dialogRef} aria-label={DELETE_CLIPS_LABEL}>
        <p>{DELETE_CLIPS_CONFIRM}</p>
        <div className="button-row">
          <button type="button" onClick={confirmDelete}>
            {DELETE_CLIPS_LABEL}
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Keep my recordings
          </button>
        </div>
      </dialog>
      {done && <p role="status">{DELETE_CLIPS_DONE}</p>}
    </section>
  );
}
