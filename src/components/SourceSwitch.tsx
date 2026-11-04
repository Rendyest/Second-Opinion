export type PictureSource = 'mock' | 'live';

interface SourceSwitchProps {
  value: PictureSource;
  onChange: (next: PictureSource) => void;
}

/** Mock/live switch. Real radio inputs: keyboard-operable with no extra code. */
export function SourceSwitch({ value, onChange }: SourceSwitchProps) {
  return (
    <fieldset className="picture-source-switch">
      <legend>Picture source</legend>
      <label>
        <input
          type="radio"
          name="picture-source"
          value="mock"
          checked={value === 'mock'}
          onChange={() => onChange('mock')}
        />{' '}
        Mock replay
      </label>
      <label>
        <input
          type="radio"
          name="picture-source"
          value="live"
          checked={value === 'live'}
          onChange={() => onChange('live')}
        />{' '}
        <strong>Select for Live camera</strong>
      </label>
    </fieldset>
  );
}
