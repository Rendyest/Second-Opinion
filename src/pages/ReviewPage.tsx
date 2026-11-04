import { useEffect, useState } from 'react';
import type { ReviewBundle } from '../contracts';
import { parseRecordedClip, parseReviewBundle } from '../contracts';
import { reviewClipFromRecorded } from '../pipeline/clip';
import { config } from '../config';
import { agreementByMode, formatPct, reviewCounts, type ReviewStatus, type StoredReview } from '../review/labels';
import { attachScriptLabels, parseScriptLabels } from '../review/labelImport';
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
  REVIEW_LABELS_PICK_LABEL,
  REVIEW_NO_REVIEWS,
  REVIEW_PICK_LABEL,
  REVIEW_RECORDED_NOTE,
  REVIEW_REVIEWER_LABEL,
  REVIEW_SOURCE_LABELS,
  REVIEW_UNDO_LABEL,
} from '../reviewCopy';

/**
 * Loads a review bundle or a single clip through a file picker. Clip data
 * stays in memory. Agreement summarizes saved reviewer labels.
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
  // Script-imported Muse labels, by clip id. In-memory like the bundle:
  // attaching never overwrites a bundle Muse label.
  const [importedNeeds, setImportedNeeds] = useState<Record<string, boolean>>({});

  useEffect(() => subscribeLoadedBundle(() => setBundle(getLoadedBundle())), []);

  useEffect(() => {
    if (bundle === null) {
      setSelectedId(null);
      setImportedNeeds({});
    }
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

  const onImportLabels = (file: File | undefined) => {
    if (!file || !bundle) {
      if (!bundle) setError('Load a review bundle first, then import script labels.');
      return;
    }
    setError(null);
    void file.text().then(
      (text) => {
        try {
          const parsed = parseScriptLabels(JSON.parse(text) as unknown);
          const report = attachScriptLabels(bundle.clips, parsed);
          setLoadedBundle({ ...bundle, clips: report.clips });
          setImportedNeeds((prev) => ({ ...prev, ...report.needsReview }));
          const skipped = report.skippedLabeled.length + report.skippedUnknown.length;
          setAnnouncement(
            `Imported ${report.attached.length} of ${parsed.length} script labels. ` +
              `${report.skippedLabeled.length} already labeled, ` +
              `${report.skippedUnknown.length} unknown clips, ` +
              `${report.rejected.length} rejected. ` +
              (skipped > 0 || report.rejected.length > 0 ? 'Nothing was overwritten.' : ''),
          );
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
    <div className="page reviewer-page review-page">
      <header className="page-heading">
        <h1>Clip review</h1>
        <p>Load a clip or review bundle to inspect movement and record reviewer labels.</p>
      </header>
      <section className="panel review-intake" aria-label="Review inputs">
        <h2>Load clips and labels</h2>
        <div className="review-inputs">
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
        <div>
          <label>
            {REVIEW_LABELS_PICK_LABEL}{' '}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                onImportLabels(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        </div>
        {error && <p role="alert">{error}</p>}
        {announcement && <p role="status">{announcement}</p>}
      </section>
      <div className="review-workspace">
        <div className="panel review-main">
        {selected && bundle && <p>Source: {REVIEW_SOURCE_LABELS[bundle.source]}</p>}
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
            museImported={selected.clip_id in importedNeeds}
            museNeedsReview={importedNeeds[selected.clip_id] ?? false}
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
            <div className="empty-state"><p>No review clips yet.</p><p>Choose a clip or review bundle above to open the queue.</p></div>
          </section>
        )}
        </div>
        <section className="panel review-agreement" aria-label={REVIEW_AGREEMENT_TITLE}>
          <h2>{REVIEW_AGREEMENT_TITLE}</h2>
          <p>Agreement covers all saved reviews and may include simulated clips.</p>
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
      </div>
      <details className="disclosure">
      <summary>Manage saved reviews</summary>
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
      </details>
    </div>
  );
}
