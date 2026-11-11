import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, FileEdit, FileText, Plus, Trash2 } from 'lucide-react';
import './ReportEditor.css';
import { API_BASE_URL as API } from '../../config';
import { apiFetch } from '../../api';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import Modal from '../Modal/Modal';
import { reportService } from '../../services/reportService';
import Tabs from '../Tabs/Tabs';

function Field({ label, children }) {
  return <label className="field-group"><span className="field-label">{label}</span>{children}</label>;
}

const SURGICAL_PATHOLOGY_TEMPLATE = {
  name: 'Surgical Pathology Report',
  sections: {
    specimen_clinical: 'Clinical history / specimen submitted',
    gross_description: 'Gross description',
    microscopic_findings: 'Microscopic description',
    diagnosis: 'Final diagnosis',
    comments: 'Special studies, AI-assisted review summary, comments and recommendations',
  },
};

export default function ReportEditor({ selectedCase, selectSlide, setMessage, onReportFinalized }) {
  const [isDirty, setIsDirty] = useState(false);
  const [reports, setReports] = useState([]);
  const [currentDraft, setCurrentDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('edit');
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [annotationsBySlide, setAnnotationsBySlide] = useState({});
  const [templateVersion, setTemplateVersion] = useState(0);
  const [aiDraftVersion, setAiDraftVersion] = useState(0);
  const [isGeneratingAiDraft, setIsGeneratingAiDraft] = useState(false);
  useUnsavedChanges(isDirty);

  const fetchReports = useCallback(async () => {
    if (!selectedCase) return;
    try {
      const response = await apiFetch(`${API}/api/cases/${selectedCase.id}/reports`);
      if (!response.ok) throw new Error('Could not load reports');
      const data = await response.json();
      setReports(data);
      setCurrentDraft(data.find((report) => report.status === 'Draft') || null);
    } catch (error) {
      setMessage({ text: error.message, type: 'error' });
    }
  }, [selectedCase, setMessage]);

  useEffect(() => {
    let mounted = true;
    if (!selectedCase) return;
    (async () => {
      try {
        const response = await apiFetch(`${API}/api/cases/${selectedCase.id}/reports`);
        if (!mounted) return;
        if (!response.ok) throw new Error('Could not load reports');
        const data = await response.json();
        if (mounted) {
          setReports(data);
          setCurrentDraft(data.find((report) => report.status === 'Draft') || null);
        }
      } catch (error) {
        if (mounted) setMessage({ text: error.message, type: 'error' });
      }
    })();
    return () => { mounted = false; };
  }, [selectedCase, setMessage]);

  const applyTemplate = () => {
    if (!currentDraft) return;
    setCurrentDraft((draft) => ({
      ...draft,
      ...Object.fromEntries(Object.entries(SURGICAL_PATHOLOGY_TEMPLATE.sections).map(([field, heading]) => [field, draft[field] || `[${heading.toUpperCase()}]\n`])),
    }));
    setTemplateVersion((current) => current + 1);
    setIsDirty(true);
    setMessage({ text: `${SURGICAL_PATHOLOGY_TEMPLATE.name} applied.`, type: 'success' });
  };

  const insertAiMicroscopicDraft = async () => {
    if (!currentDraft || isGeneratingAiDraft) return;
    setIsGeneratingAiDraft(true);
    try {
      const result = await reportService.aiMicroscopicDraft(selectedCase.id);
      setCurrentDraft((draft) => {
        const current = (draft.microscopic_findings || '').trim();
        const isTemplatePrompt = /^\[[^\]]+\]$/.test(current);
        return { ...draft, microscopic_findings: !current || isTemplatePrompt ? result.microscopic_findings : `${current}\n\n${result.microscopic_findings}` };
      });
      setAiDraftVersion((current) => current + 1);
      setIsDirty(true);
      setMessage({ text: `AI-assisted draft added from ${result.result_count} verified Evidence Map finding${result.result_count === 1 ? '' : 's'}. Review before finalizing.`, type: 'success' });
    } catch (error) {
      setMessage({ text: error.message, type: 'error' });
    } finally {
      setIsGeneratingAiDraft(false);
    }
  };

  const createDraft = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(`${API}/api/cases/${selectedCase.id}/reports`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not create draft');
      await fetchReports();
      setActiveTab('edit');
      setMessage({ text: 'Draft report is ready.', type: 'success' });
    } catch (error) { setMessage({ text: error.message, type: 'error' }); }
    finally { setBusy(false); }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!currentDraft || busy) return;
    setBusy(true);
    const form = event.currentTarget;
    const findings = currentDraft.findings.map((finding, index) => ({
      ...finding,
      text: form[`finding_${index}_text`]?.value || '',
      slide_id: form[`finding_${index}_slide`]?.value ? Number(form[`finding_${index}_slide`].value) : null,
      annotation_id: form[`finding_${index}_annotation`]?.value ? Number(form[`finding_${index}_annotation`].value) : null,
      sort_order: index,
    }));
    const payload = {
      specimen_clinical: form.specimen_clinical.value,
      gross_description: form.gross_description.value,
      microscopic_findings: form.microscopic_findings.value,
      diagnosis: form.diagnosis.value,
      comments: form.comments.value,
      reviewer_name: form.reviewer_name.value,
      findings,
    };
    try {
      const response = await apiFetch(`${API}/api/reports/${currentDraft.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to save report');
      await fetchReports();
      setIsDirty(false);
      setMessage({ text: 'Draft saved.', type: 'success' });
    } catch (error) { setMessage({ text: error.message, type: 'error' }); }
    finally { setBusy(false); }
  };

  const loadAnnotations = async (slideId) => {
    if (!slideId || annotationsBySlide[slideId]) return;
    try {
      const response = await apiFetch(`${API}/api/slides/${slideId}/annotations`);
      if (response.ok) {
        const items = await response.json();
        setAnnotationsBySlide((current) => ({ ...current, [slideId]: items }));
      }
    } catch { /* A missing annotation list should not block report editing. */ }
  };

  const updateFindingSlide = (index, slideId) => {
    setCurrentDraft((draft) => ({
      ...draft, findings: draft.findings.map((finding, itemIndex) => itemIndex === index
        ? { ...finding, slide_id: slideId ? Number(slideId) : '', annotation_id: '' } : finding)
    }));
    setIsDirty(true);
    loadAnnotations(slideId);
  };

  useEffect(() => {
    const report = reports.find((item) => item.status === 'Finalized') || currentDraft;
    report?.findings?.forEach((finding) => {
      if (finding.slide_id) loadAnnotations(finding.slide_id);
    });
  }, [currentDraft, reports]);

  const finalizeReport = async () => {
    if (!currentDraft || busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(`${API}/api/reports/${currentDraft.id}/finalize`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not finalize report');
      await fetchReports();
      await onReportFinalized?.();
      setIsDirty(false);
      setActiveTab('versions');
      setConfirmFinalize(false);
      setMessage({ text: 'Report finalized.', type: 'success' });
    } catch (error) { setMessage({ text: error.message, type: 'error' }); }
    finally { setBusy(false); }
  };

  const activeReport = reports.find((report) => report.status === 'Finalized') || currentDraft;

  return <section className="report-panel" aria-labelledby="report-heading">
    <header className="report-header">
      <div className="report-heading"><FileText size={18} /><div><h3 id="report-heading">Case report</h3><p>Draft, review and finalize the case record.</p></div></div>
      {!currentDraft && <button type="button" className="btn-primary" onClick={createDraft} disabled={busy}><Plus size={16} /> New draft</button>}
    </header>

    <Tabs
      className="report-tabs"
      ariaLabel="Report sections"
      value={activeTab}
      onChange={setActiveTab}
      items={['edit', 'preview', 'versions'].map((tab) => ({
        value: tab,
        label: tab[0].toUpperCase() + tab.slice(1),
        disabled: tab !== 'versions' && !activeReport,
      }))}
    />

    {activeTab === 'edit' && currentDraft && <form key={`${currentDraft.id}-${templateVersion}-${aiDraftVersion}`} className="report-form" onSubmit={handleUpdate} onChange={() => setIsDirty(true)}>
      <div className="report-template-bar">
        <div><span className="field-label">Report template</span><strong>{SURGICAL_PATHOLOGY_TEMPLATE.name}</strong><p>Standard structured template for clinical pathology reports.</p></div>
        <button type="button" className="btn-control-secondary" onClick={applyTemplate}>Apply template</button>
      </div>
      <div className="report-field-grid">
        <Field label="Specimen and clinical details"><textarea name="specimen_clinical" defaultValue={currentDraft.specimen_clinical} rows={3} /></Field>
        <Field label="Gross description"><textarea name="gross_description" defaultValue={currentDraft.gross_description} rows={3} /></Field>
        <Field label={<span className="report-field-label-row">Microscopic findings <button type="button" className="btn-control-secondary" onClick={insertAiMicroscopicDraft} disabled={isGeneratingAiDraft}>{isGeneratingAiDraft ? 'Generating AI draft…' : 'Add AI draft'}</button></span>}><textarea name="microscopic_findings" defaultValue={currentDraft.microscopic_findings} rows={4} /></Field>
        <Field label="Diagnosis"><textarea name="diagnosis" defaultValue={currentDraft.diagnosis} rows={4} /></Field>
      </div>
      <Field label="Comments"><textarea name="comments" defaultValue={currentDraft.comments} rows={2} /></Field>
      <Field label="Reviewer name"><input name="reviewer_name" defaultValue={currentDraft.reviewer_name} required maxLength={120} /></Field>

      <section className="report-findings">
        <header><div><h4>Linked findings</h4><p>Connect each finding to its supporting slide or annotation.</p></div>
          <button type="button" className="btn-control-secondary" onClick={() => { setCurrentDraft((draft) => ({ ...draft, findings: [...draft.findings, { text: '', slide_id: '', annotation_id: '' }] })); setIsDirty(true); }}><Plus size={14} /> Add finding</button></header>
        {!currentDraft.findings.length && <p className="report-empty">No linked findings have been added.</p>}
        {currentDraft.findings.map((finding, index) => <div className="finding-row" key={`${finding.id || 'new'}-${index}`}>
          <textarea name={`finding_${index}_text`} defaultValue={finding.text} placeholder="Describe the finding" rows={2} required aria-label={`Finding ${index + 1}`} />
          <select name={`finding_${index}_slide`} value={finding.slide_id || ''} onChange={(event) => updateFindingSlide(index, event.target.value)} aria-label={`Slide for finding ${index + 1}`}>
            <option value="">No slide linked</option>{selectedCase.slides.map((slide) => <option key={slide.id} value={slide.id}>{slide.label}</option>)}
          </select>
          <select name={`finding_${index}_annotation`} defaultValue={finding.annotation_id || ''} disabled={!finding.slide_id} aria-label={`Annotation for finding ${index + 1}`}>
            <option value="">No annotation linked</option>{(annotationsBySlide[finding.slide_id] || []).map((annotation) => <option key={annotation.id} value={annotation.id}>{annotation.label}</option>)}
          </select>
          <button type="button" className="icon-button icon-button--danger" aria-label={`Remove finding ${index + 1}`} onClick={() => { setCurrentDraft((draft) => ({ ...draft, findings: draft.findings.filter((_, itemIndex) => itemIndex !== index) })); setIsDirty(true); }}><Trash2 size={16} /></button>
        </div>)}
      </section>

      <footer className="report-actions"><span className={isDirty ? 'save-state save-state--dirty' : 'save-state'}>{isDirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button type="submit" className="btn-primary" disabled={busy}><FileEdit size={16} /> {busy ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="btn-success" onClick={() => setConfirmFinalize(true)} disabled={busy || isDirty}><CheckCircle2 size={16} /> Finalize</button></footer>
    </form>}

    {activeTab === 'edit' && !currentDraft && <div className="report-empty-state"><FileText size={28} /><h4>No draft report</h4><p>Create a draft to begin documenting this case.</p></div>}

    {activeTab === 'preview' && activeReport && <article className="report-preview report-preview--surgical">
      <header><p>Digital Pathology</p><h2>Pathology report</h2><span>Case {selectedCase.case_id} · Version {activeReport.version} · {activeReport.status}</span></header>
      <div className="surgical-preview-header">
        <div className="surgical-preview-brand"><span>Digital Pathology Laboratory</span></div>
        <div className="surgical-preview-title"><h2>Surgical Pathology Report</h2><span>Precision Pathology | Digital Intelligence | Better Care</span></div>
        <dl><div><dt>Report No.</dt><dd>REP-{String(activeReport.id).padStart(6, '0')}</dd></div><div><dt>Case No.</dt><dd>{selectedCase.case_id}</dd></div><div><dt>Report Date</dt><dd>{activeReport.finalized_at || activeReport.created_at || 'Not recorded'}</dd></div><div><dt>Status</dt><dd>{activeReport.status}</dd></div></dl>
      </div>
      <section className="report-patient-case"><h3>Patient / Case Information</h3><dl><div><dt>Patient name</dt><dd>{activeReport.patient_name || selectedCase.patient_name || activeReport.patient_identifier || selectedCase.patient_identifier || selectedCase.patient_id || 'Not recorded'}</dd></div><div><dt>Specimen type</dt><dd>{selectedCase.specimen_type || selectedCase.description || 'Not recorded'}</dd></div><div><dt>Accession / case no.</dt><dd>{selectedCase.case_id}</dd></div><div><dt>Pathologist</dt><dd>{activeReport.reviewer_name || selectedCase.reviewer || 'Not assigned'}</dd></div></dl></section>
      {[['Clinical History / Specimen Submitted', activeReport.specimen_clinical], ['Gross Description', activeReport.gross_description], ['Microscopic Description', activeReport.microscopic_findings], ['Final Diagnosis', activeReport.diagnosis], ['Special Studies / IHC / Biomarkers', activeReport.comments]].map(([title, value]) => <section key={title} className={title === 'Final Diagnosis' ? 'report-preview__diagnosis' : ''}><h3>{title}</h3><p>{value || 'Not recorded.'}</p></section>)}
      <section className="report-preview__ai"><h3>AI-Assisted Review Summary</h3><p>AI findings are supportive and require pathologist review and clinical correlation.</p></section>
      {!!activeReport.findings.length && <section><h3>Linked findings</h3><div className="report-finding-list">{activeReport.findings.map((finding, index) => {
        const slide = selectedCase.slides.find((item) => item.id === finding.slide_id);
        const annotation = (annotationsBySlide[finding.slide_id] || []).find((item) => item.id === finding.annotation_id);
        const annotationLabel = finding.annotation_label || annotation?.label || (finding.annotation_id ? `Annotation ${finding.annotation_id}` : 'Slide reference');
        const annotationSource = finding.annotation_source_type || annotation?.source_type || '';
        return <article className="report-finding-card" key={finding.id || index}>
          {finding.annotation_id && <div className="report-finding-visual">
            {slide?.image_url || slide?.thumbnail_url ? <img src={slide.image_url || slide.thumbnail_url} alt={`Supporting image for ${annotationLabel}`} /> : <div className="report-finding-image-empty">Image unavailable</div>}
            <span className="report-finding-label">{annotationLabel}</span>
          </div>}
          <div className="report-finding-content"><strong>Finding {index + 1}</strong>{annotationSource && <span className="report-finding-source">{annotationSource}</span>}<p>{finding.text || 'No description recorded.'}</p>{slide && <button type="button" className="text-action" onClick={() => selectSlide(slide)}>Open supporting slide</button>}</div>
        </article>;
      })}</div></section>}
      <footer><span>Reviewer: {activeReport.reviewer_name || 'Not assigned'}</span><button type="button" className="btn-primary" onClick={() => window.location.assign(`${API}/api/reports/${activeReport.id}/pdf`)}><Download size={16} /> Download PDF</button></footer>
    </article>}

    {activeTab === 'versions' && <div className="report-versions">
      {!reports.length ? <p className="report-empty">No report versions exist.</p> : reports.map((report) => <article key={report.id}><div><strong>Version {report.version}</strong><span className={`report-status report-status--${report.status.toLowerCase()}`}>{report.status}</span></div><p>{report.reviewer_name || 'No reviewer'} · {report.finalized_at || report.created_at}</p>{report.status === 'Finalized' && <button type="button" className="btn-control-secondary" onClick={() => window.location.assign(`${API}/api/reports/${report.id}/pdf`)}><Download size={15} /> PDF</button>}</article>)}
    </div>}

    <Modal open={confirmFinalize} title="Finalize report" onClose={() => setConfirmFinalize(false)} footer={<><button type="button" className="modal-button modal-button--secondary" onClick={() => setConfirmFinalize(false)}>Cancel</button><button type="button" className="modal-button modal-button--primary" onClick={finalizeReport} disabled={busy}>{busy ? 'Finalizing…' : 'Finalize report'}</button></>}>
      <p className="confirmation-copy">Finalized versions become read-only. Confirm that the report has been reviewed and is ready to publish.</p>
    </Modal>
  </section>;
}
