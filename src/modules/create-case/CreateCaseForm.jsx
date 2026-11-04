import { useEffect, useRef, useState } from 'react';
import { CloudUpload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import PatientPicker from '../../components/PatientPicker/PatientPicker';
import { caseService } from '../../services/caseService';
import './CreateCaseForm.css';

function formatFileSize(bytes) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export default function CreateCaseForm({
  onSubmit,
  selectedPatient,
  onPatientChange,
  requestedPatientId,
  busy,
  reviewersLoading,
  reviewersError,
  availableReviewers,
}) {
  const fileInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [generatedCaseId, setGeneratedCaseId] = useState('');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    caseService.nextId(controller.signal)
      .then((data) => setGeneratedCaseId(data.case_id))
      .catch((error) => {
        if (error.name !== 'AbortError') setGeneratedCaseId('');
      });
    return () => controller.abort();
  }, []);

  const addFiles = (incoming) => {
    const nextFiles = Array.from(incoming || []);
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...nextFiles.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
  };

  const removeFile = (fileToRemove) => setFiles((current) => current.filter((file) => file !== fileToRemove));

  return (
    <section className="create-case-page">
      <h1>Create New Case</h1>
      <form className="create-case-page__grid" onSubmit={(event) => onSubmit(event, files)}>
        <div className="create-case-page__main">
          <div className="create-case-page__details">
            <div className="create-case-page__case-id">
              <label htmlFor="create-case-id">Case ID</label>
              <div><input id="create-case-id" name="case_id" value={generatedCaseId} readOnly required aria-label="Next case ID, assigned when submitted" /></div>
            </div>
            <div className="create-case-page__row create-case-page__patient">
              <span>Patient ID *</span>
              <div>
                <PatientPicker value={selectedPatient} onChange={onPatientChange} initialPatientId={requestedPatientId} disabled={busy} selectedDisplay="identifier" />
              </div>
            </div>
            <div className="create-case-page__row">
              <span>Patient Name</span>
              <output>{selectedPatient?.display_label || (selectedPatient ? `${selectedPatient.first_name || ''} ${selectedPatient.last_name || ''}`.trim() : '')}</output>
            </div>
            <label className="create-case-page__row">
              <span>Case Description</span>
              <input name="description" placeholder="Enter case description" />
            </label>
            <label className="create-case-page__row">
              <span>Assigned Pathologist</span>
              <select name="reviewer" disabled={busy || reviewersLoading || Boolean(reviewersError)}>
                <option value="">Unassigned</option>
                {availableReviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.username}>{reviewer.display_name || reviewer.username}</option>
                ))}
              </select>
            </label>
          
            <label className="create-case-page__row"><span>New Field</span><input name="slide_label" defaultValue="Slide 1" maxLength={120} aria-label="First slide label" /></label>
            <label className="create-case-page__row"><span>New Field</span><input name="specimen_description" placeholder="Optional specimen details" aria-label="Specimen description" /></label>
          </div>
          <div className="create-case-page__actions">
            <Link className="create-case-page__cancel" to="/case-library">Cancel</Link>
            <button className="btn-primary" type="submit" disabled={busy || !selectedPatient || !generatedCaseId}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>

        <div className="create-case-page__side">
          <section className="create-case-page__uploads" aria-labelledby="create-case-upload-title">
            <header>
              <strong id="create-case-upload-title">Upload files</strong>
              <span>Select and upload the files</span>
            </header>
            <label
              className="create-case-page__dropzone"
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
              data-dragging={dragging || undefined}
              aria-label="Choose files or drop them to upload"
            >
              <input
                ref={fileInput}
                name="image"
                type="file"
                multiple
                accept=".svs,.tif,.tiff,.ndpi,.mrxs,.scn,.dcm,.nii,.nii.gz,image/jpeg,image/png"
                onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
                disabled={busy}
              />
              <CloudUpload size={30} strokeWidth={1.5} aria-hidden="true" />
              <span>Choose a file or drag &amp; drop it here</span>
              <small>WSI, DCM, NII, JPG and PNG formats</small>
              <span className="create-case-page__browse" aria-hidden="true">Browse File</span>
            </label>
          </section>

          <section className="create-case-page__attachments" aria-labelledby="create-case-attachments-title">
            <header>
              <strong id="create-case-attachments-title">Attachments</strong>
              <span>Files associated with the case</span>
            </header>
            {files.length ? files.map((file) => (
              <div className="create-case-page__attachment" key={`${file.name}:${file.size}:${file.lastModified}`}>
                <span>{file.name}</span>
                <small>{formatFileSize(file.size)}</small>
                <button type="button" onClick={() => removeFile(file)} disabled={busy} aria-label={`Remove ${file.name}`}><X size={14} /></button>
              </div>
            )) : <p>No files selected.</p>}
          </section>
        </div>
      </form>
    </section>
  );
}
