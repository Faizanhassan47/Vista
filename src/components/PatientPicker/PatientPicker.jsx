import { useEffect, useId, useState } from 'react';
import { Plus, Search, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Field from '../Field/Field';
import Modal from '../Modal/Modal';
import { patientService } from '../../services/patientService';
import './PatientPicker.css';

const emptyForm = { first_name: '', last_name: '', cnic: '', medical_record_number: '', date_of_birth: '', sex: '' };
const toNullable = (values) => Object.fromEntries(Object.entries({ ...values, status: 'Active' }).map(([key, value]) => [key, value || null]));

function splitName(query) {
  if (/^[\d\s-]+$/.test(query)) return { first_name: '', last_name: '', cnic: query.replace(/\D/g, '').slice(0, 13) };
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first_name: parts[0] || '', last_name: '' };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts.at(-1) };
}

function patientSummary(patient) {
  return [patient.patient_identifier, patient.cnic && `CNIC ${patient.cnic}`, patient.medical_record_number && `MRN ${patient.medical_record_number}`].filter(Boolean).join(' · ');
}

/**
 * Search patients by name, patient ID or MRN. When nothing matches, a new patient
 * can be registered inline and is selected automatically.
 */
export default function PatientPicker({ value, onChange, initialPatientId = null, disabled = false, selectedDisplay = 'name' }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initialPatientId) return undefined;
    const controller = new AbortController();
    patientService.get(initialPatientId, controller.signal).then(onChange).catch((error) => { if (error.name !== 'AbortError') toast.error('Could not load the selected patient'); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPatientId]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await patientService.list({ search: term, page: 1, page_size: 8 }, controller.signal);
        setResults(data.items); setSearched(true);
      } catch (error) { if (error.name !== 'AbortError') toast.error(error.message); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const select = (patient) => { onChange(patient); setQuery(''); setResults([]); setSearched(false); };
  const changeQuery = (event) => { setQuery(event.target.value); if (event.target.value.trim().length < 2) { setResults([]); setSearched(false); } };
  const changeForm = (event) => { const { name } = event.target; const value = name === 'cnic' ? event.target.value.replace(/\D/g, '').slice(0, 13) : event.target.value; setForm((current) => ({ ...current, [name]: value })); };
  const openCreate = () => { setForm({ ...emptyForm, ...splitName(query) }); setDuplicates([]); setCreateOpen(true); };
  const closeCreate = () => { setCreateOpen(false); setDuplicates([]); };

  async function submitPatient(event) {
    event.preventDefault(); setSaving(true);
    try {
      const matches = await patientService.duplicates({ cnic: form.cnic, medical_record_number: form.medical_record_number, first_name: form.first_name, last_name: form.last_name, date_of_birth: form.date_of_birth });
      if (matches.length) { setDuplicates(matches); return; }
      const created = await patientService.create(toNullable(form));
      const patient = created.patient_identifier ? created : await patientService.get(created.id);
      toast.success('Patient registered');
      closeCreate(); select(patient);
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  }

  const showEmpty = searched && !searching && !results.length && query.trim().length >= 2;

  return <div className="patient-picker">
    <label htmlFor={inputId} className="patient-picker__label">Patient *</label>
    {value ? <div className="patient-picker__selected">
      <UserRound size={16} aria-hidden="true" />
      <span><strong>{selectedDisplay === 'identifier' ? (value.patient_identifier || 'Patient ID unavailable') : (value.display_label || `${value.first_name} ${value.last_name}`)}</strong><small>{patientSummary(value)}</small></span>
      <button type="button" className="patient-picker__clear" onClick={() => onChange(null)} disabled={disabled} aria-label="Change patient"><X size={14} /></button>
    </div> : <>
      <div className="patient-picker__search"><Search size={16} aria-hidden="true" />
        <input id={inputId} value={query} onChange={changeQuery} placeholder="Search by name, CNIC, patient ID or MRN" autoComplete="off" disabled={disabled} />
      </div>
      {(results.length > 0 || showEmpty || searching) && <div className="patient-picker__menu" role="listbox" aria-label="Matching patients">
        {searching && !results.length && <p className="patient-picker__status">Searching…</p>}
        {results.map((patient) => <button type="button" role="option" aria-selected="false" key={patient.id} className="patient-picker__option" onClick={() => select(patient)}>
          <strong>{patient.display_label}</strong><small>{patientSummary(patient)}</small>
        </button>)}
        {showEmpty && <div className="patient-picker__empty"><p>No patient found for “{query.trim()}”.</p>
          <button type="button" className="btn-control-secondary" onClick={openCreate}><Plus size={14} /> Create new patient</button></div>}
      </div>}
    </>}
    <Modal open={createOpen} title="Register patient" onClose={closeCreate} footer={null}>
      <form className="patient-form" onSubmit={submitPatient}>
        <div className="patient-form__grid">
          <Field label="First name *"><input name="first_name" value={form.first_name} onChange={changeForm} required maxLength={120} /></Field>
          <Field label="Last name *"><input name="last_name" value={form.last_name} onChange={changeForm} required maxLength={120} /></Field>
          <Field label="CNIC *"><input name="cnic" value={form.cnic} onChange={changeForm} required inputMode="numeric" pattern="\d{13}" minLength={13} maxLength={13} title="CNIC must be exactly 13 digits" placeholder="13 digits, no dashes" /></Field>
          <Field label="Medical record number"><input name="medical_record_number" value={form.medical_record_number} onChange={changeForm} maxLength={120} /></Field>
          <Field label="Date of birth"><input name="date_of_birth" type="date" value={form.date_of_birth} onChange={changeForm} max={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="Sex"><select name="sex" value={form.sex} onChange={changeForm}><option value="">Not recorded</option><option>Female</option><option>Male</option><option>Intersex</option><option>Unknown</option><option>Not stated</option></select></Field>
        </div>
        {duplicates.length > 0 && <div className="patient-picker__duplicates" role="alert"><strong>Possible duplicate found</strong>
          <p>Use an existing record instead of creating a new one.</p>
          {duplicates.map((item) => <button type="button" key={item.id} className="patient-picker__option" onClick={() => { closeCreate(); select(item); }}><strong>{item.display_label}</strong><small>{patientSummary(item)}</small></button>)}
        </div>}
        <footer className="patient-form__actions">
          <button type="button" className="btn-control-secondary" onClick={closeCreate}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Register and select'}</button>
        </footer>
      </form>
    </Modal>
  </div>;
}
