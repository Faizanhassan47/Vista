import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AIListingManager from './AIListingManager';
import { aiSubscriptionService } from '../../services/aiSubscriptionService';
import './ManageAIFeatures.css';

export default function ManageAIFeatures() {
  const [features, setFeatures] = useState([]);
  const [state, setState] = useState({ loading: true, error: '' });
  const [updatingFeatureId, setUpdatingFeatureId] = useState(null);
  const load = useCallback(async (signal) => {
    try { setFeatures(await aiSubscriptionService.adminFeatures(signal)); setState({ loading: false, error: '' }); } catch (error) { if (error.name !== 'AbortError') setState({ loading: false, error: error.message || 'Could not load AI cards' }); }
  }, []);

  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  async function save(feature, values) { await aiSubscriptionService.updateCatalogCard(feature.id, values); await load(); }
  async function remove(feature) { await aiSubscriptionService.updateCatalogCard(feature.id, { is_catalog_visible: false, is_catalog_deleted: true }); await load(); }
  async function toggleFeature(feature) {
    setUpdatingFeatureId(feature.id);
    try {
      await aiSubscriptionService.setFeatureActive(feature.id, !feature.is_active);
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || 'Could not update AI model availability' }));
    } finally {
      setUpdatingFeatureId(null);
    }
  }

  if (state.loading) return <section className="manage-ai-state"><span className="loading-spinner" />Loading AI card configuration…</section>;
  if (state.error) return <section className="manage-ai-state manage-ai-state--error"><h2>AI cards could not be loaded</h2><p>{state.error}</p><button type="button" className="btn-primary" onClick={() => load()}>Try again</button></section>;
  return <AIListingManager features={features} onSave={save} onRemove={remove} onToggleFeature={toggleFeature} updatingFeatureId={updatingFeatureId} />;
}
