import { useEffect, useState } from 'react';
import type { ReviewBundle } from '../contracts';
import { parseRecordedClip, parseReviewBundle } from '../contracts';
import { reviewClipFromRecorded } from '../pipeline/clip';
import { config } from '../config';
import { agreementByMode, formatPct, reviewCounts, type ReviewStatus, type StoredReview } from '../review/labels';
import {
  clearReviews,
  downloadTextFile,
  getLoadedBundle,
  loadReviewer,
  loadReviews,
  parseReviewsImport,
  saveReviewer,
  saveReviews,
  serializeReviews,
  setLoadedBundle,
  subscribeLoadedBundle,
} from '../review/store';
import { buildQueueRows, ReviewQueue } from '../components/ReviewQueue';
import { ReviewCard } from '../components/ReviewCard';
import {
  REVIEW_AGREEMENT_TITLE,
  REVIEW_ASSIST_HEADING,
  REVIEW_ASSISTED_TAG,
  REVIEW_BLIND_HEADING,
  REVIEW_CLEAR_CONFIRM,
  REVIEW_CLEAR_LABEL,
  REVIEW_EXPORT_LABEL,
  REVIEW_IMPORT_CONFIRM,
  REVIEW_IMPORT_LABEL,
  REVIEW_NO_REVIEWS,
  REVIEW_PICK_LABEL,
  REVIEW_RECORDED_NOTE,
  REVIEW_REVIEWER_LABEL,
  REVIEW_UNDO_LABEL,
} from '../reviewCopy';

/**
 * Reviewer route (dev only in the nav, reachable by URL). Loads a review
 * bundle or a single recorder clip through a file picker — everything stays
 * in memory. Results are never shown here: agreement comes only from real
 * submitted labels.
 */
