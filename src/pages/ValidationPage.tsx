import {
  parseValidationResults,
  type ValidationElbowRow,
  type ValidationResults,
  type ValidationShoulderRow,
} from '../validation/schema';
import {
  VALIDATION_ELBOW_HEADING,
  VALIDATION_ELBOW_NOTE,
  VALIDATION_GATE_HEADING,
  VALIDATION_NO_RESULTS,
  VALIDATION_NOTE_BIAS,
  VALIDATION_NOTE_GATE,
  VALIDATION_NOTE_HOLD,
  VALIDATION_NOTE_POSING,
  VALIDATION_REFERENCE_LABEL,
  VALIDATION_SET_HEADING,
  VALIDATION_SHOULDER_HEADING,
  VALIDATION_SIDE_NOTE,
  VALIDATION_SMALL_SET,
  VALIDATION_TESTED_LEAD,
  VALIDATION_TESTED_REST,
  VALIDATION_TITLE,
  VALIDATION_TUNED_LABEL,
  VALIDATION_VERIFIED_LABEL,
  VALIDATION_RIGHT_ARM_ONLY,
} from '../validation/copy';

/**
 * Build-time results only. results/results.json (repo root, gitignored) is
 * inlined by the bundler; a missing file matches nothing, so the page shows
 * "No results yet" instead of failing the build. No fetch, no live
 * computation, no mock data.
 */
const resultModules = import.meta.glob('../../results/results.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function loadResults(): ValidationResults | null {
  const raw = Object.values(resultModules)[0] as string | undefined;
  return parseValidationResults(raw);
}

/** Every figure carries its n; n = 0 (null) shows "n/a", never 0 or NaN. */
function fmtMae(v: number | null, n: number): string {
  return v === null ? 'n/a' : `${v.toFixed(1)}° (n=${n})`;
}

function fmtBias(v: number | null, n: number): string {
  if (v === null) return 'n/a';
  const signed = v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  return `${signed}° (n=${n})`;
}

function ShoulderTable({ rows, note }: { rows: ValidationShoulderRow[]; note: string | null }) {
  const sorted = [...rows].sort((a, b) => a.target_deg - b.target_deg);
  return (
    <div>
      {note && <p>{note}</p>}
      <table>
        <thead>
          <tr>
            <th scope="col">Target angle</th>
            <th scope="col">Gated-OK MAE</th>
            <th scope="col">Gated-OK bias</th>
            <th scope="col">All frames MAE</th>
            <th scope="col">All frames bias</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.view}@${row.target_deg}`}>
              <th scope="row">{row.target_deg}°</th>
              <td>{fmtMae(row.mae_deg_gated_ok, row.n_gated_ok)}</td>
              <td>{fmtBias(row.bias_deg_gated_ok, row.n_gated_ok)}</td>
              <td>{fmtMae(row.mae_deg_all, row.n_all)}</td>
              <td>{fmtBias(row.bias_deg_all, row.n_all)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ElbowRow({ row }: { row: ValidationElbowRow }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Check</th>
          <th scope="col">Gated-OK MAE</th>
          <th scope="col">Gated-OK bias</th>
          <th scope="col">All frames MAE</th>
          <th scope="col">All frames bias</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">
            {row.label} ({row.target_deg}°)
          </th>
          <td>{fmtMae(row.mae_deg_gated_ok, row.n_gated_ok)}</td>
          <td>{fmtBias(row.bias_deg_gated_ok, row.n_gated_ok)}</td>
          <td>{fmtMae(row.mae_deg_all, row.n_all)}</td>
          <td>{fmtBias(row.bias_deg_all, row.n_all)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Pure presentational view so tests can render fixtures without a results file. */
export function ValidationResultsView({ data }: { data: ValidationResults }) {
  const views = ['front', 'side'].filter((v) => data.shoulder.some((r) => r.view === v));
  const tested = views
    .map((v) => {
      const degs = data.shoulder
        .filter((r) => r.view === v)
        .map((r) => r.target_deg)
        .sort((a, b) => a - b)
        .map((d) => `${d}°`)
        .join(' and ');
      return `${v} at ${degs}`;
    })
    .join('; ');
  return (
    <div>
      <h1>{VALIDATION_TITLE}</h1>
      <section aria-label={VALIDATION_SET_HEADING}>
        <h2>{VALIDATION_SET_HEADING}</h2>
        <ul>
          <li>Clips: {data.recordedSet.n_clips}</li>
          <li>Participants: {data.recordedSet.n_participants}</li>
          <li>In-hold frames: {data.recordedSet.n_frames_in_hold}</li>
          <li>Outside-hold frames: {data.recordedSet.n_frames_outside_hold}</li>
          <li>Unlabelled frames: {data.recordedSet.n_unlabelled_frames}</li>
        </ul>
      </section>
      <section aria-label={VALIDATION_SHOULDER_HEADING}>
        <h2>{VALIDATION_SHOULDER_HEADING}</h2>
        {views.map((v) => (
          <section key={v} aria-label={`${v} view`}>
            <h3>{v} view</h3>
            <ShoulderTable
              rows={data.shoulder.filter((r) => r.view === v)}
              note={v === 'side' ? VALIDATION_SIDE_NOTE : null}
            />
          </section>
        ))}
        <p>
          {VALIDATION_TESTED_LEAD}: {tested}. {VALIDATION_TESTED_REST}
        </p>
        <p>{VALIDATION_RIGHT_ARM_ONLY}</p>
      </section>
      <section aria-label={VALIDATION_ELBOW_HEADING}>
        <h2>{VALIDATION_ELBOW_HEADING}</h2>
        <ElbowRow row={data.elbow} />
        <p>{VALIDATION_ELBOW_NOTE}</p>
      </section>
      <section aria-label={VALIDATION_GATE_HEADING}>
        <h2>{VALIDATION_GATE_HEADING}</h2>
        <p>
          {data.gate.flagged} of {data.gate.total} frames flagged.
        </p>
      </section>
      <section aria-label="Reference and notes">
        <h2>Reference and notes</h2>
        <p>
          {VALIDATION_REFERENCE_LABEL}: {data.reference}
        </p>
        {data.reference_verified_by && (
          <p>
            {VALIDATION_VERIFIED_LABEL}: {data.reference_verified_by}
          </p>
        )}
        <p>
          {VALIDATION_TUNED_LABEL}: {data.thresholds_tuned_on_reported_clips ? 'yes' : 'no'}
        </p>
        <ul>
          <li>{VALIDATION_NOTE_POSING}</li>
          <li>{VALIDATION_NOTE_GATE}</li>
          <li>{VALIDATION_NOTE_BIAS}</li>
          <li>{VALIDATION_NOTE_HOLD}</li>
        </ul>
        <p>{VALIDATION_SMALL_SET}</p>
      </section>
    </div>
  );
}

export function ValidationPage() {
  const data = loadResults();
  if (!data) {
    return (
      <div>
        <h1>{VALIDATION_TITLE}</h1>
        <p>{VALIDATION_NO_RESULTS}</p>
      </div>
    );
  }
  return <ValidationResultsView data={data} />;
}
