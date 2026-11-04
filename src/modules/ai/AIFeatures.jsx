import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Microscope, Search, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { aiSubscriptionService } from '../../services/aiSubscriptionService';
import FilterBar from '../../components/FilterBar/FilterBar';
import Pagination from '../../components/Pagination/Pagination';
import { modelListing } from './aiListing';
import './AIFeatures.css';

function accessState(feature, subscription) {
  if (!feature.is_implemented) return { key: 'soon', label: 'Coming soon', message: 'The model is listed for planning but cannot run yet.' };
  if (!feature.is_active) return { key: 'disabled', label: 'Disabled', message: 'This model is currently unavailable across the platform.' };
  if (feature.is_entitled) return { key: 'available', label: 'Available to you', message: 'Your account is licensed to use this model.' };
  if (subscription?.status === 'Expired') return { key: 'expired', label: 'Subscription expired', message: 'Ask your administrator to renew access.' };
  if (subscription?.status === 'Suspended') return { key: 'suspended', label: 'Subscription suspended', message: 'Access is temporarily suspended.' };
  return { key: 'required', label: 'Access required', message: 'Request a model seat from your laboratory administrator.' };
}

export default function AIFeatures() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All models');
  const [updatingPreferenceId, setUpdatingPreferenceId] = useState(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    const controller = new AbortController();
    aiSubscriptionService.entitlements(controller.signal)
      .then((result) => { setData(result); setError(''); })
      .catch((requestError) => requestError.name !== 'AbortError' && setError(requestError.message));
    return () => controller.abort();
  }, []);

  const models = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.features || []).filter((feature) => {
      if (!feature.catalog_title || feature.is_catalog_visible === false || feature.is_catalog_visible === 0 || feature.is_catalog_deleted === true || feature.is_catalog_deleted === 1) return false;
      const detail = modelListing(feature);
      const state = accessState(feature, data?.subscription);
      const matchesQuery = !normalizedQuery || `${feature.feature_name} ${detail.category} ${detail.summary} ${detail.purpose}`.toLowerCase().includes(normalizedQuery);
      const matchesFilter = filter === 'All models'
        || (filter === 'Available' && state.key === 'available')
        || (filter === 'Coming soon' && state.key === 'soon')
        || (filter === 'Needs access' && ['required', 'expired', 'suspended'].includes(state.key));
      return matchesQuery && matchesFilter;
    });
  }, [data, filter, query]);

  const visibleFeatures = (data?.features || []).filter((feature) => feature.catalog_title && feature.is_catalog_visible !== false && feature.is_catalog_visible !== 0 && feature.is_catalog_deleted !== true && feature.is_catalog_deleted !== 1);
  const searchSuggestions = useMemo(() => {
    const values = visibleFeatures.flatMap((feature) => {
      const detail = modelListing(feature);
      return [feature.feature_name, detail.category, detail.summary, detail.purpose];
    }).filter((value) => value !== null && value !== undefined && String(value).trim());
    return [...new Set(values.map(String))];
  }, [visibleFeatures]);
  const availableCount = visibleFeatures.filter((feature) => accessState(feature, data?.subscription).key === 'available').length;
  const comingSoonCount = visibleFeatures.filter((feature) => !feature.is_implemented).length;

  async function updatePreference(feature, isEnabled) {
    setUpdatingPreferenceId(feature.id);
    try {
      setData(await aiSubscriptionService.setMyFeaturePreference(feature.id, isEnabled));
      setError('');
      toast.success(`${feature.feature_name} ${isEnabled ? 'added to' : 'removed from'} your workspace`);
    } catch (updateError) {
      const message = updateError.message || 'Could not update your model preference';
      setError(message);
      toast.error(message);
    } finally {
      setUpdatingPreferenceId(null);
    }
  }

  return <main className="ai-store" id="main-content">
    <FilterBar layout="toolbar" fields={[
      { label: 'Search AI models', type: 'text', value: query, onChange: setQuery, placeholder: 'Search models or clinical purpose', suggestions: searchSuggestions },
      { label: 'Model availability', type: 'select', value: filter, onChange: setFilter, options: ['All models', 'Available', 'Coming soon', 'Needs access'].map((value) => ({ value, label: value })) },
    ]} />

    {error && <div className="ai-store__error" role="alert"><strong>AI catalog could not be updated.</strong><span>{error}</span></div>}
    {!data && !error && <div className="ai-store__loading"><span className="loading-spinner" /> Loading the AI model catalog…</div>}

    {data && <section className="ai-store__grid" aria-label="AI model catalog">
      {models.slice(page * pageSize, page * pageSize + pageSize).map((feature) => {
        const detail = modelListing(feature);
        const Icon = detail.icon;
        const state = accessState(feature, data.subscription);
        const isAvailable = state.key === 'available';
        const canChoose = Boolean(feature.is_entitled && feature.is_active && feature.is_implemented);
        return <article className={`ai-model-card${detail.featured ? ' ai-model-card--featured' : ''}`} key={feature.feature_code}>
          <div className="ai-model-card__header">
            <span className="ai-model-card__icon"><Icon size={24} /></span>
            <div className="ai-model-card__identity"><span>{detail.category}</span><h2>{detail.title}</h2><p>{detail.summary}</p></div>
            <span className={`ai-model-state ai-model-state--${state.key}`}>{state.label}</span>
          </div>
          <div className="ai-model-card__content"><section><h3>Clinical purpose</h3><p>{detail.purpose}</p></section><section><h3>Clinical value</h3><p>{detail.value}</p></section></div>
          <div className="ai-model-card__outputs"><span>Capabilities</span><ul>{detail.outputs.map((output) => <li key={output}><Check size={13} />{output}</li>)}</ul></div>
          <footer className="ai-model-card__footer"><div className="ai-model-card__access"><span className={`ai-model-card__access-dot ai-model-card__access-dot--${state.key}`} /><p><strong>{state.label}</strong><small>{state.message}</small></p></div><div className="ai-model-card__actions">{feature.catalog_session_price_usd != null && <span className="ai-model-card__price">Per session <strong>USD {Number(feature.catalog_session_price_usd).toFixed(2)}</strong><small>PKR {Number(feature.catalog_session_price_pkr).toLocaleString(undefined, { maximumFractionDigits: 2 })}</small></span>}{!isAvailable && <button type="button" className="ai-model-card__primary" disabled>{state.key === 'soon' ? 'Not yet available' : state.key === 'disabled' ? 'Disabled' : 'Access required'}</button>}{canChoose && <label className="ai-model-preference"><span>Use in workspace</span><input type="checkbox" checked={Boolean(feature.user_enabled)} disabled={updatingPreferenceId === feature.id} onChange={(event) => updatePreference(feature, event.target.checked)} /><span className="ai-switch" aria-hidden="true" /></label>}</div></footer>
        </article>;
      })}
      {!models.length && <div className="ai-store__empty"><Search size={24} /><h2>No matching models</h2><p>Try a different search phrase or availability filter.</p><button type="button" className="btn-control-secondary" onClick={() => { setQuery(''); setFilter('All models'); }}>Clear filters</button></div>}
      <Pagination page={page} pageSize={pageSize} total={models.length} onPageChange={setPage} label="AI model pages" />
    </section>}
  </main>;
}

