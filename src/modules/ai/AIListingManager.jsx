import { useMemo, useState } from 'react';
import { Minus, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { AI_LISTING, modelListing } from './aiListing';
import './AIListingManager.css';

const DEFAULT_USD_TO_PKR_RATE = 280;
const EMPTY = { featureId: '', title: '', category: '', summary: '', purpose: '', value: '', outputs: [''], isVisible: true, displayOrder: 0, sessionPriceUsd: '', usdToPkrRate: DEFAULT_USD_TO_PKR_RATE };
const isDeleted = (feature) => feature.is_catalog_deleted === true || feature.is_catalog_deleted === 1 || feature.is_catalog_deleted === '1';
const isConfigured = (feature) => !isDeleted(feature) && Boolean(feature.catalog_title);

function formFor(feature) {
  if (!feature) return EMPTY;
  const detail = modelListing(feature);
  return { featureId: String(feature.id), title: feature.catalog_title || feature.feature_name, category: detail.category, summary: detail.summary, purpose: detail.purpose, value: detail.value, outputs: detail.outputs.length ? detail.outputs : [''], isVisible: feature.is_catalog_visible !== false && feature.is_catalog_visible !== 0, displayOrder: Number(feature.catalog_display_order || 0), sessionPriceUsd: feature.catalog_session_price_usd ?? '', usdToPkrRate: feature.catalog_usd_to_pkr_rate ?? DEFAULT_USD_TO_PKR_RATE };
}

export default function AIListingManager({ features, onSave, onRemove, onToggleFeature, updatingFeatureId }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const selected = useMemo(() => features.find((feature) => String(feature.id) === String(form?.featureId)), [features, form?.featureId]);
  const configured = useMemo(() => features.filter(isConfigured).sort((first, second) => Number(first.catalog_display_order || 0) - Number(second.catalog_display_order || 0)), [features]);
  const available = useMemo(() => features.filter((feature) => !isConfigured(feature) || String(feature.id) === String(form?.featureId)), [features, form?.featureId]);
  const sessionPricePkr = (Number(form?.sessionPriceUsd) || 0) * (Number(form?.usdToPkrRate) || 0);

  function startAdd() { setForm({ ...EMPTY, displayOrder: configured.length + 1 }); }
  function updateOutput(index, value) { setForm((current) => ({ ...current, outputs: current.outputs.map((output, outputIndex) => outputIndex === index ? value : output) })); }
  function removeOutput(index) { setForm((current) => ({ ...current, outputs: current.outputs.filter((_, outputIndex) => outputIndex !== index) })); }

  async function submit(event) {
    event.preventDefault();
    if (!selected) return;
    const outputs = form.outputs.map((item) => item.trim()).filter(Boolean);
    if (!outputs.length) { toast.error('Add at least one capability'); return; }
    setSaving(true);
    try {
      await onSave(selected, { catalog_title: form.title.trim(), catalog_category: form.category.trim(), catalog_summary: form.summary.trim(), catalog_purpose: form.purpose.trim(), catalog_value: form.value.trim(), catalog_outputs: outputs, catalog_display_order: Number(form.displayOrder), is_catalog_visible: form.isVisible, is_catalog_deleted: false, catalog_session_price_usd: Number(form.sessionPriceUsd), catalog_usd_to_pkr_rate: Number(form.usdToPkrRate) });
      toast.success(`${form.title.trim()} saved`);
      setForm(null);
    } catch (error) { toast.error(error.message || 'Could not save the AI card'); } finally { setSaving(false); }
  }

  async function removeCard(feature) {
    if (!window.confirm(`Remove the ${feature.catalog_title || feature.feature_name} card? The AI integration and subscriptions will remain unchanged.`)) return;
    setSaving(true);
    try { await onRemove(feature); toast.success('Card removed from the AI Features page'); if (String(form?.featureId) === String(feature.id)) setForm(null); } catch (error) { toast.error(error.message || 'Could not remove the AI card'); } finally { setSaving(false); }
  }

  return <section className="ai-listing-manager" aria-labelledby="ai-listing-manager-title">
    <header className="ai-listing-manager__heading"><div><p className="page-eyebrow">Super Administrator</p><h2 id="ai-listing-manager-title">Manage AI Features</h2><p>Configure the cards users see without changing AI integrations, seats, or subscriptions.</p></div><button type="button" className="btn-primary" onClick={startAdd}><Plus size={16} />Add AI card</button></header>
    <section className="ai-listing-manager__cards" aria-label="Configured AI cards">{configured.map((feature) => { const detail = modelListing(feature); const active = Boolean(feature.is_active); return <article key={feature.id}><div><span>{feature.is_catalog_visible ? 'Visible' : 'Hidden'} · Order {feature.catalog_display_order || 0}</span><h3>{detail.title}</h3><p>{detail.summary}</p><ul>{detail.outputs.map((output) => <li key={output}>{output}</li>)}</ul></div><div className="ai-listing-manager__card-actions"><span className={`ai-listing-manager__availability${active ? ' ai-listing-manager__availability--active' : ''}`} role="status">{active ? 'Enabled platform-wide' : 'Disabled platform-wide'}</span><button type="button" className={active ? 'btn-control-secondary' : 'btn-primary'} disabled={saving || updatingFeatureId === feature.id} onClick={() => onToggleFeature(feature)}>{updatingFeatureId === feature.id ? 'Updating…' : active ? 'Disable model' : 'Enable model'}</button><button type="button" className="btn-control-secondary" onClick={() => setForm(formFor(feature))}><Pencil size={14} />Edit</button><button type="button" className="btn-delete" disabled={saving} onClick={() => removeCard(feature)}><Trash2 size={14} />Remove</button></div></article>; })}{!configured.length && <div className="ai-listing-manager__empty"><h3>No AI cards configured</h3><p>Add a card to make an integrated AI feature visible in the AI Features catalog.</p></div>}</section>
    {form && <form className="ai-listing-form" onSubmit={submit}>
      <header><h3>{isConfigured(selected || {}) ? 'Edit AI card' : 'Add AI card'}</h3><button type="button" className="btn-control-secondary" onClick={() => setForm(null)}><X size={15} />Close</button></header>
      <label className="ai-listing-form__wide">AI integration<select required value={form.featureId} onChange={(event) => setForm(formFor(features.find((feature) => String(feature.id) === event.target.value)))}><option value="">Select an AI integration</option>{available.map((feature) => { const registry = AI_LISTING.find((item) => item.code === feature.feature_code); return <option key={feature.id} value={feature.id}>{registry?.name || feature.feature_name}{isConfigured(feature) ? ' — editing current card' : ''}</option>; })}</select><small>Each integration can have one card. Removed cards become available here again.</small></label>
      <label>Card title<input required maxLength="160" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label>Category<input required maxLength="80" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
      <label className="ai-listing-form__wide">Card description<textarea required maxLength="500" rows="3" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
      <label>What this model does<textarea required maxLength="1000" rows="3" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></label>
      <label>Why it is useful<textarea required maxLength="1000" rows="3" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></label>
      <label>Session price (USD)<input required type="number" min="0" step="0.01" value={form.sessionPriceUsd} onChange={(event) => setForm({ ...form, sessionPriceUsd: event.target.value })} placeholder="0.00" /></label>
      <label>USD to PKR rate<input required type="number" min="0.01" step="0.0001" value={form.usdToPkrRate} onChange={(event) => setForm({ ...form, usdToPkrRate: event.target.value })} /><small>Used to calculate the PKR price below.</small></label>
      <label>Session price (PKR)<input className="ai-listing-form__calculated-price" readOnly value={`PKR ${sessionPricePkr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} /><small>Calculated automatically from the USD price and exchange rate.</small></label>
      <fieldset className="ai-listing-form__wide"><legend>Capabilities</legend>{form.outputs.map((output, index) => <div className="ai-listing-form__capability" key={`${index}-${output}`}><input required value={output} onChange={(event) => updateOutput(index, event.target.value)} placeholder="e.g. Nuclei detection" /><button type="button" className="btn-control-secondary" aria-label={`Remove capability ${index + 1}`} disabled={form.outputs.length === 1} onClick={() => removeOutput(index)}><Minus size={15} /></button></div>)}<button type="button" className="btn-control-secondary" onClick={() => setForm((current) => ({ ...current, outputs: [...current.outputs, ''] }))}><Plus size={15} />Add capability</button></fieldset>
      <label>Display order<input type="number" min="0" max="10000" value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: event.target.value })} /></label>
      <label className="ai-listing-form__toggle"><input type="checkbox" checked={form.isVisible} onChange={(event) => setForm({ ...form, isVisible: event.target.checked })} /><span>Visible on AI Features page</span></label>
      <div className="ai-listing-form__actions"><button className="btn-primary" disabled={!selected || saving}><Save size={15} />{saving ? 'Saving…' : 'Save AI card'}</button></div>
    </form>}
  </section>;
}
