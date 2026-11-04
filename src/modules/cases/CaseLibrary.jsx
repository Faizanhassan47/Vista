import { useEffect, useState } from 'react';
import { ClipboardList, Eye, LayoutList, Plus, Search, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { caseService } from '../../services/caseService';
import { platformService } from '../../services/platformService';
import Modal from '../../components/Modal/Modal';
import { useAuth } from '../auth/AuthProvider';
import { isAdministratorRole } from '../../config/roles';
import { notifyClinicalDataChanged } from '../../services/clinicalDataEvents';
import Pagination from '../../components/Pagination/Pagination';
import FilterBar from '../../components/FilterBar/FilterBar';
import ReferenceTable from '../../components/ReferenceTable/ReferenceTable';
import './CaseLibrary.css';

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function caseStatus(caseItem) {
  return caseItem.status || (caseItem.reviewer ? 'In Review' : 'New');
}

export default function CaseLibrary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [query, setQuery] = useState('');
  const [patientIdFilter, setPatientIdFilter] = useState('');
  const [patientNameFilter, setPatientNameFilter] = useState('');
  const [caseIdFilter, setCaseIdFilter] = useState('');
  const [pathologistFilter, setPathologistFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [sort, setSort] = useState('created_at:desc');
  const [view, setView] = useState('table');
  useEffect(() => { setView('table'); }, []);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [casePendingRemoval, setCasePendingRemoval] = useState(null);
  const [removing, setRemoving] = useState(false);
  const pageSize = 25;

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const [sort_by, sort_direction] = sort.split(':');
    caseService.list({ search: debouncedQuery, status: status === 'All' ? null : status, assigned_to_me: assignedToMe || null, sort_by, sort_direction, limit: pageSize, offset: page * pageSize }, controller.signal)
      .then((data) => {
        const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        setCases(items);
        setTotal(Array.isArray(data) ? items.length : Number(data?.total) || 0);
      })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message || 'Unable to load cases.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [assignedToMe, debouncedQuery, page, sort, status]);

  useEffect(() => { setPage(0); setSelected(null); }, [assignedToMe, debouncedQuery, sort, status]);
  const active = selected || cases[0] || null;
  const filterSuggestions = (getValue) => {
    const seen = new Set();
    return cases
      .map(getValue)
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .map((value) => String(value).trim())
      .filter((value) => {
        const key = value.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const patientIdSuggestions = filterSuggestions((caseItem) => caseItem.patient_identifier || caseItem.patient_id || caseItem.medical_record_number);
  const patientNameSuggestions = filterSuggestions((caseItem) => caseItem.patient_name);
  const caseIdSuggestions = filterSuggestions((caseItem) => caseItem.case_id || `Case ${caseItem.id}`);
  const pathologistSuggestions = filterSuggestions((caseItem) => caseItem.reviewer);
  const autocompleteField = (label, value, onChange, suggestions) => ({ label, value, onChange, suggestions });
  const visibleCases = cases.filter((caseItem) => {
    const matches = (value, term) => !term.trim() || String(value || '').toLowerCase().includes(term.trim().toLowerCase());
    const createdAt = caseItem.created_at ? new Date(caseItem.created_at) : null;
    const createdTime = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null;
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toExclusive = dateTo ? new Date(`${dateTo}T00:00:00`).getTime() + 86400000 : null;
    return matches(caseItem.patient_id, patientIdFilter)
      && matches(caseItem.patient_name, patientNameFilter)
      && matches(caseItem.case_id, caseIdFilter)
      && matches(caseItem.reviewer, pathologistFilter)
      && (!dateFrom || (createdTime !== null && createdTime >= fromTime))
      && (!dateTo || (createdTime !== null && createdTime < toExclusive));
  });
  const canDeleteCases = isAdministratorRole(user?.role);
  const canCreateCases = isAdministratorRole(user?.role) || user?.role === 'Laboratory Manager / Supervisor';
  const applySavedView = (viewName) => {
    if (viewName === 'mine') { setAssignedToMe(true); setStatus('All'); }
    if (viewName === 'awaiting') { setAssignedToMe(false); setStatus('New'); }
    if (viewName === 'reviewing') { setAssignedToMe(false); setStatus('In Review'); }
    if (viewName === 'all') { setAssignedToMe(false); setStatus('All'); }
  };

  async function removeCase() {
    if (!casePendingRemoval || removing) return;
    setRemoving(true);
    setError('');
    try {
      await platformService.deleteCase(casePendingRemoval.id);
      setCases((current) => current.filter((caseItem) => caseItem.id !== casePendingRemoval.id));
      setTotal((current) => Math.max(0, current - 1));
      setSelected(null);
      setCasePendingRemoval(null);
      notifyClinicalDataChanged({ type: 'case-deleted', caseId: casePendingRemoval.id });
    } catch (err) {
      setError(err.message || 'Unable to remove case.');
    } finally {
      setRemoving(false);
    }
  }

  return <main className="case-library" id="main-content">

    {canCreateCases && <div className="case-library__create-row"><Link to="/cases?createCase=1" className="case-library__create-reference">+ Create New Case</Link></div>}
    <FilterBar title="Select Case" layout="case-reference" fields={[
      autocompleteField('Patient ID', patientIdFilter, setPatientIdFilter, patientIdSuggestions),
      autocompleteField('Patient Name', patientNameFilter, setPatientNameFilter, patientNameSuggestions),
      autocompleteField('Case ID', caseIdFilter, setCaseIdFilter, caseIdSuggestions),
      autocompleteField('Pathologist', pathologistFilter, setPathologistFilter, pathologistSuggestions),
      { label: 'Dated', type: 'dateRange', from: dateFrom, to: dateTo, onFromChange: setDateFrom, onToChange: setDateTo },
      { label: 'Status', type: 'select', value: status, onChange: (value) => { setAssignedToMe(false); setStatus(value); }, options: [{ value: 'All', label: '--- Select ---' }, { value: 'New', label: 'Awaiting review' }, { value: 'In Review', label: 'In review' }, { value: 'Reviewed', label: 'Reviewed' }] },
    ]} />
    <section className="case-library__filters" aria-label="Case library filters"><label className="case-library__search">
      <Search size={17} />
      <span className="sr-only">Search cases</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case ID, patient ID, diagnosis, or assigned pathologist" />
    </label><label className="case-library__filter"><SlidersHorizontal size={16} /><span className="sr-only">Case status</span><select value={status} onChange={(event) => { setAssignedToMe(false); setStatus(event.target.value); }}><option value="All">All statuses</option><option value="New">Awaiting review</option><option value="In Review">In review</option><option value="Reviewed">Reviewed</option></select></label><label className="case-library__filter"><span className="sr-only">Sort cases</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="created_at:desc">Newest first</option><option value="case_id:asc">Case ID A–Z</option><option value="status:asc">Status</option><option value="reviewer:asc">Assigned pathologist</option></select></label><div className="case-library__view-toggle" role="group" aria-label="Case display"><button type="button" className={view === 'cards' ? 'is-active' : ''} onClick={() => setView('cards')} aria-label="Card view"><LayoutList size={16} /></button><button type="button" className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')} aria-label="Table view"><Table2 size={16} /></button></div></section>
    {error && <p className="case-library__error" role="alert">{error}</p>}

    <div className={`case-library__layout${view === 'table' ? ' case-library__layout--worklist' : ''}`}>
      <section>

        {view === 'table' ? <ReferenceTable
          loading={loading}
          rows={visibleCases}
          rowKey={(caseItem) => caseItem.id}
          onRowClick={(caseItem) => navigate(`/case-library/${caseItem.id}`)}
          empty="No cases found. Adjust the search or status filter to find a case."
          columns={[
            { key: 'sr', label: 'Sr. #', width: '5%', render: (_, index) => page * pageSize + index + 1 },
            { key: 'case', label: 'Case ID', width: '10%', render: (caseItem) => caseItem.case_id || `Case ${caseItem.id}` },
            { key: 'patientId', label: 'Patient ID', width: '13%', render: (caseItem) => caseItem.patient_identifier || caseItem.patient_id || caseItem.medical_record_number || 'Not recorded' },
            { key: 'patientName', label: 'Patient Name', width: '16%', render: (caseItem) => caseItem.patient_name || 'Not recorded' },
            { key: 'pathologist', label: 'Pathologist', width: '14%', render: (caseItem) => caseItem.reviewer || 'Unassigned' },
            { key: 'slides', label: 'Slides', width: '8%', render: (caseItem) => String(caseItem.slide_count ?? caseItem.slides?.length ?? 0).padStart(2, '0') },
            { key: 'created', label: 'Created At', width: '14%', render: (caseItem) => formatDate(caseItem.created_at) },
            { key: 'updated', label: 'Updated At', width: '14%', render: (caseItem) => formatDate(caseItem.updated_at || caseItem.created_at) },
          ]}
        /> : <div className="case-library__list">
          {loading ? Array.from({ length: 5 }, (_, index) => <div key={index} className="case-library__skeleton" aria-hidden="true" />) : cases.map((caseItem) => {
            const status = caseStatus(caseItem);
            const slides = caseItem.slide_count ?? caseItem.slides?.length ?? 0;
            return <button type="button" key={caseItem.id} onClick={() => setSelected(caseItem)} className={`case-library__card${active?.id === caseItem.id ? ' case-library__card--selected' : ''}`}>
              <span className="case-library__card-icon"><ClipboardList size={20} /></span>
              <span className="case-library__card-content"><strong>{caseItem.case_id || `Case ${caseItem.id}`}</strong><small>{caseItem.description || 'Clinical description not recorded'}</small><em>{slides} {slides === 1 ? 'slide' : 'slides'} · {caseItem.reviewer || 'Unassigned'}</em></span>
              <span className={`case-library__status case-library__status--${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
            </button>;
          })}
          {!loading && !cases.length && <div className="case-library__empty"><ClipboardList size={26} /><strong>No cases found</strong><span>Adjust the search or status filter to find a case.</span></div>}
        </div>}
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} disabled={loading} label="Case library pages" />
      </section>

      {view === 'cards' && <aside className="case-library__details">
        {active ? <>
          <button type="button" className="case-library__close" onClick={() => setSelected(null)} aria-label="Clear selected case"><X size={16} /></button>
          <div className="case-library__details-title"><ClipboardList size={26} /><div><h2>{active.case_id || `Case ${active.id}`}</h2><span className={`case-library__status case-library__status--${caseStatus(active).toLowerCase().replace(/\s+/g, '-')}`}>{caseStatus(active)}</span></div></div>
          <Link to={`/cases?case=${active.id}`} className="btn-primary route-link"><Eye size={16} />Open case workspace</Link>
          {canDeleteCases && <button type="button" className="case-library__delete" onClick={() => setCasePendingRemoval(active)} disabled={removing}><Trash2 size={15} />Remove case</button>}
          <section className="case-library__metadata" aria-labelledby="case-library-metadata-title">
            <h3 id="case-library-metadata-title">Case details</h3>
            <dl>
              <div><dt>Case ID</dt><dd>{active.case_id || active.id}</dd></div>
              <div><dt>Patient ID</dt><dd>{active.patient_id || 'Not recorded'}</dd></div>
              <div><dt>Description</dt><dd>{active.description || 'Not recorded'}</dd></div>
              <div><dt>Assigned pathologist</dt><dd>{active.reviewer || 'Unassigned'}</dd></div>
              <div><dt>Slides</dt><dd>{active.slide_count ?? active.slides?.length ?? 0}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(active.created_at)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(active.updated_at || active.created_at)}</dd></div>
            </dl>
          </section>
          <section className="case-library__slides" aria-labelledby="case-library-slides-title">
            <h3 id="case-library-slides-title">Associated slides</h3>
            {(active.slides || []).length ? <ul>{active.slides.map((slide) => <li key={slide.id}><Link to={`/cases?case=${active.id}&slide=${slide.id}`}>{slide.label || `Slide ${slide.id}`}</Link><span>{slide.stain || slide.file_type?.toUpperCase() || 'Slide'}</span></li>)}</ul> : <p>No slides have been added to this case.</p>}
          </section>
        </> : <div className="case-library__details-empty"><ClipboardList size={28} /><p>Select a case to view its details.</p></div>}
      </aside>}
    </div>
    <Modal open={Boolean(casePendingRemoval)} title="Remove case" onClose={() => !removing && setCasePendingRemoval(null)} footer={<><button type="button" className="modal-button modal-button--secondary" disabled={removing} onClick={() => setCasePendingRemoval(null)}>Cancel</button><button type="button" className="modal-button btn-delete" disabled={removing} onClick={removeCase}>{removing ? 'Removing…' : 'Remove case'}</button></>}><p className="confirmation-copy">Remove case <strong>{casePendingRemoval?.case_id}</strong>? All associated slides, annotations, drafts, and non-finalized reports will be removed. Source files are moved to protected deleted storage.</p></Modal>
  </main>;
}


