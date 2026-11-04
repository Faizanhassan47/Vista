import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileImage, MoreHorizontal, Trash2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { caseService } from '../../services/caseService';
import { platformService } from '../../services/platformService';
import Modal from '../../components/Modal/Modal';
import FilterBar from '../../components/FilterBar/FilterBar';
import Pagination from '../../components/Pagination/Pagination';
import ReferenceTable from '../../components/ReferenceTable/ReferenceTable';
import { notifyClinicalDataChanged, subscribeToClinicalDataChanges } from '../../services/clinicalDataEvents';
import { isIntakeRole } from '../../config/roles';
import { useAuth } from '../auth/AuthProvider';
import './SlideLibrary.css';
import '../cases/CaseLibrary.css';

const slideStatus = (caseItem) => caseItem.status === 'Reviewed' ? 'Reviewed' : caseItem.status === 'In Review' ? 'In review' : 'Awaiting review';

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return 'Not recorded';
  const value = Number(bytes);
  if (!Number.isFinite(value)) return 'Not recorded';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(Math.max(value, 1)) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function SlideLibrary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [slideId, setSlideId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [caseId, setCaseId] = useState('');
  const [pathologist, setPathologist] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('All');
  const [view, setView] = useState('table');
  useEffect(() => { setView('table'); }, []);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [slidePendingRemoval, setSlidePendingRemoval] = useState(null);
  const [actionMenuSlideId, setActionMenuSlideId] = useState(null);
  const [page, setPage] = useState(0);
  const actionMenuRef = useRef(null);
  const pageSize = 25;


  useEffect(() => {
    const controller = new AbortController();
    const loadCases = (signal) => caseService.list(signal)
      .then((items) => setCases(Array.isArray(items) ? items : items.items || []))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    loadCases(controller.signal);
    const unsubscribe = subscribeToClinicalDataChanges(() => loadCases());
    return () => { controller.abort(); unsubscribe(); };
  }, []);

  useEffect(() => {
    const closeMenu = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) setActionMenuSlideId(null);
    };
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, []);

  const slides = useMemo(() => cases.flatMap((caseItem) => (caseItem.slides || []).map((slide) => ({
    ...slide,
    image_url: slide.thumbnail_url || slide.image_url,
    caseId: caseItem.id,
    caseLabel: caseItem.case_id,
    caseDescription: caseItem.description,
    patientId: caseItem.patient_id,
    patientName: caseItem.patient_name,
    pathologist: caseItem.reviewer,
    status: slideStatus(caseItem),
  }))), [cases]);
  const filterOptions = useMemo(() => {
    const distinct = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim()).map(String))].sort((a, b) => a.localeCompare(b));
    return {
      slideId: distinct(slides.map((slide) => slide.id)),
      patientId: distinct(slides.map((slide) => slide.patientId)),
      patientName: distinct(slides.map((slide) => slide.patientName)),
      caseId: distinct(slides.map((slide) => slide.caseLabel || `Case ${slide.caseId}`)),
      pathologist: distinct(slides.map((slide) => slide.pathologist)),
    };
  }, [slides]);

  const filtered = slides.filter((slide) => {
    const uploaded = slide.created_at ? new Date(slide.created_at) : null;
    const validUploaded = uploaded && !Number.isNaN(uploaded.getTime());
    const uploadedAt = validUploaded ? uploaded.getTime() : null;
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toDate = dateTo ? new Date(`${dateTo}T00:00:00`) : null;
    if (toDate) toDate.setDate(toDate.getDate() + 1);
    const toTime = toDate ? toDate.getTime() : null;
    return (!slideId || String(slide.id).toLowerCase().includes(slideId.trim().toLowerCase()))
      && (!patientId || String(slide.patientId || '').toLowerCase().includes(patientId.trim().toLowerCase()))
      && (!patientName || String(slide.patientName || '').toLowerCase().includes(patientName.trim().toLowerCase()))
      && (!caseId || String(slide.caseLabel || '').toLowerCase().includes(caseId.trim().toLowerCase()))
      && (!pathologist || String(slide.pathologist || '').toLowerCase().includes(pathologist.trim().toLowerCase()))
      && (status === 'All' || slide.status === status)
      && (!dateFrom || (validUploaded && uploadedAt >= fromTime))
      && (!dateTo || (validUploaded && uploadedAt < toTime));
  });
  const pageSlides = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const canRemoveSlides = isIntakeRole(user?.role);
  const activeSlide = selected;
  const filterFields = [
    { label: 'Slide ID', value: slideId, onChange: setSlideId, suggestions: filterOptions.slideId },
    { label: 'Patient ID', value: patientId, onChange: setPatientId, suggestions: filterOptions.patientId },
    { label: 'Patient Name', value: patientName, onChange: setPatientName, suggestions: filterOptions.patientName },
    { label: 'Case ID', value: caseId, onChange: setCaseId, suggestions: filterOptions.caseId },
    { label: 'Pathologist', value: pathologist, onChange: setPathologist, suggestions: filterOptions.pathologist },
    { label: 'Dated', type: 'dateRange', from: dateFrom, onFromChange: setDateFrom, to: dateTo, onToChange: setDateTo },
    { label: 'Status', type: 'select', value: status, onChange: setStatus, options: [
      { value: 'All', label: '--- Select ---' },
      { value: 'Awaiting review', label: 'Awaiting review' },
      { value: 'In review', label: 'In review' },
      { value: 'Reviewed', label: 'Reviewed' },
    ] },
  ];

  async function removeSlide() {
    const target = slidePendingRemoval;
    if (!canRemoveSlides || !target || removing) return;
    setRemoving(true);
    setError('');
    try {
      await platformService.deleteSlide(target.id);
      setCases((current) => current.map((caseItem) => caseItem.id === target.caseId ? {
        ...caseItem,
        slides: (caseItem.slides || []).filter((slide) => slide.id !== target.id),
        slide_count: Math.max(0, (caseItem.slide_count || 1) - 1),
      } : caseItem));
      setSlidePendingRemoval(null);
      setSelected(null);
      notifyClinicalDataChanged({ type: 'slide-deleted', slideId: target.id, caseId: target.caseId });
    } catch (err) {
      setError(err.message || 'Unable to remove slide.');
    } finally {
      setRemoving(false);
    }
  }

  return <main className="slide-library" id="main-content">
    <FilterBar title="Select Slide" fields={filterFields} layout="slide" />
    {error && <p className="slide-library__error" role="alert">Unable to load slides: {error}</p>}
    <p className="slide-library__count">{filtered.length} slide{filtered.length === 1 ? '' : 's'}</p>
    {view === 'table' ? <><ReferenceTable rows={pageSlides} rowKey={(slide) => slide.id} onRowClick={(slide) => navigate(`/cases?case=${slide.caseId}&slide=${slide.id}`)} empty="No slides found." columns={[
      { key: 'sr', label: 'Sr. #', render: (_, index) => page * pageSize + index + 1 },
      { key: 'slide', label: 'Slide ID', render: (slide) => slide.label || `Slide ${slide.id}` },
      { key: 'case', label: 'Case ID', render: (slide) => slide.caseLabel || `Case ${slide.caseId}` },
      { key: 'patientId', label: 'Patient ID', render: (slide) => slide.patientId || 'Not recorded' },
      { key: 'patientName', label: 'Patient Name', render: (slide) => slide.patientName || 'Not recorded' },
      { key: 'pathologist', label: 'Pathologist', render: (slide) => slide.pathologist || 'Unassigned' },
      { key: 'status', label: 'Status', render: (slide) => slide.status },
      { key: 'uploaded', label: 'Uploaded', render: (slide) => formatDate(slide.created_at) },
    ]} /><Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} label="Slide library pages" /></> : <div className="slide-library__cards-layout"><div className="slide-library__grid">{filtered.map((slide) => <button type="button" className={`slide-card${activeSlide?.id === slide.id ? ' is-selected' : ''}`} key={slide.id} onClick={() => setSelected(slide)}><div className="slide-card__image">{slide.image_url ? <img src={slide.image_url} alt="" /> : <FileImage size={26} />}<span>{slide.status}</span></div><strong>{slide.label || `Slide ${slide.id}`}</strong><small>Case: {slide.caseLabel}</small><p>{slide.specimen_description || 'Specimen details not recorded'}</p><footer>{slide.file_type?.toUpperCase() || 'Image'} <span>·</span> {slide.stain || 'Stain not recorded'}</footer></button>)}{!filtered.length && <div className="slide-library__empty"><FileImage size={25} /><strong>No slides found</strong><span>Adjust the search or add a slide through a case.</span></div>}</div><aside className="slide-library__details">{activeSlide ? <><button type="button" className="slide-library__details-close" onClick={() => setSelected(null)} aria-label="Clear selected slide"><X size={16} /></button><div className="slide-library__details-image">{activeSlide.image_url ? <img src={activeSlide.image_url} alt={`Preview of ${activeSlide.label || 'slide'}`} /> : <FileImage size={30} />}</div><div className="slide-library__details-title"><h2>{activeSlide.label || `Slide ${activeSlide.id}`}</h2><span className={`slide-library__status slide-library__status--${activeSlide.status.toLowerCase().replace(/\s+/g, '-')}`}>{activeSlide.status}</span></div><Link to={`/cases?case=${activeSlide.caseId}&slide=${activeSlide.id}`} className="btn-primary route-link"><Eye size={16} />Open in viewer</Link>{canRemoveSlides && <button type="button" className="slide-library__details-remove" onClick={() => setSlidePendingRemoval(activeSlide)} disabled={removing}><Trash2 size={15} />{removing ? 'Removing…' : 'Remove slide'}</button>}<section className="slide-library__metadata"><h3>Metadata</h3><dl><div><dt>Slide ID</dt><dd>{activeSlide.id}</dd></div><div><dt>Case ID</dt><dd><Link to={`/cases?case=${activeSlide.caseId}`}>{activeSlide.caseLabel}</Link></dd></div><div><dt>File name</dt><dd>{activeSlide.filename || 'Not recorded'}</dd></div><div><dt>File format</dt><dd>{activeSlide.format || activeSlide.file_type?.toUpperCase() || 'Not recorded'}</dd></div><div><dt>File size</dt><dd>{formatFileSize(activeSlide.file_size)}</dd></div><div><dt>Dimensions</dt><dd>{activeSlide.width && activeSlide.height ? `${Number(activeSlide.width).toLocaleString()} × ${Number(activeSlide.height).toLocaleString()} pixels` : 'Not recorded'}</dd></div><div><dt>Image levels</dt><dd>{activeSlide.level_count || 'Not recorded'}</dd></div><div><dt>Stain</dt><dd>{activeSlide.stain || 'Not recorded'}</dd></div><div><dt>Specimen type</dt><dd>{activeSlide.specimen_description || activeSlide.caseDescription || 'Not recorded'}</dd></div><div><dt>Upload date</dt><dd>{formatDate(activeSlide.created_at)}</dd></div><div><dt>Processing status</dt><dd>{activeSlide.upload_state || 'Not recorded'}</dd></div></dl></section></> : <div className="slide-library__details-empty"><FileImage size={28} /><p>Select a slide to view its metadata.</p></div>}</aside></div>}
    <Modal open={canRemoveSlides && Boolean(slidePendingRemoval)} title="Remove slide" onClose={() => !removing && setSlidePendingRemoval(null)} footer={<><button type="button" className="modal-button modal-button--secondary" disabled={removing} onClick={() => setSlidePendingRemoval(null)}>Cancel</button><button type="button" className="modal-button btn-delete" disabled={removing} onClick={removeSlide}>{removing ? 'Removing…' : 'Remove slide'}</button></>}><p className="confirmation-copy">Remove <strong>{slidePendingRemoval?.label || `Slide ${slidePendingRemoval?.id || ''}`}</strong>? This removes its annotations and analysis records. The source file is moved to protected deleted storage.</p></Modal>
  </main>;
}