export function ReviewPage() {
  const [bundle, setBundle] = useState<ReviewBundle | null>(() => getLoadedBundle());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<StoredReview[]>(() => loadReviews());
  const [reviewer, setReviewer] = useState<string>(() => loadReviewer());
  const [lastAction, setLastAction] = useState<{ clipId: string; prev: StoredReview | null } | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => subscribeLoadedBundle(() => setBundle(getLoadedBundle())), []);

  useEffect(() => {
    if (bundle === null) setSelectedId(null);
  }, [bundle]);

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    void file.text().then(
      (text) => {
        try {
          const json: unknown = JSON.parse(text) as unknown;
          let next: ReviewBundle;
          if (typeof json === 'object' && json !== null && Array.isArray((json as { clips?: unknown }).clips)) {
            next = parseReviewBundle(json);
          } else {
            const recorded = parseRecordedClip(json);
            next = { version: 1 as const, source: recorded.source, clips: [reviewClipFromRecorded(recorded)] };
          }
          setLoadedBundle(next);
          setSelectedId(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That file could not be read.');
        }
      },
      () => setError('That file could not be read.'),
    );
  };

  const reviewById = new Map(reviews.map((r) => [r.clip_id, r]));

  const sorted = buildQueueRows(bundle?.clips ?? [], reviewById);

  const counts = reviewCounts(reviews);
  const counted = reviews.filter(
    (r): r is StoredReview & { muse: NonNullable<StoredReview['muse']> } =>
      (r.status === 'confirmed' || r.status === 'corrected') && r.muse !== null,
  );
  const split = agreementByMode(
    counted.map((r) => ({
      label: { struggling: r.struggling, severity: r.severity, errorTypes: r.error_types },
      muse: r.muse,
      mode: r.mode,
    })),
  );
  const withoutClip = bundle
    ? reviews.filter((r) => !bundle.clips.some((c) => c.clip_id === r.clip_id)).length
    : reviews.length;

  const submitReview = (review: StoredReview) => {
    const prevEntry = reviews.find((r) => r.clip_id === review.clip_id) ?? null;
    const next = [...reviews.filter((r) => r.clip_id !== review.clip_id), review];
    setLastAction({ clipId: review.clip_id, prev: prevEntry });
    saveReviews(next);
    setReviews(next);
    setAnnouncement(REVIEW_RECORDED_NOTE);
  };

  const undoLast = () => {
    if (!lastAction) return;
    const rest = reviews.filter((r) => r.clip_id !== lastAction.clipId);
    const next = lastAction.prev ? [...rest, lastAction.prev] : rest;
    saveReviews(next);
    setReviews(next);
    setSelectedId(lastAction.clipId);
    setLastAction(null);
  };

  const onExport = () => {
    downloadTextFile('reviews.json', serializeReviews(reviews));
  };

  const onImportFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(
      (text) => {
        try {
          const imported = parseReviewsImport(text);
          if (window.confirm(REVIEW_IMPORT_CONFIRM)) {
            saveReviews(imported);
            setReviews(imported);
            setLastAction(null);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That file could not be read.');
        }
      },
      () => setError('That file could not be read.'),
    );
  };

  const onClear = () => {
    if (window.confirm(REVIEW_CLEAR_CONFIRM)) {
      clearReviews();
      setReviews([]);
      setLastAction(null);
    }
  };

  const selected = bundle?.clips.find((c) => c.clip_id === selectedId) ?? null;
  const existing = selectedId ? (reviewById.get(selectedId) ?? null) : null;

  return (
    <div>
      <h1>Clip review (OT reviewer)</h1>
      <div>
        <label>
          {REVIEW_REVIEWER_LABEL}{' '}
          <input
            type="text"
            value={reviewer}
            maxLength={80}
            onChange={(e) => {
              setReviewer(e.target.value);
              saveReviewer(e.target.value);
            }}
          />
        </label>
      </div>
      <div>
        <label>
          {REVIEW_PICK_LABEL}{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {announcement && <p role="status">{announcement}</p>}
      {selected ? (
        <ReviewCard
          key={selected.clip_id}
          clip={selected}
          existingReview={existing}
          reviewer={reviewer}
          blindDefault={config.review.blind_default}
          noteMaxChars={config.review.note_max_chars}
          onSubmit={submitReview}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        bundle && (
          <ReviewQueue
            rows={sorted}
            filter={filter}
            onFilterChange={setFilter}
            counts={{
              unreviewed: sorted.filter((r) => r.status === 'unreviewed').length,
              confirmed: sorted.filter((r) => r.status === 'confirmed').length,
              corrected: sorted.filter((r) => r.status === 'corrected').length,
              flagged: sorted.filter((r) => r.status === 'flagged').length,
              labeled: sorted.filter((r) => r.status === 'labeled').length,
            }}
            skippedCount={sorted.filter((r) => r.skipped).length}
            source={bundle.source}
            selectedId={selectedId}
            onSelect={setSelectedId}
            dimBelowConf={config.gate.vis_min}
          />
        )
      )}
      {!bundle && (
        <section aria-label="Review queue">
          <h2>Review queue</h2>
          <p>No review clips yet.</p>
        </section>
      )}
      <section aria-label={REVIEW_AGREEMENT_TITLE}>
        <h2>{REVIEW_AGREEMENT_TITLE}</h2>
        {counts.counted === 0 ? (
          <p>{REVIEW_NO_REVIEWS}</p>
        ) : (
          <>
            <p>
              {`${REVIEW_BLIND_HEADING}: ${formatPct(split.blind.exact)} exact (${split.blind.exactN} of ${split.blind.n} clips)`}
            </p>
            <p>
              {`${REVIEW_ASSIST_HEADING} (${REVIEW_ASSISTED_TAG}): ${formatPct(split.assist.exact)} exact (${split.assist.exactN} of ${split.assist.n} clips)`}
            </p>
          </>
        )}
        <ul>
          <li>{`Unusable: ${counts.unusable}`}</li>
          <li>{`Skipped: ${counts.skipped}`}</li>
          <li>{`Labeled (no Muse label): ${counts.labeled}`}</li>
          <li>{`Unreviewed: ${counts.unreviewed}`}</li>
          {withoutClip > 0 && <li>{`Reviews without a loaded clip: ${withoutClip}`}</li>}
        </ul>
      </section>
      <div className="button-row">
        {lastAction && (
          <button type="button" onClick={undoLast}>
            {REVIEW_UNDO_LABEL}
          </button>
        )}
        <button type="button" onClick={onExport}>
          {REVIEW_EXPORT_LABEL}
        </button>
        <label>
          {REVIEW_IMPORT_LABEL}{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" onClick={onClear}>
          {REVIEW_CLEAR_LABEL}
        </button>
      </div>
    </div>
  );
}
