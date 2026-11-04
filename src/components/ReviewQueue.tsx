import type { ClipSource, ReviewClip } from '../contracts';
import type { ReviewStatus, StoredReview } from '../review/labels';
import { museLabelText } from '../reviewCopy';
import { SkeletonSvg } from '../review/skeletonSvg';
import {
  REVIEW_FILTER_ALL,
  REVIEW_FILTER_LABEL,
  REVIEW_QUEUE_EMPTY,
  REVIEW_SOURCE_LABELS,
  REVIEW_STATUS_LABEL,
} from '../reviewCopy';

export interface QueueRow {
  clip: ReviewClip;
  status: ReviewStatus;
  museText: string;
  skipped: boolean;
}

const STATUS_ICON: Record<ReviewStatus, string> = {
  unreviewed: '○',
  confirmed: '✓',
  corrected: '≈',
  flagged: '!',
  labeled: '●',
};

/**
 * Build queue rows from clips and saved reviews (status, Muse text, skip
 * flag), skipped clips moved to the end.
 */
export function buildQueueRows(
  clips: ReviewClip[],
  reviewById: Map<string, StoredReview>,
): QueueRow[] {
  const rows = clips.map((clip) => {
    const review = reviewById.get(clip.clip_id);
    return {
      clip,
      status: review?.status ?? 'unreviewed',
      museText: museLabelText(clip.muse ?? null),
      skipped: review?.skipped === true,
    };
  });
  return [...rows].sort((a, b) => Number(a.skipped) - Number(b.skipped));
}

function clipDuration(clip: ReviewClip): string {
  const last = clip.frames[clip.frames.length - 1];
  return `${(last?.t ?? 0).toFixed(1)} s`;
}

/**
 * Review queue: one row per clip with a static skeleton thumbnail, clip id,
 * duration, Muse label and status (text plus icon, never colour alone).
 * Skipped clips arrive last (sorted by the parent) and are counted below.
 */
export function ReviewQueue({
  rows,
  filter,
  onFilterChange,
  counts,
  skippedCount,
  source,
  selectedId,
  onSelect,
  dimBelowConf,
}: {
  rows: QueueRow[];
  filter: ReviewStatus | 'all';
  onFilterChange: (f: ReviewStatus | 'all') => void;
  counts: Record<ReviewStatus, number>;
  skippedCount: number;
  source: ClipSource;
  selectedId: string | null;
  onSelect: (clipId: string) => void;
  dimBelowConf: number;
}) {
  if (rows.length === 0) {
    return (
      <section aria-label="Review queue">
        <h2>Review queue</h2>
        <p>{REVIEW_QUEUE_EMPTY}</p>
      </section>
    );
  }
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  return (
    <section aria-label="Review queue">
      <h2>Review queue</h2>
      <p>
        Source: {REVIEW_SOURCE_LABELS[source]}
      </p>
      <div>
        <label>
          {REVIEW_FILTER_LABEL}{' '}
          <select value={filter} onChange={(e) => onFilterChange(e.target.value as ReviewStatus | 'all')}>
            <option value="all">{REVIEW_FILTER_ALL}</option>
            {(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => (
              <option key={s} value={s}>
                {`${REVIEW_STATUS_LABEL[s]} (${counts[s]})`}
              </option>
            ))}
          </select>
        </label>
        {skippedCount > 0 && <p>{`Skipped: ${skippedCount}`}</p>}
      </div>
      <ul>
        {visible.map((row) => {
          const mid = row.clip.frames[Math.floor(row.clip.frames.length / 2)] ?? row.clip.frames[0];
          return (
            <li key={row.clip.clip_id}>
              <button
                type="button"
                onClick={() => onSelect(row.clip.clip_id)}
                aria-current={selectedId === row.clip.clip_id ? 'true' : undefined}
              >
                {mid && (
                  <SkeletonSvg frame={mid} dimBelowConf={dimBelowConf} label={`Skeleton at the middle of ${row.clip.clip_id}`} />
                )}
                <span>{row.clip.clip_id}</span> <span>{clipDuration(row.clip)}</span>{' '}
                <span>{row.museText}</span>{' '}
                <span>
                  <span aria-hidden="true">{STATUS_ICON[row.status]}</span> {REVIEW_STATUS_LABEL[row.status]}
                </span>
                {row.skipped && <span>Skipped</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
