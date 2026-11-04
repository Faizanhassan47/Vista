import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
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
import ReferenceTable from '../ReferenceTable/ReferenceTable';
import Pagination from '../Pagination/Pagination';
import { auditCategories, describeAuditEvent } from './activityLog';
import './AdministrationLogs.css';
import '../../modules/cases/CaseLibrary.css';

export default function AdministrationLogs() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [actor, setActor] = useState('');
  const [category, setCategory] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [location, setLocation] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

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
    const matches = (value, term) => !term.trim() || String(value || '').toLowerCase().includes(term.trim().toLowerCase());
    const createdAt = event.created_at ? new Date(event.created_at) : null;
    const createdTime = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null;
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toExclusive = dateTo ? new Date(`${dateTo}T00:00:00`).getTime() + 86400000 : null;
    const searchable = `${description.title} ${description.explanation} ${event.target_id || ''} ${event.ip_address || ''} ${event.device_location || ''}`;
    return (category === 'All' || description.category === category)
      && matches(event.actor_username, actor)
      && matches(searchable, query)
      && matches(event.device_location, location)
      && matches(event.ip_address, ipAddress)
      && (!dateFrom || (createdTime !== null && createdTime >= fromTime))
      && (!dateTo || (createdTime !== null && createdTime < toExclusive));
  }), [actor, category, dateFrom, dateTo, events, ipAddress, location, query]);
  const pageEvents = visibleEvents.slice(page * pageSize, page * pageSize + pageSize);

  return <section className="activity-log case-library" aria-labelledby="activity-log-title">
    <div className="case-library__create-row"><button type="button" className="case-library__create-reference" onClick={() => { setCustomLocation(getDeviceLocation()); setCustomName(getDeviceName()); setShowConfigModal(true); }}>+ Configure Workstation</button></div>
    <FilterBar title="Select Activity" layout="case-reference" fields={[
      { label: 'User', value: actor, onChange: setActor, suggestions: searchSuggestions },
      { label: 'Activity', value: query, onChange: setQuery, suggestions: searchSuggestions },
      { label: 'Location', value: location, onChange: setLocation, suggestions: searchSuggestions },
      { label: 'Device IP', value: ipAddress, onChange: setIpAddress, suggestions: searchSuggestions },
      { label: 'Dated', type: 'dateRange', from: dateFrom, to: dateTo, onFromChange: setDateFrom, onToChange: setDateTo },
      { label: 'Area', type: 'select', value: category, onChange: setCategory, options: [{ value: 'All', label: '--- Select ---' }, ...categories.map((item) => ({ value: item, label: item }))] },
    ]} />
    <div className="case-library__layout case-library__layout--worklist">
      <section>
        <ReferenceTable loading={loading} rows={pageEvents} rowKey={(event) => event.id} showOpen={false} empty="No activity found." columns={[
          { key: 'sr', label: 'Sr. #', render: (_, index) => page * pageSize + index + 1 },
          { key: 'when', label: 'When', render: (event) => event.created_at ? new Date(event.created_at).toLocaleString() : 'Not recorded' },
          { key: 'user', label: 'User', render: (event) => event.actor_username || 'System' },
          { key: 'activity', label: 'Activity', render: (event) => describeAuditEvent(event).title },
          { key: 'area', label: 'Area', render: (event) => describeAuditEvent(event).category },
          { key: 'ip', label: 'Device IP', render: (event) => event.ip_address || 'Not recorded' },
          { key: 'location', label: 'Location', render: (event) => event.device_location || devName || 'Not recorded' },
          { key: 'result', label: 'Result', render: (event) => describeAuditEvent(event).outcome },
        ]} />
        <Pagination page={page} pageSize={pageSize} total={visibleEvents.length} onPageChange={setPage} label="Activity log pages" />
      </section>
    </div>

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

