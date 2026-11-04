import { useEffect, useMemo, useState } from 'react';
import { Building2, CreditCard, KeyRound, Users } from 'lucide-react';
import { aiSubscriptionService } from '../../services/aiSubscriptionService';
import ReferenceTable from '../../components/ReferenceTable/ReferenceTable';
import './AILicensing.css';

export default function AILicensing() {
  const [laboratories, setLaboratories] = useState([]);
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [selectedLaboratory, setSelectedLaboratory] = useState('');
  const [state, setState] = useState({ loading: true, error: '' });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([aiSubscriptionService.laboratories(controller.signal), aiSubscriptionService.plans(controller.signal)])
      .then(([labRows, planRows]) => {
        setLaboratories(labRows);
        setPlans(planRows);
        setSelectedLaboratory((current) => current || String(labRows[0]?.id || ''));
        setState({ loading: false, error: '' });
      })
      .catch((error) => error.name !== 'AbortError' && setState({ loading: false, error: error.message }));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedLaboratory) return undefined;
    const controller = new AbortController();
    aiSubscriptionService.laboratorySubscriptions(selectedLaboratory, controller.signal)
      .then(setSubscriptions)
      .catch((error) => error.name !== 'AbortError' && setState((current) => ({ ...current, error: error.message })));
    return () => controller.abort();
  }, [selectedLaboratory]);

  const totals = useMemo(() => subscriptions.reduce((result, item) => ({
    purchased: result.purchased + item.seat_quantity,
    assigned: result.assigned + item.assigned_seats,
    available: result.available + item.available_seats,
  }), { purchased: 0, assigned: 0, available: 0 }), [subscriptions]);

  if (state.loading) return <section className="ai-license-state">Loading laboratory licensing…</section>;

  return <section className="ai-license-panel" aria-labelledby="ai-license-title">
    <header className="ai-license-header">
      <p id="ai-license-title">Monitor licensed features and allocated user seats.</p>
      <label>Laboratory<select value={selectedLaboratory} onChange={(event) => setSelectedLaboratory(event.target.value)}><option value="">Select laboratory</option>{laboratories.map((lab) => <option key={lab.id} value={lab.id}>{lab.laboratory_name}</option>)}</select></label>
    </header>
    {state.error && <div className="ai-license-error" role="alert">{state.error}</div>}
    <div className="ai-license-summary">
      <article><Building2 /><span>Laboratories</span><strong>{laboratories.length}</strong></article>
      <article><KeyRound /><span>Purchased seats</span><strong>{totals.purchased}</strong></article>
      <article><Users /><span>Assigned seats</span><strong>{totals.assigned}</strong></article>
      <article><CreditCard /><span>Available seats</span><strong>{totals.available}</strong></article>
    </div>
    <ReferenceTable showOpen={false} rows={subscriptions} rowKey={(item) => item.id} empty="No laboratory AI subscriptions are configured." columns={[
      { key: 'feature', label: 'AI feature', render: (item) => item.feature_name },
      { key: 'plan', label: 'Plan', render: (item) => item.plan_name || 'Complimentary grant' },
      { key: 'purchased', label: 'Purchased', render: (item) => item.seat_quantity },
      { key: 'assigned', label: 'Assigned', render: (item) => item.assigned_seats },
      { key: 'available', label: 'Available', render: (item) => item.available_seats },
      { key: 'expiry', label: 'Expiry', render: (item) => new Date(item.end_date).toLocaleDateString() },
      { key: 'status', label: 'Status', render: (item) => item.status },
    ]} />
    {!plans.length && <p className="ai-license-notice">No purchasable plans are configured. A Super Administrator must define pricing before checkout can be enabled.</p>}
  </section>;
}
