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
  const [region, setRegion] = useState('all');
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
        if (body.categories?.length) setRegion((current) => (current === 'all' || body.categories.includes(current) ? current : 'all'));
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

  const categories = catalog?.categories || [];
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const items = catalog?.structures || [];
    return items.filter((item) => {
      if (region !== 'all' && item.category !== region) return false;
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
    });
  }, [catalog, region, q]);

  const selectRegion = () => {
    setSelected((current) => [...new Set([...current, ...filtered.map((item) => item.id)])]);
  };

  const body = (
    <div className={`anatomy-explorer${embedded ? ' anatomy-explorer--compact' : ''}`}>
      <div className="anatomy-explorer__toolbar">
        <span className="anatomy-explorer__count">{selected.length} selected</span>
        <span className="anatomy-explorer__meta">{modality === 'CT' ? 'CT' : 'MRI'}</span>
      </div>

      {!eligible ? (
        <div className="anatomy-explorer__block">
          <p className="anatomy-explorer__hint">This NIfTI study has no verified CT or MRI modality. The file format is not a modality.</p>
          {slide?.file_type === 'nifti' && (
            <div className="anatomy-explorer__actions">
              <button type="button" className="anatomy-explorer__run" disabled={busy} onClick={() => verify('CT')}>Verify as CT</button>
              <button type="button" className="anatomy-explorer__run anatomy-explorer__run--ghost" disabled={busy} onClick={() => verify('MR')}>Verify as MRI</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <label className="anatomy-explorer__field">
            <span>Region</span>
            <select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="Anatomical region">
              <option value="all">All regions ({catalog?.count || 0})</option>
              {categories.map((name) => {
                const total = (catalog?.structures || []).filter((item) => item.category === name).length;
                const picked = (catalog?.structures || []).filter((item) => item.category === name && selected.includes(item.id)).length;
                return <option key={name} value={name}>{name} ({picked}/{total})</option>;
              })}
            </select>
          </label>

          <label className="anatomy-explorer__field">
            <span>Search</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter structures…"
              aria-label="Search structures"
            />
          </label>

          <div className="anatomy-explorer__list-head">
            <button type="button" onClick={selectRegion} disabled={!filtered.length}>
              {region === 'all' ? 'Select all shown' : 'Select region'}
            </button>
            <button type="button" onClick={() => setSelected([])} disabled={!selected.length}>Clear</button>
          </div>

          <div className="anatomy-explorer__list" role="listbox" aria-label="Structures">
            {!filtered.length && <p className="anatomy-explorer__hint">No structures match.</p>}
            {filtered.map((item) => (
              <label key={item.id} className={`anatomy-structure${selected.includes(item.id) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
                <span className="anatomy-swatch" style={{ background: `rgb(${item.color.join(',')})` }} aria-hidden="true" />
                <span className="anatomy-structure__label">{item.label}</span>
              </label>
            ))}
          </div>

          {selected.length > 24 && (
            <p className="anatomy-explorer__hint">Large selections use more CPU, memory, and disk. One job runs at a time.</p>
          )}

          <button
            type="button"
            className="anatomy-explorer__run"
            disabled={busy || !selected.length || job?.status === 'running' || job?.status === 'queued'}
            onClick={run}
          >
            Run segmentation
          </button>

          {(busy || job?.status === 'queued' || job?.status === 'running') && (
            <p className="anatomy-explorer__status" role="status">
              <Loader2 size={13} className="spin" aria-hidden="true" />
              {job?.stage || (job?.status === 'running' ? 'Running inference…' : 'Queued…')}
            </p>
          )}

          {job?.status === 'completed' && (
            <div className="anatomy-explorer__results">
              <div className="anatomy-explorer__toolbar">
                <span>Completed{job.runtime_seconds ? ` · ${job.runtime_seconds}s` : ''}</span>
                <label className="anatomy-explorer__opacity">
                  Opacity {opacity}%
                  <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
                </label>
              </div>
              <div className="anatomy-explorer__list anatomy-explorer__list--results">
                {(job.measurements || []).map((item) => (
                  <label key={item.roi} className={`anatomy-structure${visible[item.roi] === false ? '' : ' is-on'}`}>
                    <input
                      type="checkbox"
                      checked={visible[item.roi] !== false}
                      onChange={() => setVisible((current) => ({ ...current, [item.roi]: current[item.roi] === false }))}
                    />
                    <span className="anatomy-swatch" style={{ background: `rgb(${(item.color || [120, 120, 120]).join(',')})` }} aria-hidden="true" />
                    <span className="anatomy-structure__label">
                      {item.label}
                      <small>
                        {item.empty ? 'not in FOV' : `${item.volume_ml} mL`}
                        {item.hu_mean != null ? ` · ${item.hu_mean} HU` : ''}
                        {item.coverage_warning ? ' · truncated?' : ''}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <p className="anatomy-explorer__hint">Toggles control overlays in 2D, MPR, and 3D. Empty means outside the scanned field of view.</p>
            </div>
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
