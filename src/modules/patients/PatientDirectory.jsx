import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Plus, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Empty from '../../components/EmptyState/EmptyState';
import Field from '../../components/Field/Field';
import FilterBar from '../../components/FilterBar/FilterBar';
import Modal from '../../components/Modal/Modal';
import Pagination from '../../components/Pagination/Pagination';
import { patientService } from '../../services/patientService';
import { useAuth } from '../auth/AuthProvider';
import { IMPORT_COLUMNS, parsePatientWorkbook } from './patientExcelImport';
import './PatientDirectory.css';

const initialPatient = { first_name: '', last_name: '', cnic: '', medical_record_number: '', external_id: '', date_of_birth: '', sex: '', blood_group: '', phone: '', address: '', status: 'Active' };

export default function PatientDirectory() {
  const { user } = useAuth();
  const canManagePatients = ['System Administrator', 'Super Administrator', 'Laboratory Manager'].includes(user?.role);
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [patient, setPatient] = useState(initialPatient);
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    try {
      const data = await patientService.list({ search, status, page, page_size: 25 }, signal);
      setPatients(data.items); setTotal(data.total);
    } catch (error) { if (error.name !== 'AbortError') toast.error(error.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [page, search, status]);

  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => load(controller.signal), 250); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);

  const changePatient = (event) => { const { name } = event.target; const value = name === 'cnic' ? event.target.value.replace(/\D/g, '').slice(0, 13) : event.target.value; setPatient((current) => ({ ...current, [name]: value })); };
  const closeRegistration = () => { setRegistrationOpen(false); setPatient(initialPatient); setDuplicates([]); };

  async function submitPatient(event) {
    event.preventDefault(); setSaving(true);
    try {
      const matches = await patientService.duplicates({ cnic: patient.cnic, medical_record_number: patient.medical_record_number, first_name: patient.first_name, last_name: patient.last_name, date_of_birth: patient.date_of_birth });
      if (matches.length) { setDuplicates(matches); return; }
      await patientService.create(Object.fromEntries(Object.entries(patient).map(([key, value]) => [key, value || null])));
      toast.success('Patient registered'); closeRegistration(); await load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  }

  const closeImport = () => { setImportOpen(false); setImportPreview(null); };

  async function chooseImport(event) {
    const file = event.target.files[0]; if (!file) return;
    try { setImportPreview(await parsePatientWorkbook(file)); }
    catch (error) { setImportPreview(null); toast.error(error.message || 'The selected file could not be read as an Excel workbook'); }
  }

  async function confirmImport() {
    setSaving(true);
    let created = 0; let duplicates = 0; let failed = 0;
    for (const { patient: record, errors } of importPreview.records) {
      if (errors.length) continue;
      try {
        const matches = await patientService.duplicates({ cnic: record.cnic, medical_record_number: record.medical_record_number, first_name: record.first_name, last_name: record.last_name, date_of_birth: record.date_of_birth });
        if (matches.length) { duplicates += 1; continue; }
        await patientService.create(Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value || null])));
        created += 1;
      } catch { failed += 1; }
    }
    const skipped = importPreview.records.filter((item) => item.errors.length).length;
    const summary = `${created} imported, ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped, ${skipped} invalid, ${failed} failed`;
    if (created) toast.success(summary); else toast.error(summary);
    setSaving(false);
    if (created) { closeImport(); await load(); }
  }

  const validImportCount = importPreview ? importPreview.records.filter((item) => !item.errors.length).length : 0;

  return <main id="main-content" className="patient-directory">
    <div className="patient-directory__body">
    <FilterBar
      className="patient-directory__filters"
      label="Patient filters"
      fields={[
        { label: 'Search patients', type: 'text', value: search, onChange: (value) => { setSearch(value); setPage(1); }, placeholder: 'Patient ID, CNIC, MRN, external ID, or name' },
        { label: 'Status', type: 'select', value: status, onChange: (value) => { setStatus(value); setPage(1); }, options: [{ value: '', label: 'All active records' }, { value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }, { value: 'Deceased', label: 'Deceased' }] },
      ]}
    >{canManagePatients && <button type="button" className="btn-primary patient-directory__register" onClick={() => setRegistrationOpen(true)}><Plus size={16} />Register patient</button>}</FilterBar>
    <section className="patient-directory__card"><header><div><h2>Patients</h2><p>{total} record{total === 1 ? '' : 's'}</p></div></header>{loading ? <div className="patient-directory__loading"><span className="loading-spinner" /> Loading patients…</div> : !patients.length ? <Empty icon={UserRound} title="No patients found" text="Adjust the filters or register a patient." /> : <div className="patient-directory__table-wrap"><table><thead><tr><th>Patient</th><th>Patient ID</th><th>CNIC</th><th>MRN</th><th>Date of birth</th><th>Status</th><th>Cases</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{patients.map((item) => <tr key={item.id}><td><strong>{item.display_label}</strong><small>{item.sex || 'Sex not recorded'}</small></td><td>{item.patient_identifier}</td><td>{item.cnic || '—'}</td><td>{item.medical_record_number || '—'}</td><td>{item.date_of_birth || '—'}{item.age != null && <small>{item.age} years</small>}</td><td><span className="patient-status">{item.status}</span></td><td>{item.total_cases}</td><td><Link to={`/patients/${item.id}`} className="btn-control-secondary route-link">Open profile</Link></td></tr>)}</tbody></table></div>}
      <Pagination page={page - 1} pageSize={25} total={total} disabled={loading} onPageChange={(nextPage) => setPage(nextPage + 1)} label="Patient directory pages" />
    </section>
    </div>
    <Modal open={registrationOpen} title="Register patient" onClose={closeRegistration} footer={null}><form className="patient-form" onSubmit={submitPatient}><div className="patient-form__grid"><Field label="First name *"><input name="first_name" value={patient.first_name} onChange={changePatient} required maxLength={120} /></Field><Field label="Last name *"><input name="last_name" value={patient.last_name} onChange={changePatient} required maxLength={120} /></Field><Field label="CNIC *"><input name="cnic" value={patient.cnic} onChange={changePatient} required inputMode="numeric" pattern="\d{13}" maxLength={13} minLength={13} title="CNIC must be exactly 13 digits" placeholder="13 digits, no dashes" /></Field><Field label="Medical record number"><input name="medical_record_number" value={patient.medical_record_number} onChange={changePatient} maxLength={120} /></Field><Field label="External identifier"><input name="external_id" value={patient.external_id} onChange={changePatient} maxLength={255} /></Field><Field label="Date of birth"><input name="date_of_birth" type="date" value={patient.date_of_birth} onChange={changePatient} max={new Date().toISOString().slice(0, 10)} /></Field><Field label="Sex"><select name="sex" value={patient.sex} onChange={changePatient}><option value="">Not recorded</option><option>Female</option><option>Male</option><option>Intersex</option><option>Unknown</option><option>Not stated</option></select></Field><Field label="Blood group"><select name="blood_group" value={patient.blood_group} onChange={changePatient}><option value="">Not recorded</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Phone"><input name="phone" value={patient.phone} onChange={changePatient} maxLength={40} /></Field></div><Field label="Address"><textarea name="address" value={patient.address} onChange={changePatient} maxLength={1000} rows={2} /></Field>{duplicates.length > 0 && <div className="patient-duplicates" role="alert"><strong>Possible duplicate found</strong><p>Registration was stopped. Review the existing record; patients are never merged automatically.</p>{duplicates.map((item) => <Link key={item.id} to={`/patients/${item.id}`}>{item.patient_identifier} · {item.display_label}</Link>)}</div>}<footer className="patient-form__actions"><button type="button" className="btn-control-secondary" onClick={closeRegistration}>Cancel</button><button className="btn-primary" disabled={saving}>{saving ? 'Checking…' : 'Register patient'}</button></footer></form></Modal>
    <Modal open={importOpen} title="Import patients from Excel" onClose={closeImport} footer={null}><div className="patient-import"><p>Upload an .xlsx file. Columns are matched automatically by header name: {IMPORT_COLUMNS.join(', ')}. A single "Name" column is also accepted.</p><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseImport} aria-label="Excel file" />{importPreview && <section><h3>Preview</h3><p>{importPreview.records.length} row{importPreview.records.length === 1 ? '' : 's'} found, {validImportCount} ready to import. Duplicates are skipped, never merged.</p>{importPreview.unmappedHeaders.length > 0 && <p className="patient-import__warning">Ignored columns: {importPreview.unmappedHeaders.join(', ')}</p>}<div className="patient-import__table"><table><thead><tr><th>Row</th><th>Patient</th><th>CNIC</th><th>MRN</th><th>Date of birth</th><th>Result</th></tr></thead><tbody>{importPreview.records.slice(0, 50).map((item) => <tr key={item.rowNumber}><td>{item.rowNumber}</td><td>{item.patient.first_name} {item.patient.last_name}</td><td>{item.patient.cnic || '—'}</td><td>{item.patient.medical_record_number || '—'}</td><td>{item.patient.date_of_birth || '—'}</td><td>{item.errors.length ? <span className="patient-import__warning">{item.errors.join('; ')}</span> : 'Ready'}</td></tr>)}</tbody></table></div>{importPreview.records.length > 50 && <p>Showing first 50 rows.</p>}<button className="btn-primary" onClick={confirmImport} disabled={saving || !validImportCount}>{saving ? 'Importing…' : `Import ${validImportCount} patient${validImportCount === 1 ? '' : 's'}`}</button></section>}</div></Modal>
  </main>;
}
