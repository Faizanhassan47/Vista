import { useEffect, useRef, useState } from 'react';
import { Layers, X } from 'lucide-react';
import { dipService } from '../../services/dipService';
import './DipProcessingPanel.css';

const KERNELS = [3, 5, 7, 9];

export default function DipProcessingPanel({
  slideId,
  roiRect,
  visible,
  opacity,
  onVisibleChange,
  onOpacityChange,
  view = 'overlay',
  onViewChange = () => {},
  onResult,
  onClear,
  onClose,
}) {
  const [technique, setTechnique] = useState('otsu');
  const [mode, setMode] = useState('roi');
  const [kernel, setKernel] = useState(5);
  const [lowThreshold, setLowThreshold] = useState(50);
  const [highThreshold, setHighThreshold] = useState(150);
  const [clipLimit, setClipLimit] = useState(2);
  const [tileGridSize, setTileGridSize] = useState(8);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    setResult(null);
    setError('');
    requestRef.current?.abort();
    setRunning(false);
  }, [slideId]);

  const width = Math.floor(Number(roiRect?.width) || 0);
  const height = Math.floor(Number(roiRect?.height) || 0);
  const x = Math.floor(Number(roiRect?.x));
  const y = Math.floor(Number(roiRect?.y));
  let roiMessage = '';
  if (!roiRect) roiMessage = 'Draw or select a rectangle before running segmentation.';
  else if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0) roiMessage = 'The selected ROI coordinates are not valid level-0 pixels.';
  else if (width < 64 || height < 64) roiMessage = `The selected ROI is ${width} × ${height} px. The minimum is 64 × 64 px.`;
  else if (width > 2048 || height > 2048) roiMessage = `The selected ROI is ${width} × ${height} px. The maximum is 2048 × 2048 px.`;
  const thresholdMessage = technique === 'canny' && !(lowThreshold < highThreshold)
    ? 'The low threshold must be lower than the high threshold.'
    : '';
  const roiReady = mode === 'whole_slide' || !roiMessage;
  const canRun = Boolean(slideId) && roiReady && !thresholdMessage && !running;

  const run = async () => {
    if (!canRun) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRunning(true);
    setError('');
    try {
      const record = technique === 'clahe'
        ? await dipService.runClahe(slideId, { mode, roi: roiRect, clipLimit, tileGridSize }, controller.signal)
        : technique === 'canny'
          ? await dipService.runCanny(slideId, { mode, roi: roiRect, gaussianKernel: kernel, lowThreshold, highThreshold }, controller.signal)
          : await dipService.runOtsu(slideId, { mode, roi: roiRect, gaussianKernel: kernel }, controller.signal);
      const views = await dipService.loadViews(record, controller.signal);
      if (controller.signal.aborted) {
        Object.values(views).forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      const next = { ...record, overlayUrl: views.enhanced || views.overlay, views };
      setResult(next);
      onResult(next);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Otsu segmentation failed');
    } finally {
      if (requestRef.current === controller) setRunning(false);
    }
  };

  return (
    <aside className="dip-panel" aria-label="Digital image processing">
      <header className="dip-panel__header">
        <div className="dip-panel__title"><Layers size={15} /><strong>Digital Image Processing</strong></div>
        <button type="button" className="btn-panel-close" onClick={onClose} aria-label="Close digital image processing"><X size={15} /></button>
      </header>
      <div className="dip-panel__body">
        <label className="dip-panel__field">
          <span>Technique</span>
          <select value={technique} onChange={(event) => { setTechnique(event.target.value); setResult(null); onClear(); onViewChange(event.target.value === 'clahe' ? 'enhanced' : 'overlay'); }} disabled={running}>
            <option value="otsu">Otsu Tissue Segmentation</option>
            <option value="canny">Canny Edge Detection</option>
            <option value="clahe">CLAHE Image Enhancement</option>
          </select>
        </label>
        <p className="dip-panel__note">{technique === 'canny'
          ? 'Research use only. Canny marks intensity changes. It is not a cell, tissue, or tumor boundary.'
          : technique === 'clahe'
            ? 'Research use only. CLAHE raises local contrast on the lightness channel. It is not a diagnostic improvement.'
            : 'Research use only. This separates darker tissue from background by intensity. It is not tumor or cell detection.'}</p>
        <div className="dip-panel__choices" role="group" aria-label="Processing mode">
          <span>Processing mode</span>
          <label><input type="checkbox" name="dip-mode" value="roi" checked={mode === 'roi'} onChange={() => setMode('roi')} /> Selected ROI</label>
          <label><input type="checkbox" name="dip-mode" value="whole_slide" checked={mode === 'whole_slide'} onChange={() => setMode('whole_slide')} /> Whole slide</label>
        </div>
        {mode === 'whole_slide' ? (
          <p className="dip-panel__roi">Processes the whole-slide tissue footprint at a reduced resolution.</p>
        ) : roiMessage ? (
          <p className="dip-panel__roi">{roiMessage}</p>
        ) : (
          <p className="dip-panel__roi">ROI {width} × {height} px at ({x}, {y})</p>
        )}
        {technique !== 'clahe' && <label className="dip-panel__field">
          <span>Gaussian kernel</span>
          <select value={kernel} onChange={(event) => setKernel(Number(event.target.value))} disabled={running}>
            {KERNELS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>}
        {technique === 'clahe' && (
          <>
            <label className="dip-panel__field">
              <span>Clip limit: {Number(clipLimit).toFixed(1)}</span>
              <input type="range" min="1" max="5" step="0.5" value={clipLimit} onChange={(event) => setClipLimit(Number(event.target.value))} disabled={running} />
            </label>
            <label className="dip-panel__field">
              <span>Tile grid size</span>
              <select value={tileGridSize} onChange={(event) => setTileGridSize(Number(event.target.value))} disabled={running}>
                {[4, 8, 16].map((value) => <option key={value} value={value}>{value} × {value}</option>)}
              </select>
            </label>
          </>
        )}
        {technique === 'canny' && (
          <>
            <label className="dip-panel__field">
              <span>Low threshold: {lowThreshold}</span>
              <input type="range" min="0" max="254" step="1" value={lowThreshold} onChange={(event) => setLowThreshold(Number(event.target.value))} disabled={running} />
            </label>
            <label className="dip-panel__field">
              <span>High threshold: {highThreshold}</span>
              <input type="range" min="1" max="255" step="1" value={highThreshold} onChange={(event) => setHighThreshold(Number(event.target.value))} disabled={running} />
            </label>
            {thresholdMessage && <p className="dip-panel__roi">{thresholdMessage}</p>}
          </>
        )}
        <button type="button" className="btn-primary dip-panel__run" onClick={run} disabled={!canRun}>
          {running ? 'Processing…' : (technique === 'clahe' ? 'Run Enhancement' : technique === 'canny' ? 'Run Edge Detection' : 'Run Segmentation')}
        </button>
        {error && <p className="dip-panel__error" role="alert">{error}</p>}
        {result?.algorithm === 'clahe' ? (
          <dl className="dip-panel__stats">
            <div><dt>Algorithm</dt><dd>CLAHE</dd></div>
            <div><dt>Mode</dt><dd>{result.mode === 'whole_slide' ? 'Whole Slide' : 'Selected ROI'}</dd></div>
            <div><dt>Clip limit</dt><dd>{Number(result.parameters?.clip_limit).toFixed(1)}</dd></div>
            <div><dt>Tile grid</dt><dd>{result.parameters?.tile_grid_size} × {result.parameters?.tile_grid_size}</dd></div>
            <div><dt>L mean</dt><dd>{result.original_luminance_mean} → {result.enhanced_luminance_mean}</dd></div>
            <div><dt>L std</dt><dd>{result.original_luminance_std} → {result.enhanced_luminance_std}</dd></div>
            <div><dt>Resolution</dt><dd>{result.processing?.width}×{result.processing?.height}</dd></div>
            <div><dt>Duration</dt><dd>{Math.round(result.elapsed_ms)} ms</dd></div>
          </dl>
        ) : result?.algorithm === 'canny' ? (
          <dl className="dip-panel__stats">
            <div><dt>Algorithm</dt><dd>Canny</dd></div>
            <div><dt>Mode</dt><dd>{result.mode === 'whole_slide' ? 'Whole Slide' : 'Selected ROI'}</dd></div>
            <div><dt>Edge pixels</dt><dd>{result.edge_pixel_count}</dd></div>
            <div><dt>Edge density</dt><dd>{Number(result.edge_density_percent).toFixed(2)}%</dd></div>
            <div><dt>Resolution</dt><dd>{result.processing?.width}×{result.processing?.height}</dd></div>
            <div><dt>Duration</dt><dd>{Math.round(result.elapsed_ms)} ms</dd></div>
          </dl>
        ) : result && (
          <dl className="dip-panel__stats">
            <div><dt>Algorithm</dt><dd>Otsu</dd></div>
            <div><dt>Threshold</dt><dd>{result.threshold}</dd></div>
            <div><dt>Tissue coverage</dt><dd>{Number(result.tissue_coverage_percent).toFixed(1)}%</dd></div>
            <div><dt>Duration</dt><dd>{Math.round(result.elapsed_ms)} ms</dd></div>
            <div><dt>Foreground px</dt><dd>{result.foreground_pixel_count ?? '—'}</dd></div>
            <div><dt>Background px</dt><dd>{result.background_pixel_count ?? '—'}</dd></div>
            <div><dt>Contours</dt><dd>{result.contour_count ?? '—'}</dd></div>
            <div><dt>Resolution</dt><dd>{result.processing?.width}×{result.processing?.height}</dd></div>
          </dl>
        )}
        {result?.algorithm === 'otsu' && result?.accuracy_note && <p className="dip-panel__note">{result.accuracy_note}</p>}
        <div className="dip-panel__choices" role="group" aria-label="Result visualization" aria-disabled={!result}>
          <span>Result view</span>
          {technique === 'clahe' ? (
            <>
              <label><input type="checkbox" name="dip-view" value="enhanced" checked={view === 'enhanced'} onChange={() => onViewChange('enhanced')} /> Enhanced Image</label>
              <label><input type="checkbox" name="dip-view" value="original" checked={view === 'original'} onChange={() => onViewChange('original')} /> Original Image</label>
              <label><input type="checkbox" name="dip-view" value="comparison" checked={view === 'comparison'} onChange={() => onViewChange('comparison')} /> Side-by-Side Comparison</label>
            </>
          ) : technique === 'canny' ? (
            <>
              <label><input type="checkbox" name="dip-view" value="overlay" checked={view === 'overlay'} onChange={() => onViewChange('overlay')} /> Edge Overlay</label>
              <label><input type="checkbox" name="dip-view" value="mask" checked={view === 'mask'} onChange={() => onViewChange('mask')} /> Binary Edge Map</label>
            </>
          ) : (
            <>
              <label><input type="checkbox" name="dip-view" value="overlay" checked={view === 'overlay'} onChange={() => onViewChange('overlay')} /> Tissue Overlay</label>
              <label><input type="checkbox" name="dip-view" value="mask" checked={view === 'mask'} onChange={() => onViewChange('mask')} /> Binary Mask</label>
              <label><input type="checkbox" name="dip-view" value="contours" checked={view === 'contours'} onChange={() => onViewChange('contours')} /> Tissue Contours</label>
            </>
          )}
        </div>
        <label className="dip-panel__check">
          <input type="checkbox" checked={visible} onChange={(event) => onVisibleChange(event.target.checked)} />
          <span>Show result</span>
        </label>
        <label className="dip-panel__field">
          <span>Opacity: {Math.round(opacity * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(event) => onOpacityChange(Number(event.target.value))} />
        </label>
        <button type="button" className="dip-panel__clear" onClick={() => { setResult(null); onClear(); }} disabled={!result}>Clear result</button>
      </div>
    </aside>
  );
}
