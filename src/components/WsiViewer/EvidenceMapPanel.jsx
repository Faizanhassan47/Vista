/**
 * Evidence Map panel — Phase 1 review UI for normalized AI findings.
 * Original model outputs remain immutable; scores are labelled uncalibrated.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, History, Loader2, RefreshCw, X } from 'lucide-react';
import { viewerService } from '../../services/viewerService';
import './EvidenceMapPanel.css';

function geometryFocus(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const type = geometry.type;
  const coords = geometry.coordinates;
  if (type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
    return { x: Number(coords[0]), y: Number(coords[1]), width: 128, height: 128, point: true };
  }
  const ring = type === 'Polygon'
    ? coords?.[0]
    : type === 'MultiPolygon'
      ? coords?.[0]?.[0]
      : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    minX = Math.min(minX, Number(pt[0]));
    minY = Math.min(minY, Number(pt[1]));
    maxX = Math.max(maxX, Number(pt[0]));
    maxY = Math.max(maxY, Number(pt[1]));
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(32, maxX - minX),
    height: Math.max(32, maxY - minY),
    point: false,
  };
}

function fmtScore(score) {
  if (score == null || Number.isNaN(Number(score))) return '—';
  return Number(score).toFixed(3);
}

const FUSION_COLORS = {
  Agreement: '#0f766e',
  AgreementQC: '#0e7490',
  Conflict: '#b91c1c',
  ConflictQC: '#9f1239',
  QCAffected: '#d97706',
  Related: '#0369a1',
  Singleton: '#64748b',
};

export default function EvidenceMapPanel({
  slide,
  onFocusFinding,
  onSelectFinding,
  selectedFindingId,
  onSelectFusionGroup,
  selectedFusionGroupId,
  refreshKey = 0,
}) {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState([]);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [reason, setReason] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [fusionRuns, setFusionRuns] = useState([]);
  const [fusionRun, setFusionRun] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [fusing, setFusing] = useState(false);

  const load = useCallback(async (signal) => {
    if (!slide?.id) return;
    setLoading(true);
    setError('');
    try {
      const data = await viewerService.getEvidenceFindings(slide.id, {
        finding_type: filterType || undefined,
        review_status: filterStatus || undefined,
        limit: 100,
      }, signal);
      if (signal?.aborted) return;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(data?.total || 0);
      setSummary(Array.isArray(data?.summary) ? data.summary : []);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Could not load Evidence Map');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [slide?.id, filterType, filterStatus]);

  const loadFusionRuns = useCallback(async (signal) => {
    if (!slide?.id) return;
    try {
      const data = await viewerService.listFusionRuns(slide.id, signal);
      if (signal?.aborted) return;
      const runs = Array.isArray(data?.runs) ? data.runs : [];
      setFusionRuns(runs);
      if (runs[0]?.id) {
        const detail = await viewerService.getFusionRun(runs[0].id, signal);
        if (!signal?.aborted) setFusionRun(detail);
      } else {
        setFusionRun(null);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        /* Fusion optional until first run */
      }
    }
  }, [slide?.id]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    loadFusionRuns(controller.signal);
    return () => controller.abort();
  }, [load, loadFusionRuns, refreshKey]);

  const selectFinding = useCallback(async (finding) => {
    setSelected(finding);
    onSelectFinding?.(finding);
    const focus = geometryFocus(finding.geometry);
    if (focus) onFocusFinding?.(finding, focus);
    try {
      const detail = await viewerService.getEvidenceFinding(finding.id);
      setSelected(detail);
      setHistory(Array.isArray(detail?.history) ? detail.history : []);
      onSelectFinding?.(detail);
    } catch (err) {
      setError(err.message || 'Could not load finding provenance');
    }
  }, [onFocusFinding, onSelectFinding]);

  useEffect(() => {
    if (selectedFindingId == null) return;
    const match = items.find((item) => item.id === selectedFindingId);
    if (match && selected?.id !== selectedFindingId) {
      selectFinding(match);
    }
  }, [selectedFindingId, items, selected?.id, selectFinding]);

  const project = async () => {
    setProjecting(true);
    setError('');
    try {
      await viewerService.projectEvidence(slide.id);
      await load();
    } catch (err) {
      setError(err.message || 'Projection failed');
    } finally {
      setProjecting(false);
    }
  };

  const runFusion = async () => {
    setFusing(true);
    setError('');
    try {
      const run = await viewerService.runFusion(slide.id, {});
      setFusionRun(run);
      setFusionRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedGroup(null);
      onSelectFusionGroup?.(null);
    } catch (err) {
      setError(err.message || 'Fusion failed');
    } finally {
      setFusing(false);
    }
  };

  const openFusionRun = async (runId) => {
    if (!runId) {
      setFusionRun(null);
      setSelectedGroup(null);
      onSelectFusionGroup?.(null);
      return;
    }
    try {
      const detail = await viewerService.getFusionRun(runId);
      setFusionRun(detail);
      setSelectedGroup(null);
      onSelectFusionGroup?.(null);
    } catch (err) {
      setError(err.message || 'Could not load fusion run');
    }
  };

  const selectGroup = async (group) => {
    setSelectedGroup(group);
    onSelectFusionGroup?.(group);
    const focus = geometryFocus(group.geometry);
    if (focus) onFocusFinding?.(null, focus);
    if (group?.id) {
      try {
        const detail = await viewerService.getFusionGroup(group.id);
        setSelectedGroup(detail);
        onSelectFusionGroup?.(detail);
      } catch (err) {
        setError(err.message || 'Could not load fusion group');
      }
    }
  };

  useEffect(() => {
    if (selectedFusionGroupId == null) return;
    const match = (fusionRun?.groups || []).find((group) => group.id === selectedFusionGroupId);
    if (match && selectedGroup?.id !== selectedFusionGroupId) {
      setSelectedGroup(match);
    }
  }, [selectedFusionGroupId, fusionRun, selectedGroup?.id]);

  const submitReview = async (action) => {
    if (!selected?.id) return;
    if (action === 'Correct' && !reason.trim()) {
      setError('Correct requires a reason.');
      return;
    }
    setBusyAction(action);
    setError('');
    try {
      const updated = await viewerService.reviewEvidenceFinding(selected.id, {
        action,
        reason: reason.trim() || undefined,
        correction: action === 'Correct' ? { note: reason.trim() } : undefined,
      });
      setSelected(updated);
      setHistory(Array.isArray(updated?.history) ? updated.history : []);
      setReason('');
      onSelectFinding?.(updated);
      await load();
    } catch (err) {
      setError(err.message || 'Review failed');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <section className="evidence-map" aria-label="AI Evidence Map">
      <button type="button" className="evidence-map__header" onClick={() => setOpen((value) => !value)}>
        <div>
          <h3>Evidence Map</h3>
          <span>{total} findings · uncalibrated scores</span>
        </div>
        <span className={`evidence-map__chevron${open ? ' evidence-map__chevron--open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="evidence-map__body">
          <p className="evidence-map__disclaimer">
            Research use only. Findings reference immutable source analyses. Scores are uncalibrated and are not diagnoses.
          </p>

          <div className="evidence-map__toolbar">
            <label>
              Type
              <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                <option value="">All</option>
                <option value="nucleus">Nucleus</option>
                <option value="mitotic_candidate">Mitotic</option>
                <option value="tumor_patch">Tumor patch</option>
                <option value="qc_polygon">QC polygon</option>
              </select>
            </label>
            <label>
              Review
              <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                <option value="">All</option>
                <option value="Unreviewed">Unreviewed</option>
                <option value="Accepted">Accepted</option>
                <option value="Rejected">Rejected</option>
                <option value="Corrected">Corrected</option>
              </select>
            </label>
            <button type="button" className="evidence-map__icon-btn" onClick={() => load()} title="Refresh" disabled={loading}>
              {loading ? <Loader2 size={14} className="evidence-map__spin" /> : <RefreshCw size={14} />}
            </button>
            <button type="button" className="evidence-map__text-btn" onClick={project} disabled={projecting}>
              {projecting ? 'Projecting…' : 'Project existing'}
            </button>
            <button type="button" className="evidence-map__text-btn" onClick={runFusion} disabled={fusing || !total}>
              {fusing ? 'Running Fusion…' : 'Run Fusion'}
            </button>
          </div>

          <div className="evidence-map__fusion">
            <div className="evidence-map__fusion-head">
              <strong>AI Fusion v1</strong>
              <span>Spatial correlation · no combined diagnostic score</span>
            </div>
            {fusionRuns.length > 0 && (
              <label>
                Fusion run
                <select
                  value={fusionRun?.id || ''}
                  onChange={(event) => openFusionRun(Number(event.target.value) || null)}
                >
                  {fusionRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      #{run.id} · {run.group_count} groups · {run.created_at ? new Date(run.created_at).toLocaleString() : 'completed'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {fusionRun?.summary?.by_classification && (
              <div className="evidence-map__summary">
                {Object.entries(fusionRun.summary.by_classification).map(([name, count]) => (
                  <span key={name} style={{ borderLeft: `3px solid ${FUSION_COLORS[name] || '#64748b'}` }}>
                    {name}: {count}
                  </span>
                ))}
              </div>
            )}
            <div className="evidence-map__list evidence-map__list--fusion">
              {(fusionRun?.groups || []).map((group) => {
                const active = selectedGroup?.id === group.id;
                return (
                  <button
                    type="button"
                    key={group.id || group.group_key}
                    className={`evidence-map__item${active ? ' evidence-map__item--active' : ''}`}
                    onClick={() => selectGroup(group)}
                  >
                    <strong style={{ color: FUSION_COLORS[group.classification] || undefined }}>
                      {group.group_key} · {group.classification}
                    </strong>
                    <small>{group.member_count || group.members?.length || 0} findings · source scores preserved</small>
                  </button>
                );
              })}
              {fusionRun && !(fusionRun.groups || []).length && (
                <p className="evidence-map__empty">This fusion run has no spatial groups.</p>
              )}
            </div>
            {selectedGroup && (
              <div className="evidence-map__detail">
                <h4>{selectedGroup.group_key} · {selectedGroup.classification}</h4>
                <p className="evidence-map__empty">
                  Why: {(selectedGroup.why?.rationale || selectedGroup.rationale?.rationale || []).join(' ') || 'No rationale recorded.'}
                </p>
                <dl>
                  <div><dt>Uncertainty</dt><dd>{selectedGroup.uncertainty?.note || selectedGroup.rationale?.uncertainty?.note}</dd></div>
                  <div><dt>Combined diagnostic confidence</dt><dd>Not produced</dd></div>
                </dl>
                <div className="evidence-map__list">
                  {(selectedGroup.members || []).map((member) => (
                    <button
                      type="button"
                      key={member.evidence_finding_id || member.id}
                      className="evidence-map__item"
                      onClick={() => {
                        const findingId = member.evidence_finding_id || member.id;
                        const match = items.find((item) => item.id === findingId);
                        if (match) selectFinding(match);
                        else selectFinding({ id: findingId, geometry: member.geometry, label: member.label, finding_type: member.finding_type });
                      }}
                    >
                      <strong>{member.label || member.finding_type}</strong>
                      <small>
                        {member.finding_type} · {member.model_name} {member.model_version} · {member.review_status}
                      </small>
                      <small>
                        score {fmtScore(member.score)} ({member.score_calibration_status || 'uncalibrated'})
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {summary.length > 0 && (
            <div className="evidence-map__summary">
              {summary.slice(0, 8).map((row) => (
                <span key={`${row.finding_type}-${row.review_status}`}>
                  {row.finding_type} · {row.review_status}: {row.count}
                </span>
              ))}
            </div>
          )}

          {error && <p className="evidence-map__error" role="alert">{error}</p>}

          <div className="evidence-map__list">
            {!items.length && !loading && <p className="evidence-map__empty">No evidence findings yet. Run AI or project existing analyses.</p>}
            {items.map((item) => {
              const active = selected?.id === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`evidence-map__item${active ? ' evidence-map__item--active' : ''}`}
                  onClick={() => selectFinding(item)}
                >
                  <strong>{item.label || item.finding_type}</strong>
                  <small>
                    {item.finding_type} · {item.model_name} {item.model_version}
                  </small>
                  <small>
                    score {fmtScore(item.score)} ({item.score_calibration_status}) · {item.review_status}
                  </small>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="evidence-map__detail">
              <h4>Finding #{selected.id}</h4>
              <dl>
                <div><dt>Source</dt><dd>{selected.source_kind}#{selected.source_analysis_id} · {selected.source_finding_key}</dd></div>
                <div><dt>Model</dt><dd>{selected.model_name} {selected.model_version}</dd></div>
                <div><dt>Type</dt><dd>{selected.finding_type}</dd></div>
                <div><dt>Score</dt><dd>{fmtScore(selected.score)} · {selected.score_calibration_status}</dd></div>
                <div><dt>Review</dt><dd>{selected.review_status}{selected.report_eligible ? ' · report-eligible' : ''}</dd></div>
                {selected.qc_context?.qc_analysis_id && (
                  <div><dt>QC context</dt><dd>GrandQC #{selected.qc_context.qc_analysis_id}</dd></div>
                )}
                {selected.provenance?.score_note && (
                  <div><dt>Note</dt><dd>{selected.provenance.score_note}</dd></div>
                )}
              </dl>

              <label className="evidence-map__reason">
                Review reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Required for Correct; optional for Accept/Reject"
                />
              </label>

              <div className="evidence-map__actions">
                <button type="button" onClick={() => submitReview('Accept')} disabled={!!busyAction}>
                  {busyAction === 'Accept' ? <Loader2 size={14} className="evidence-map__spin" /> : <Check size={14} />}
                  Accept
                </button>
                <button type="button" onClick={() => submitReview('Reject')} disabled={!!busyAction}>
                  {busyAction === 'Reject' ? <Loader2 size={14} className="evidence-map__spin" /> : <X size={14} />}
                  Reject
                </button>
                <button type="button" onClick={() => submitReview('Correct')} disabled={!!busyAction}>
                  Correct
                </button>
              </div>

              <div className="evidence-map__history">
                <h5><History size={13} /> Review history</h5>
                {!history.length && <p>No review events yet.</p>}
                {history.map((event) => (
                  <article key={event.id}>
                    <strong>{event.action}</strong>
                    <span>{event.actor}</span>
                    <time dateTime={event.created_at}>{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</time>
                    {event.reason && <p>{event.reason}</p>}
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export { geometryFocus };
