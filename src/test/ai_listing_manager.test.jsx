import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AIListingManager from '../modules/ai/AIListingManager';

const hoverNet = {
  id: 1,
  feature_code: 'HOVERNET',
  feature_name: 'HoVer-Net',
  description: 'Nuclei analysis',
  catalog_title: 'HoVer-Net Nuclei Analysis',
  catalog_session_price_usd: 10,
  catalog_usd_to_pkr_rate: 280,
  catalog_session_price_pkr: 2800,
  is_catalog_visible: true,
  is_featured: false,
};

describe('AIListingManager', () => {
  it('edits one published model card instead of creating a duplicate', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AIListingManager features={[hoverNet]} onSave={onSave} onRemove={vi.fn()} />);

    expect(screen.getByText('HoVer-Net Nuclei Analysis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('combobox', { name: /ai integration/i })).toHaveValue('1');
    expect(screen.getByText(/one card/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Session price \(PKR\)/)).toHaveValue('PKR 2,800.00');

    fireEvent.change(screen.getByLabelText('Session price (USD)'), { target: { value: '12.50' } });
    expect(screen.getByLabelText(/Session price \(PKR\)/)).toHaveValue('PKR 3,500.00');

    fireEvent.click(screen.getByRole('button', { name: /save ai card/i }));
    expect(onSave).toHaveBeenCalledWith(hoverNet, expect.objectContaining({ is_catalog_visible: true }));
  });

  it('lets a super administrator remove a published card', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AIListingManager features={[hoverNet]} onSave={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(onRemove).toHaveBeenCalledWith(hoverNet);
    window.confirm.mockRestore();
  });

  it('allows a super administrator to enable a globally disabled model', () => {
    const disabledModel = { ...hoverNet, is_active: false };
    const onToggleFeature = vi.fn();
    render(<AIListingManager features={[disabledModel]} onSave={vi.fn()} onRemove={vi.fn()} onToggleFeature={onToggleFeature} />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable model' }));
    expect(onToggleFeature).toHaveBeenCalledWith(disabledModel);
  });
});
