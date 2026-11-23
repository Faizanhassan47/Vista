import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';

const DEFAULTS = ['liver', 'spleen', 'kidney_left', 'kidney_right'];

export function TotalSegmentatorPanel({ slide, meta, viewMode, plane, index, onOverlay, onState, embedded = false }) {
  const stored = String(meta?.calibration?.modality || '').toUpperCase();
  const dicom = slide?.file_type === 'dicom-stack' ? String(meta?.modality || '').toUpperCase() : '';
  const modality = stored === 'MRI' ? 'MR' : (stored || (dicom === 'MRI' ? 'MR' : dicom));
  const eligible = modality === 'CT' || modality === 'MR';
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(DEFAULTS);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState({});
  const [tab, setTab] = useState('browse');
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState({});
  const [opacity, setOpacity] = useState(55);

  useEffect(() => {
    if (!eligible) return undefined;
    const controller = new AbortController();
    apiFetch(`${API_BASE_URL}/api/ai/totalsegmentator/structures?modality=${modality}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!body?.structures) return;
        setCatalog(body);
        const allowed = new Set(body.structures.map((item) => item.id));
        setSelected((current) => {
          const kept = current.filter((id) => allowed.has(id));
          if (kept.length) return kept;
          return DEFAULTS.filter((id) => allowed.has(id));
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [eligible, modality]);

  useEffect(() => {
    setJob(null);
    setError('');
    onOverlay?.(null);
    if (!slide?.id) return undefined;
    const controller = new AbortController();
    apiFetch(`${API_BASE_URL}/api/ai/totalsegmentator/slides/${slide.id}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (body?.job_id) setJob(body); })
      .catch(() => {});
    return () => controller.abort();
  }, [slide?.id]);

  useEffect(() => {
    if (!job?.job_id || (job.status !== 'queued' && job.status !== 'running')) return undefined;
    const timer = setInterval(async () => {
      const response = await apiFetch(`${API_BASE_URL}/api/ai/totalsegmentator/jobs/${job.job_id}`);
      const body = await response.json().catch(() => ({}));
      if (response.ok) setJob(body);
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.job_id, job?.status]);

  const visibleRois = selected.filter((id) => visible[id] !== false);

  useEffect(() => {
    onState?.({ job, visible: visibleRois.length > 0, opacity, rois: visibleRois });
  }, [job, opacity, visibleRois.join('|')]);

  useEffect(() => {
    if (!visibleRois.length || job?.status !== 'completed' || viewMode === '3d' || viewMode === 'mpr') {
      onOverlay?.(null);
      return undefined;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ plane: plane || 'axial', index: String(index || 0), rois: visibleRois.join(',') });
    apiFetch(`${API_BASE_URL}/api/ai/totalsegmentator/jobs/${job.job_id}/overlay?${params}`, { signal: controller.signal })
      .then((response) => response.ok ? response.blob() : null)
      .then((blob) => { onOverlay?.(blob ? { src: URL.createObjectURL(blob), opacity } : null); })
      .catch((err) => { if (err.name !== 'AbortError') onOverlay?.(null); });
    return () => controller.abort();
  }, [job?.job_id, job?.status, plane, index, visibleRois.join(','), viewMode]);

  useEffect(() => {
    onOverlay?.((current) => current ? { ...current, opacity } : current);
  }, [opacity]);

  const verify = async (next) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/ai/totalsegmentator/verify-modality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slide_id: slide.id, modality: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Modality verification was not saved');
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Modality verification was not saved');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/ai/totalsegmentator/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slide_id: slide.id, rois: selected }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'TotalSegmentator did not start');
      setJob(body);
    } catch (err) {
      setError(err.message || 'TotalSegmentator did not start');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const count = catalog?.count || 0;
  const selectedItems = (catalog?.structures || []).filter((item) => selected.includes(item.id));
  const regionCounts = useMemo(() => {
    const totals = new Map();
    const picked = new Map();
    (catalog?.structures || []).forEach((item) => {
      totals.set(item.category, (totals.get(item.category) || 0) + 1);
      if (selected.includes(item.id)) picked.set(item.category, (picked.get(item.category) || 0) + 1);
    });
    return { totals, picked };
  }, [catalog, selected]);

  const body = (
      <div className="anatomy-explorer">
        <div className="anatomy-explorer__head">
          <div>
            <p className="anatomy-explorer__title">Anatomy Explorer</p>
            <p className="anatomy-explorer__meta">{modality === 'CT' ? 'CT' : 'MRI'} · TotalSegmentator</p>
          </div>
          <span className="anatomy-explorer__badge">{selected.length} active</span>
        </div>
        {!eligible ? (
          <div>
            <p className="ai-feature-selector__description">This NIfTI study has no verified CT or MRI modality, so segmentation stays off. The file format is not a modality.</p>
            {slide?.file_type === 'nifti' && (
              <div className="ai-actions">
                <button type="button" className="ai-action-btn" disabled={busy} onClick={() => verify('CT')}>Verify as CT</button>
                <button type="button" className="ai-action-btn" disabled={busy} onClick={() => verify('MR')}>Verify as MRI</button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="anatomy-explorer__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'browse'} className={tab === 'browse' ? 'is-active' : ''} onClick={() => setTab('browse')}>Browse</button>
              <button type="button" role="tab" aria-selected={tab === 'selected'} className={tab === 'selected' ? 'is-active' : ''} onClick={() => setTab('selected')}>Selected</button>
            </div>
            {tab === 'browse' ? (
              <>
                <input className="anatomy-explorer__search" placeholder={`Search ${count || ''} structures...`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search structures" />
                <div className="anatomy-explorer__regions-head">
                  <span>Anatomical regions</span>
                  <button type="button" onClick={() => setSelected([])}>Clear selection</button>
                </div>
                <div className="anatomy-explorer__regions">
                  {(catalog?.categories || []).map((name) => {
                    const items = (catalog?.structures || []).filter((item) => item.category === name && (!query.trim() || item.label.toLowerCase().includes(query.trim().toLowerCase()) || item.id.toLowerCase().includes(query.trim().toLowerCase())));
                    if (query.trim() && !items.length) return null;
                    const total = regionCounts.totals.get(name) || 0;
                    const picked = regionCounts.picked.get(name) || 0;
                    return (
                      <div key={name} className="anatomy-region">
                        <button type="button" className="anatomy-region__row" onClick={() => setOpen((current) => ({ ...current, [name]: !current[name] }))}>
                          <span>{open[name] ? '▾' : '›'} {name}</span>
                          <span className="anatomy-region__count">{picked}/{total}</span>
                        </button>
                        {open[name] && (
                          <div className="anatomy-region__items">
                            <button type="button" className="anatomy-region__all" onClick={() => setSelected((current) => [...new Set([...current, ...items.map((item) => item.id)])])}>Select region</button>
                            {items.map((item) => (
                              <label key={item.id} className="anatomy-structure">
                                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
                                <span className="anatomy-swatch" style={{ background: `rgb(${item.color.join(',')})` }} aria-hidden="true" />
                                <span>{item.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="anatomy-region__items">
                {selectedItems.length === 0 && <p className="anatomy-explorer__meta">No structures selected.</p>}
                {selectedItems.map((item) => (
                  <label key={item.id} className="anatomy-structure">
                    <input type="checkbox" checked onChange={() => toggle(item.id)} />
                    <span className="anatomy-swatch" style={{ background: `rgb(${item.color.join(',')})` }} aria-hidden="true" />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            )}
            {selected.length > 24 && <p className="imaging-note">A large selection uses more CPU time, memory, and disk. One job runs at a time.</p>}
            <div className="anatomy-explorer__foot">
              <div>
                <strong>{selected.length} structures selected</strong>
                <p>Each swatch is the overlay color in 2D, MPR, and 3D.</p>
              </div>
              <button type="button" className="anatomy-explorer__run" disabled={busy || !selected.length || job?.status === 'running' || job?.status === 'queued'} onClick={run}>Run segmentation</button>
            </div>
            {(busy || job?.status === 'queued' || job?.status === 'running') && (
              <div className="ai-progress-card" role="status"><Loader2 size={13} className="spin" aria-hidden="true" /> {job?.stage || (job?.status === 'running' ? 'Running inference' : 'Queued')}</div>
            )}
            {job?.status === 'completed' && (
              <>
                <p className="ai-panel-subtitle">Status: completed{job.runtime_seconds ? ` · ${job.runtime_seconds}s` : ''}</p>
                <label className="ai-panel-subtitle">Opacity {opacity}%
                  <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
                </label>
                {(job.measurements || []).map((item) => (
                  <label key={item.roi} className="anatomy-structure">
                    <input type="checkbox" checked={visible[item.roi] !== false} onChange={() => setVisible((current) => ({ ...current, [item.roi]: current[item.roi] === false }))} />
                    <span className="anatomy-swatch" style={{ background: `rgb(${(item.color || [120, 120, 120]).join(',')})` }} aria-hidden="true" />
                    <span>{item.label}: {item.empty ? 'not in field of view' : `${item.volume_ml} mL`}{item.hu_mean != null ? ` · ${item.hu_mean} HU` : ''}{item.coverage_warning ? ' · truncated?' : ''}</span>
                  </label>
                ))}
                <p className="ai-feature-selector__description">Visible structures are drawn on axial, coronal, and sagittal slices, and on the 3D volume. An empty mask means the structure was not in the scanned field of view.</p>
              </>
            )}
            {job?.status === 'failed' && <p className="imaging-note imaging-note--error">{job.error || 'Segmentation failed'}</p>}
          </>
        )}
        {error && <p className="imaging-note imaging-note--error">{error}</p>}
      </div>
  );
  if (embedded) return body;
  return (
    <section className="ai-panel" aria-label="TotalSegmentator">
      <p className="ai-disclaimer" role="note">Research use only. These are predicted anatomical structures, not a diagnosis.</p>
      {body}
    </section>
  );
}
