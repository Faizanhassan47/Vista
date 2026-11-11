/**
 * Case-level Fusion / Evidence summary (Phase 3).
 * Slide-scoped aggregation only — no cross-slide tissue identity claims.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { caseIntelligenceService } from '../../services/caseIntelligenceService';
import './CaseFusionSummary.css';

export default function CaseFusionSummary({ selectedCase, onOpenSlide }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);

  const load = useCallback(async (signal) => {
    if (!selectedCase?.id) return;
    setLoading(true);
    setError('');
    try {
      const data = await caseIntelligenceService.fusionSummary(selectedCase.id, signal);
      if (!signal?.aborted) setSummary(data);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Could not load case fusion summary');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [selectedCase?.id]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!selectedCase) return null;

  return (
    <section className="case-fusion-summary" aria-label="Case fusion summary">
      <div className="case-fusion-summary__head">
        <div>
          <h3>Case Fusion Summary</h3>
          <span>Slide-level evidence and latest Fusion runs</span>
        </div>
        <button type="button" onClick={() => load()} disabled={loading} title="Refresh">
          {loading ? <Loader2 size={14} className="case-fusion-summary__spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      <p className="case-fusion-summary__disclaimer">
        Research use only. Slides are summarized side-by-side. Different slides are not treated as the same tissue region without validated registration.
      </p>

      {error && <p className="case-fusion-summary__error" role="alert">{error}</p>}

      {summary && (
        <>
          <div className="case-fusion-summary__totals">
            <div><strong>{summary.totals?.evidence_total ?? 0}</strong><span>Evidence findings</span></div>
            <div><strong>{summary.totals?.unresolved_reviews ?? 0}</strong><span>Unresolved reviews</span></div>
            <div><strong>{summary.totals?.verified_findings ?? 0}</strong><span>Verified</span></div>
            <div><strong>{summary.totals?.agreements ?? 0}</strong><span>Agreements</span></div>
            <div><strong>{summary.totals?.conflicts ?? 0}</strong><span>Conflicts</span></div>
            <div><strong>{summary.totals?.qc_affected_groups ?? 0}</strong><span>QC-affected</span></div>
          </div>

          <div className="case-fusion-summary__slides">
            {(summary.slides || []).map((slide) => (
              <article key={slide.slide_id}>
                <header>
                  <button type="button" onClick={() => onOpenSlide?.(slide.slide_id)}>
                    <strong>{slide.label || `Slide #${slide.slide_id}`}</strong>
                  </button>
                  <small>{slide.stain || 'Unspecified stain'}</small>
                </header>
                <p>
                  Evidence {slide.evidence?.total || 0}
                  {' · '}unresolved {slide.evidence?.unresolved || 0}
                  {' · '}verified {slide.evidence?.verified || 0}
                </p>
                {slide.latest_fusion_run ? (
                  <p>
                    Fusion run #{slide.latest_fusion_run.id}
                    {' · '}{slide.latest_fusion_run.group_count} groups
                    {slide.latest_fusion_run.by_classification
                      && ` · ${Object.entries(slide.latest_fusion_run.by_classification).map(([k, v]) => `${k}:${v}`).join(', ')}`}
                  </p>
                ) : (
                  <p>No Fusion run yet on this slide.</p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
