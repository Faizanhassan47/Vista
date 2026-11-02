import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAuditEvents } from '../../services/auditService';
import {
  getDeviceLocation,
  getDeviceName,
  setDeviceLocation,
  setDeviceName,
  detectGeolocation,
} from '../../services/deviceService';
import Modal from '../Modal/Modal';
import Field from '../Field/Field';
import FilterBar from '../FilterBar/FilterBar';
import { auditCategories, describeAuditEvent } from './activityLog';
import './AdministrationLogs.css';

export default function AdministrationLogs() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const [deviceLoc, setDeviceLoc] = useState(() => getDeviceLocation());
  const [devName, setDevName] = useState(() => getDeviceName());
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [customLocation, setCustomLocation] = useState(deviceLoc);
  const [customName, setCustomName] = useState(devName);

  const load = useCallback(async (signal) => {
    try { setEvents(await getAuditEvents({ signal })); }
    catch (error) { if (error.name !== 'AbortError') toast.error(error.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- the state update occurs after the cancellable request resolves.
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const handleDeviceChange = () => {
      setDeviceLoc(getDeviceLocation());
      setDevName(getDeviceName());
    };
    window.addEventListener('prs:device-info-changed', handleDeviceChange);
    return () => window.removeEventListener('prs:device-info-changed', handleDeviceChange);
  }, []);

  const refresh = () => {
    setLoading(true);
    load();
  };

  const handleSaveDeviceConfig = (event) => {
    event.preventDefault();
    setDeviceLocation(customLocation);
    setDeviceName(customName);
    setShowConfigModal(false);
    toast.success('Workstation location updated. New activity will be recorded with this location.');
  };

  const handleAutoDetect = () => {
    detectGeolocation((detected) => {
      setCustomLocation(detected);
      toast.success(`Detected location: ${detected}`);
    });
  };

  const categories = useMemo(() => auditCategories(events), [events]);
  const searchSuggestions = useMemo(() => {
    const values = events.flatMap((event) => {
      const description = describeAuditEvent(event);
      return [event.actor_username, description.title, description.explanation, event.target_id, event.ip_address, event.device_location, event.device_name];
    }).filter((value) => value !== null && value !== undefined && String(value).trim());
    return [...new Set(values.map(String))];
  }, [events]);
  const visibleEvents = useMemo(() => events.filter((event) => {
    const description = describeAuditEvent(event);
    const matchesCategory = category === 'All' || description.category === category;
    const searchable = `${event.actor_username} ${description.title} ${description.explanation} ${event.target_id} ${event.ip_address || ''} ${event.device_location || ''} ${event.device_name || ''}`.toLowerCase();
    return matchesCategory && searchable.includes(query.trim().toLowerCase());
  }), [category, events, query]);

  return <section className="activity-log" aria-labelledby="activity-log-title">
    <div className="activity-log-intro">
      <div>
        <p className="page-eyebrow">System history</p>
        <h2 id="activity-log-title">Application activity</h2>
        <p>See who did what, when it happened, and which record was affected.</p>
      </div>
      <button type="button" className="btn-control-secondary activity-refresh" onClick={refresh} disabled={loading}>
        <RefreshCw size={15} /> {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>
    <div className="activity-summary" aria-label="Activity summary">
      <article>
        <Activity size={18} />
        <div>
          <span>Events shown</span>
          <strong>{visibleEvents.length}</strong>
        </div>
      </article>
      <article>
        <ShieldCheck size={18} />
        <div>
          <span>Audit protection</span>
          <strong>Enabled</strong>
        </div>
      </article>
      <article className="activity-summary-device">
        <MapPin size={18} />
        <div className="activity-summary-device-info">
          <span>This workstation</span>
          <strong title={deviceLoc}>{deviceLoc}</strong>
          <small>{devName}</small>
        </div>
        <button
          type="button"
          className="btn-control-secondary btn-station-configure"
          onClick={() => {
            setCustomLocation(getDeviceLocation());
            setCustomName(getDeviceName());
            setShowConfigModal(true);
          }}
        >
          Configure
        </button>
      </article>
    </div>
    <FilterBar layout="toolbar" fields={[
      { label: 'Search activity', type: 'text', value: query, onChange: setQuery, placeholder: 'Search people, actions, IP or records', suggestions: searchSuggestions },
      { label: 'Activity type', type: 'select', value: category, onChange: setCategory, options: [{ value: 'All', label: 'All' }, ...categories.map((item) => ({ value: item, label: item }))] },
    ]} />
    <div className="activity-table-wrap">
      <table className="activity-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What happened</th>
            <th>Area</th>
            <th>Device IP</th>
            <th>Device location</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {visibleEvents.map((event) => {
            const description = describeAuditEvent(event);
            return <tr key={event.id}>
              <td><time dateTime={event.created_at}>{event.created_at ? new Date(event.created_at).toLocaleString() : 'Time unavailable'}</time></td>
              <td><strong>{event.actor_username || 'System'}</strong></td>
              <td><strong>{description.title}</strong><span>{description.explanation}</span></td>
              <td><span className="activity-category">{description.category}</span></td>
              <td><span className="activity-ip">{event.ip_address || '—'}</span></td>
              <td>
                <div className="activity-location-cell">
                  <span className="activity-location">{event.device_location || '—'}</span>
                  {event.device_name && event.device_name !== 'Workstation' && (
                    <small className="activity-device-subtext">{event.device_name}</small>
                  )}
                </div>
              </td>
              <td><span className="activity-outcome">{description.outcome}</span></td>
            </tr>;
          })}
          {!loading && visibleEvents.length === 0 && <tr><td colSpan="7" className="activity-empty">No activity matches these filters.</td></tr>}
          {loading && <tr><td colSpan="7" className="activity-empty">Loading application activity…</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="activity-help">This page shows recorded security and record-changing actions, including device IP and location. It does not display passwords, access tokens, or patient image contents.</p>

    <Modal
      open={showConfigModal}
      title="Configure Workstation & Location"
      onClose={() => setShowConfigModal(false)}
      footer={
        <>
          <button type="button" className="modal-button modal-button--secondary" onClick={() => setShowConfigModal(false)}>
            Cancel
          </button>
          <button type="submit" form="device-location-form" className="modal-button btn-primary">
            Save settings
          </button>
        </>
      }
    >
      <form id="device-location-form" onSubmit={handleSaveDeviceConfig} className="device-config-form">
        <p className="device-config-desc">
          Specify the identifier and physical location for this workstation (e.g. Pathology Suite, Grossing Station 2). This metadata is attached to all security audits and data changes.
        </p>
        <Field label="Workstation name">
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="e.g. Path-Lab-WS-01"
            maxLength={120}
          />
        </Field>
        <Field label="Device location">
          <input
            value={customLocation}
            onChange={(e) => setCustomLocation(e.target.value)}
            placeholder="e.g. Pathology Lab 1 - Grossing Room"
            maxLength={200}
          />
        </Field>
        <div className="device-config-actions">
          <button type="button" className="btn-control-secondary" onClick={handleAutoDetect}>
            <MapPin size={14} /> Detect browser location
          </button>
        </div>
      </form>
    </Modal>
  </section>;
}

