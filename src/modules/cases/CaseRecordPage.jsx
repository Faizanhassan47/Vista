import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Modal from '../../components/Modal/Modal';
import { isAdministratorRole } from '../../config/roles';
import { useAuth } from '../auth/AuthProvider';
import { caseService } from '../../services/caseService';
import { platformService } from '../../services/platformService';
import { notifyClinicalDataChanged } from '../../services/clinicalDataEvents';
import '../create-case/CreateCaseForm.css';
import './CaseLibrary.css';

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!size) return '';
  const megabytes = size / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}

export default function CaseRecordPage() {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [caseItem, setCaseItem] = useState(null);
  const [error, setError] = useState('');
  const [slideId, setSlideId] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const canDelete = isAdministratorRole(user?.role);

  useEffect(() => {
    const controller = new AbortController();
    setCaseItem(null);
    setError('');
    caseService.get(caseId, controller.signal)
      .then((data) => {
        setCaseItem(data);
        setSlideId(data.slides?.[0]?.id || null);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Unable to open this case.');
      });
    return () => controller.abort();
  }, [caseId]);

  async function removeCase() {
    if (!caseItem || removing) return;
    setRemoving(true);
    setError('');
    try {
      await platformService.deleteCase(caseItem.id, { confirmFinalized: true });
      notifyClinicalDataChanged({ type: 'case-deleted', caseId: caseItem.id });
      navigate('/case-library');
    } catch (err) {
      setError(err.message || 'Unable to remove case.');
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  if (error && !caseItem) return <main className="create-case-page"><p role="alert">{error}</p></main>;
  if (!caseItem) return <main className="create-case-page"><p>Loading case…</p></main>;

  const slides = caseItem.slides || [];
  const slide = slides.find((item) => item.id === slideId) || slides[0] || null;
  const image = slide?.thumbnail_url || slide?.image_url || '';

  return (
    <main className="create-case-page case-library__preview" id="main-content">
      <h1>{caseItem.case_id || `Case ${caseItem.id}`}</h1>
      <form className="create-case-page__grid" onSubmit={(event) => event.preventDefault()}>
        <div className="create-case-page__main">
          <div className="create-case-page__details">
            <div className="create-case-page__case-id">
              <label htmlFor="selected-case-id">Case ID</label>
              <div><input id="selected-case-id" value={caseItem.case_id || `CASE-${caseItem.id}`} readOnly /></div>
            </div>
            <div className="create-case-page__row"><span>Patient ID</span><input value={caseItem.patient_identifier || caseItem.medical_record_number || caseItem.patient_id || ''} readOnly /></div>
            <div className="create-case-page__row"><span>Patient Name</span><input value={caseItem.patient_name || ''} readOnly /></div>
            <label className="create-case-page__row"><span>Case Description</span><input value={caseItem.description || ''} readOnly /></label>
            <label className="create-case-page__row"><span>Assigned Pathologist</span><input value={caseItem.reviewer || 'Unassigned'} readOnly /></label>
            <label className="create-case-page__row"><span>Associated Slides</span><input value={slides.length ? String(slides.length).padStart(2, '0') : ''} readOnly /></label>
            <label className="create-case-page__row"><span>New Field</span><input value={slide?.label || ''} readOnly aria-label="Slide label" /></label>
            <label className="create-case-page__row"><span>New Field</span><input value={slide?.specimen_description || ''} readOnly aria-label="Specimen description" /></label>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="create-case-page__actions">
            <button type="button" className="create-case-page__cancel" onClick={() => navigate('/case-library')}>Cancel</button>
            <button type="button" className="btn-primary" onClick={() => navigate(`/cases?case=${caseItem.id}`)}>Open workspace</button>
            {canDelete && <button type="button" className="case-library__remove-case" onClick={() => setConfirmRemove(true)} disabled={removing}>Remove case</button>}
          </div>
        </div>
        <div className="create-case-page__side">
          <section className="create-case-page__uploads">
            <header><strong>Upload files</strong><span>Select and upload the files</span></header>
            <div className="create-case-page__dropzone case-library__slide-frame">
              {image ? <img src={image} alt={slide?.label || 'Case slide'} /> : <span>No slide image is available for this case.</span>}
            </div>
          </section>
          <section className="create-case-page__attachments">
            <header><strong>Attachments</strong><span>Files associated with the case</span></header>
            {slides.length ? slides.map((item) => (
              <button type="button" className={`create-case-page__attachment${item.id === slide?.id ? ' is-active' : ''}`} key={item.id} onClick={() => setSlideId(item.id)}>
                <span>{item.filename || item.label || `Slide ${item.id}`}</span>
                <small>{formatFileSize(item.file_size)}</small>
              </button>
            )) : <p>No files selected.</p>}
          </section>
        </div>
      </form>
      <Modal open={confirmRemove} title="Remove case" onClose={() => !removing && setConfirmRemove(false)} footer={<><button type="button" className="modal-button modal-button--secondary" disabled={removing} onClick={() => setConfirmRemove(false)}>Cancel</button><button type="button" className="modal-button btn-delete" disabled={removing} onClick={removeCase}>{removing ? 'Removing…' : 'Remove case'}</button></>}><p className="confirmation-copy">Remove case <strong>{caseItem.case_id}</strong>? Associated slides and reports, including a finalized report, will be removed.</p></Modal>
    </main>
  );
}
