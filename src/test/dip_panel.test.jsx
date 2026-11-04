import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ViewerToolbar from '../components/WsiViewer/ViewerToolbar';
import DipProcessingPanel from '../components/WsiViewer/DipProcessingPanel';
import { claheUsesTiles } from '../services/dipService';

vi.mock('../services/dipService', async () => {
  const actual = await vi.importActual('../services/dipService');
  return {
    ...actual,
    dipService: { runOtsu: vi.fn(), runCanny: vi.fn(), runClahe: vi.fn(), loadOverlay: vi.fn(), loadViews: vi.fn() },
  };
});

const toolbarProps = {
  onFit: vi.fn(),
  onReset: vi.fn(),
  onRotateCw: vi.fn(),
  onRotateCcw: vi.fn(),
  onFlipH: vi.fn(),
  onFlipV: vi.fn(),
  showAdjustments: false,
  onToggleAdjustments: vi.fn(),
  showDip: false,
  onToggleDip: vi.fn(),
  onToggleTrail: vi.fn(),
  annotationsVisible: true,
  onToggleAnnotations: vi.fn(),
  onToggleFullscreen: vi.fn(),
  drawMode: null,
  setDrawMode: vi.fn(),
};

describe('DIP controls', () => {
  it('uses sharper CLAHE tiles only after the overview would be enlarged', () => {
    expect(claheUsesTiles(8, 32)).toBe(true);
    expect(claheUsesTiles(40, 32)).toBe(false);
  });

  it('toggles the DIP panel from the toolbar', () => {
    render(<ViewerToolbar {...toolbarProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Digital image processing' }));
    expect(toolbarProps.onToggleDip).toHaveBeenCalled();
  });

  it('disables segmentation until a valid ROI is selected', () => {
    render(<DipProcessingPanel slideId={1} roiRect={null} visible opacity={0.6} onVisibleChange={vi.fn()} onOpacityChange={vi.fn()} onResult={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Run Segmentation' })).toBeDisabled();
  });

  it('enables whole-slide segmentation without an ROI', () => {
    render(<DipProcessingPanel slideId={1} roiRect={null} visible opacity={0.6} onVisibleChange={vi.fn()} onOpacityChange={vi.fn()} onResult={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Whole Slide' }));
    expect(screen.getByRole('button', { name: 'Run Segmentation' })).toBeEnabled();
  });

  it('shows Canny thresholds only for Canny and does not rerun when the view changes', async () => {
    const { dipService } = await import('../services/dipService');
    dipService.runCanny.mockResolvedValueOnce({ algorithm: 'canny', mode: 'roi', overlay_url: '/overlay', views: { overlay: '/overlay', mask: '/mask' }, edge_pixel_count: 40, edge_density_percent: 1.25, elapsed_ms: 12, processing: { width: 80, height: 40 } });
    dipService.loadViews.mockResolvedValueOnce({ overlay: 'blob:/overlay', mask: 'blob:/mask' });
    const onViewChange = vi.fn();
    render(<DipProcessingPanel slideId={1} roiRect={{ x: 0, y: 0, width: 256, height: 256 }} visible opacity={0.65} view="overlay" onViewChange={onViewChange} onVisibleChange={vi.fn()} onOpacityChange={vi.fn()} onResult={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/Low threshold/)).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'canny' } });
    expect(screen.getByText(/Low threshold/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run Edge Detection' }));
    expect(await screen.findByText('40')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Binary Edge Map' }));
    expect(dipService.runCanny).toHaveBeenCalledTimes(1);
    expect(dipService.runOtsu).not.toHaveBeenCalled();
    expect(onViewChange).toHaveBeenCalledWith('mask');
  });

  it('switches CLAHE views without running enhancement again', async () => {
    const { dipService } = await import('../services/dipService');
    dipService.runClahe.mockResolvedValueOnce({ algorithm: 'clahe', mode: 'whole_slide', parameters: { clip_limit: 2, tile_grid_size: 8 }, views: { enhanced: '/enhanced', comparison: '/comparison' }, original_luminance_mean: 40, enhanced_luminance_mean: 55, original_luminance_std: 10, enhanced_luminance_std: 18, elapsed_ms: 20, processing: { width: 100, height: 80 } });
    dipService.loadViews.mockResolvedValueOnce({ enhanced: 'blob:/enhanced', comparison: 'blob:/comparison' });
    const onViewChange = vi.fn();
    render(<DipProcessingPanel slideId={1} roiRect={null} visible opacity={0.65} view="enhanced" onViewChange={onViewChange} onVisibleChange={vi.fn()} onOpacityChange={vi.fn()} onResult={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'clahe' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Whole Slide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run Enhancement' }));
    expect(await screen.findByText('CLAHE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Original Image' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Side-by-Side Comparison' }));
    expect(dipService.runClahe).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith('original');
    expect(onViewChange).toHaveBeenCalledWith('comparison');
  });

  it('switches visualization without running segmentation again', async () => {
    const { dipService } = await import('../services/dipService');
    dipService.runOtsu.mockResolvedValueOnce({ overlay_url: '/overlay', views: { overlay: '/overlay', mask: '/mask', contours: '/contours' }, threshold: 160, tissue_coverage_percent: 21.9, elapsed_ms: 74, processing: { width: 100, height: 80 } });
    dipService.loadViews.mockResolvedValueOnce({ overlay: 'blob:/overlay', mask: 'blob:/mask', contours: 'blob:/contours' });
    const onViewChange = vi.fn();
    render(<DipProcessingPanel slideId={1} roiRect={{ x: 0, y: 0, width: 256, height: 256 }} visible opacity={0.65} view="overlay" onViewChange={onViewChange} onVisibleChange={vi.fn()} onOpacityChange={vi.fn()} onResult={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run Segmentation' }));
    expect(await screen.findByText('160')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Binary Mask' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Tissue Contours' }));
    expect(dipService.runOtsu).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith('mask');
    expect(onViewChange).toHaveBeenCalledWith('contours');
  });

  it('shows an error returned by the segmentation request', async () => {
    const { dipService } = await import('../services/dipService');
    dipService.runOtsu.mockRejectedValueOnce(new Error('ROI extends beyond slide boundaries'));
    render(<DipProcessingPanel slideId={1} roiRect={{ x: 0, y: 0, width: 256, height: 256 }} visible opacity={0.6} onVisibleChange={vi.fn()} onOpacityChange={vi.fn()} onResult={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run Segmentation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ROI extends beyond slide boundaries');
  });
});
