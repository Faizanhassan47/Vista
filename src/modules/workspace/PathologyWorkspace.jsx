import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Calendar, Edit3, FileImage, Layers, ClipboardCheck, History, Columns, X,
  Plus, Search, Upload, UserRound, LogOut, ChevronDown, Trash2, Link2, Clock,
  LayoutDashboard, UsersRound, BrainCircuit, Settings, Activity, ShieldCheck, Images
} from 'lucide-react';
import Empty from '../../components/EmptyState/EmptyState';
import Field from '../../components/Field/Field';
import ReportEditor from '../../components/ReportEditor/ReportEditor';
import Tabs from '../../components/Tabs/Tabs';
import SlideViewer from '../../components/SlideViewer/SlideViewer';
import { isAdministratorRole, isAuditorRole, SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE } from '../../config/roles';
import './PathologyWorkspace.css';
import Login from '../auth/Login';
import { useAuth } from '../auth/AuthProvider';
import { API_BASE_URL as API } from '../../config';
import { apiFetch } from '../../api';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useCaseWorklist from './useCaseWorklist';
import Modal from '../../components/Modal/Modal';
import CreateCaseForm from '../create-case/CreateCaseForm';
import { patientService } from '../../services/patientService';
import { platformService } from '../../services/platformService';
import { caseService } from '../../services/caseService';
import { notifyClinicalDataChanged } from '../../services/clinicalDataEvents';
import RegistrationWorkspace from '../registration/RegistrationWorkspace';

function apiErrorMessage(detail, fallback) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.msg === 'string') {
        const loc = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body' && part !== 'query').join('.') : '';
        return loc ? `${loc}: ${item.msg}` : item.msg;
      }
      return '';
    }).filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg;
  return fallback;
}

function normalizeCase(item) {
  return {
    ...item,
    status: item.status || 'New',
    reviewer: item.reviewer || '',
    slides: Array.isArray(item.slides) ? item.slides : [],
    slide_count: Number.isFinite(item.slide_count) ? item.slide_count : (item.slides?.length || 0),
    review_notes: Array.isArray(item.review_notes) ? item.review_notes : [],
    review_history: Array.isArray(item.review_history) ? item.review_history : [],
  };
}

const CASE_STATUS_OPTIONS = ['New', 'In Review', 'Reviewed'];
const MAX_VIEWER_SCREENS = 4;

export default function App() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [branding, setBranding] = useState({ title: 'Digital Pathology Platform', subtitle: 'Digital Pathology Platform', logo: null, logoSize: '32', titleSize: '14', subtitleSize: '10', theme: 'dark', primaryColor: '#4a90c2', secondaryColor: '#087f8c' });
  useEffect(() => { const controller = new AbortController(); platformService.branding(controller.signal).then((data) => { setBranding(data); document.documentElement.dataset.theme = data.theme || 'dark'; document.documentElement.style.setProperty('--brand-logo-size', `${data.logoSize || 32}px`); document.documentElement.style.setProperty('--brand-title-size', `${data.titleSize || 14}px`); document.documentElement.style.setProperty('--brand-subtitle-size', `${data.subtitleSize || 10}px`); document.documentElement.style.setProperty('--color-primary', data.primaryColor || '#4a90c2'); document.documentElement.style.setProperty('--primary', data.primaryColor || '#4a90c2'); document.documentElement.style.setProperty('--sidebar-background', data.primaryColor || '#4a90c2'); document.documentElement.style.setProperty('--color-accent', data.secondaryColor || '#087f8c'); }).catch(() => { }); return () => controller.abort(); }, []);
  const [searchParams] = useSearchParams();
  const requestedPatientId = Number(searchParams.get('patient')) || null;
  const requestedCaseId = Number(searchParams.get('case')) || null;
  const requestedSlideId = Number(searchParams.get('slide')) || null;




  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [selectedSlideId, setSelectedSlideId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [worklistTab, setWorklistTab] = useState('My Cases');
  const [statusFilter, setStatusFilter] = useState('All');
  const [reviewerFilter, setReviewerFilter] = useState('All');
  const [availableReviewers, setAvailableReviewers] = useState([]);
  const [reviewersLoading, setReviewersLoading] = useState(false);
  const [reviewersError, setReviewersError] = useState('');

  const [busy, setBusy] = useState(false);
  const [wsiLimitMb, setWsiLimitMb] = useState(2048);
  const [showSlideForm, setShowSlideForm] = useState(false);
  const [showCreateCase, setShowCreateCase] = useState(location.pathname === '/create-case' || searchParams.get('createCase') === '1');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('review');
  const [caseSection, setCaseSection] = useState('slides');
  const openCaseSection = useCallback((key, panel) => {
    setCaseSection(key);
    if (panel) setInspectorTab(panel);
    window.requestAnimationFrame(() => {
      const target = key === 'slides' || key === 'ai'
        ? document.querySelector('.layout--case-review .multi-slide-card')
        : document.querySelector('.layout--case-review .case-tab-page');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  const [caseTimelineEvents, setCaseTimelineEvents] = useState([]);
  const [caseRelatedLinks, setCaseRelatedLinks] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [editingSlideId, setEditingSlideId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const viewerRef = useRef(null);

  const [compareSlideIds, setCompareSlideIds] = useState([]);
  const [splitView, setSplitView] = useState(false);
  const [deleteSlideTarget, setDeleteSlideTarget] = useState(null);
  const [deleteCaseTarget, setDeleteCaseTarget] = useState(null);
  const [syncViews, setSyncViews] = useState(false);
  const [zoom2, setZoom2] = useState(1);
  const [position2, setPosition2] = useState({ x: 0, y: 0 });
  const [dragStart2, setDragStart2] = useState({ x: 0, y: 0 });
  const [isDragging2, setIsDragging2] = useState(false);
  const viewerRef2 = useRef(null);
  const viewerRef3 = useRef(null);
  const viewerRef4 = useRef(null);
  const secondaryViewerRefs = useMemo(() => [viewerRef2, viewerRef3, viewerRef4], []);
  const [showRegistrationWorkspace, setShowRegistrationWorkspace] = useState(false);
  useEffect(() => {
    setShowCreateCase(location.pathname === '/create-case' || searchParams.get('createCase') === '1');
  }, [location.pathname, searchParams]);




  const selectedCase = cases.find((item) => item.id === selectedCaseId) || null;
  const selectedSlide = selectedCase?.slides.find((slide) => slide.id === selectedSlideId) || null;
  const compareSlides = compareSlideIds.map((id) => selectedCase?.slides.find((slide) => slide.id === id)).filter(Boolean);
  const openSlides = selectedSlide ? [selectedSlide, ...compareSlides] : [];
  const availableScreenSlides = (selectedCase?.slides || []).filter((slide) => slide.id !== selectedSlideId && !compareSlideIds.includes(slide.id));
  const openScreenCount = selectedSlide ? compareSlides.length + 1 : 0;

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch(`${API}/api/cases`);
      if (!response.ok) throw new Error('Could not load cases');
      const data = await response.json();
      const normalized = data.map(normalizeCase);
      setCases(normalized);
      if (requestedCaseId || requestedSlideId) {
        const requested = normalized.find((item) => item.id === requestedCaseId || item.slides.some((slide) => slide.id === requestedSlideId));
        if (requested) {
          setSelectedCaseId(requested.id);
          const primarySlideId = requestedSlideId && requested.slides.some((slide) => slide.id === requestedSlideId) ? requestedSlideId : requested.slides[0]?.id ?? null;
          const comparisonSlide = requested.slides.find((slide) => slide.id !== primarySlideId);
          setSelectedSlideId(primarySlideId);
          setCompareSlideIds(comparisonSlide ? [comparisonSlide.id] : []);
          setSplitView(Boolean(comparisonSlide));
        }
      }
      return normalized;
    } catch (error) {
      toast.error(`Cannot connect to API (${error.message}).`);
      throw error;
    }
  }, [requestedCaseId, requestedSlideId]);

  useEffect(() => {
    if (!user) return;
    queueMicrotask(() => {
      refresh().catch(() => { });
      apiFetch(`${API}/api/status`).then((r) => r.ok ? r.json() : null)
        .then((data) => data?.wsi_max_upload_mb && setWsiLimitMb(data.wsi_max_upload_mb))
        .catch(() => { });
    });
  }, [refresh, user]);

  useEffect(() => {
    if (!user || isAuditorRole(user.role)) return undefined;
    const controller = new AbortController();
    setReviewersLoading(true);
    setReviewersError('');
    caseService.reviewers(controller.signal)
      .then((data) => setAvailableReviewers(Array.isArray(data) ? data : []))
      .catch((error) => {
        if (error.name !== 'AbortError') setReviewersError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReviewersLoading(false);
      });
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseTimelineEvents([]);
      setCaseRelatedLinks([]);
      return;
    }
    const controller = new AbortController();
    if (inspectorTab === 'timeline') {
      setTimelineLoading(true);
      platformService.caseTimeline(selectedCaseId, controller.signal)
        .then((events) => setCaseTimelineEvents(events || []))
        .catch((err) => { if (err.name !== 'AbortError') toast.error(`Timeline error: ${err.message}`); })
        .finally(() => setTimelineLoading(false));
    } else if (inspectorTab === 'links') {
      setLinksLoading(true);
      platformService.caseLinks(selectedCaseId, controller.signal)
        .then((links) => setCaseRelatedLinks(links || []))
        .catch((err) => { if (err.name !== 'AbortError') toast.error(`Links error: ${err.message}`); })
        .finally(() => setLinksLoading(false));
    }
    return () => controller.abort();
  }, [selectedCaseId, inspectorTab]);

  const resetRasterView = () => {
    setZoom2(1);
    setPosition2({ x: 0, y: 0 });
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const selectCase = (item) => {
    setSelectedCaseId(item.id);
    const [primarySlide, comparisonSlide] = item.slides || [];
    setSelectedSlideId(primarySlide?.id ?? null);
    setCompareSlideIds(comparisonSlide ? [comparisonSlide.id] : []);
    setSplitView(Boolean(comparisonSlide));
    setEditingSlideId(null);
    setShowSlideForm(false);
    setInspectorTab('review');
    resetRasterView();
  };

  useEffect(() => {
    if (user?.role !== 'Pathologist' || !selectedCaseId) return;
    const activeCase = cases.find((item) => item.id === selectedCaseId);
    const actorNames = [user.username, user.display_name]
      .filter(Boolean)
      .map((value) => value.trim().toLowerCase());
    const isAssignedToPathologist = actorNames.includes(String(activeCase?.reviewer || '').trim().toLowerCase());
    if (!activeCase || activeCase.status !== 'New' || !isAssignedToPathologist) return;

    const controller = new AbortController();
    caseService.updateStatus(activeCase.id, 'In Review', controller.signal)
      .then((updatedCase) => {
        setCases((current) => current.map((item) => item.id === updatedCase.id ? normalizeCase(updatedCase) : item));
        notifyClinicalDataChanged({ type: 'case-status-changed', caseId: updatedCase.id, status: 'In Review' });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') toast.error(error.message || 'Could not start case review.');
      });
    return () => controller.abort();
  }, [cases, selectedCaseId, user?.display_name, user?.role, user?.username]);

  const selectSlide = (slide) => {
    if (slide.id === selectedSlideId) return;
    if (selectedSlide) {
      if (compareSlideIds.includes(slide.id)) {
        setCompareSlideIds([selectedSlide.id, ...compareSlideIds.filter((id) => id !== slide.id)].slice(0, MAX_VIEWER_SCREENS - 1));
      } else if (openScreenCount < MAX_VIEWER_SCREENS) {
        setCompareSlideIds([selectedSlide.id, ...compareSlideIds].slice(0, MAX_VIEWER_SCREENS - 1));
      } else {
        toast.error(`Close a tab before opening another slide. Maximum ${MAX_VIEWER_SCREENS}.`);
        return;
      }
    }
    setSelectedSlideId(slide.id);
    setEditingSlideId(null);
    resetRasterView();
  };

  const toggleScreenSlide = (slide) => {
    if (slide.id === selectedSlideId) return;
    if (compareSlideIds.includes(slide.id) && compareSlideIds.length === 1) setSplitView(false);
    setCompareSlideIds((current) => {
      if (current.includes(slide.id)) return current.filter((id) => id !== slide.id);
      if (current.length >= MAX_VIEWER_SCREENS - 1) {
        toast.error(`A maximum of ${MAX_VIEWER_SCREENS} slide screens can be open.`);
        return current;
      }
      return [...current, slide.id];
    });
  };

  const openSideBySideComparison = () => {
    if (!selectedSlide || !selectedCase) return;
    if (splitView) {
      setSplitView(false);
      setCompareSlideIds([]);
      return;
    }
    if (compareSlideIds.length) {
      setSplitView(true);
      return;
    }
    const comparisonSlide = selectedCase.slides.find((slide) => slide.id !== selectedSlide.id);
    if (!comparisonSlide) {
      toast.error('Add another slide to this case before starting a comparison.');
      return;
    }
    setCompareSlideIds([comparisonSlide.id]);
    setSplitView(true);
  };

  const addScreen = (slideId) => {
    const slide = selectedCase?.slides.find((item) => item.id === Number(slideId));
    if (!slide || !selectedSlide || openScreenCount >= MAX_VIEWER_SCREENS) return;
    setCompareSlideIds((current) => [selectedSlide.id, ...current].slice(0, MAX_VIEWER_SCREENS - 1));
    setSelectedSlideId(slide.id);
    resetRasterView();
  };

  const activateScreen = (slide) => {
    if (!selectedSlide || slide.id === selectedSlide.id) return;
    setCompareSlideIds((current) => [selectedSlide.id, ...current.filter((id) => id !== slide.id)].slice(0, MAX_VIEWER_SCREENS - 1));
    setSelectedSlideId(slide.id);
    resetRasterView();
  };

  const closeScreen = (slide) => {
    if (slide.id !== selectedSlideId) {
      setCompareSlideIds((current) => current.filter((id) => id !== slide.id));
      if (compareSlideIds.length <= 1) setSplitView(false);
      return;
    }
    const [nextSlideId, ...remainingIds] = compareSlideIds;
    setSelectedSlideId(nextSlideId || null);
    setCompareSlideIds(remainingIds);
    if (!remainingIds.length) setSplitView(false);
    resetRasterView();
  };

  const validateFile = (file) => {
    if (!file) return true;
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    const supportedImages = new Set(['.jpg', '.jpeg', '.png']);
    const supportedWsi = new Set(['.svs', '.tif', '.tiff']);
    if (!supportedImages.has(extension) && !supportedWsi.has(extension)) {
      toast.error('Upload a JPG, PNG, SVS, or OpenSlide-compatible TIFF file.');
      return false;
    }
    const isWsi = supportedWsi.has(extension);
    const limit = (isWsi ? wsiLimitMb : 10) * 1024 * 1024;
    if (file.size > limit) {
      toast.error(`File exceeds the ${isWsi ? wsiLimitMb : 10} MB limit.`);
      return false;
    }
    return true;
  };

  async function createCase(event, selectedFiles = []) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    if (!selectedPatient) { toast.error('Select or register a patient before creating a case.'); return; }
    const files = Array.from(selectedFiles);
    const reviewer = form.elements.reviewer?.value || '';
    const caseId = String(form.elements.case_id?.value || '').trim();
    if (!caseId) { toast.error('Case ID is not ready yet. Refresh the form and try again.'); return; }
    if (files.some((file) => !validateFile(file))) return;
    setBusy(true);
    toast(files.length ? 'Creating case and uploading slides…' : 'Creating empty case…');
    try {
      const caseForm = new FormData(form);
      caseForm.delete('image');
      caseForm.set('case_id', caseId);
      const response = await apiFetch(`${API}/api/cases`, { method: 'POST', body: caseForm });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data.detail, 'Could not create case'));
      if (reviewer) {
        const reviewerResponse = await apiFetch(`${API}/api/cases/${data.id}/reviewer`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewer }),
        });
        const reviewerData = await reviewerResponse.json().catch(() => ({}));
        if (!reviewerResponse.ok) throw new Error(apiErrorMessage(reviewerData.detail, 'Case created, but doctor assignment failed'));
      }
      const uploadErrors = [];
      for (const [index, file] of files.entries()) {
        const slideForm = new FormData();
        slideForm.append('image', file);
        slideForm.append('label', index === 0 ? (form.elements.slide_label.value || 'Slide 1') : `Slide ${index + 1}`);
        slideForm.append('specimen_description', form.elements.specimen_description.value || '');
        try {
          const slideResponse = await apiFetch(`${API}/api/cases/${data.id}/slides`, { method: 'POST', body: slideForm });
          const slideData = await slideResponse.json().catch(() => ({}));
          if (!slideResponse.ok) throw new Error(apiErrorMessage(slideData.detail, 'Upload failed'));
        } catch (error) {
          uploadErrors.push(`${file.name}: ${error.message}`);
        }
      }
      try {
        await patientService.linkCase(selectedPatient.id, { case_id: data.id, accession_number: data.case_id, priority: 'Routine' });
      } catch (linkError) {
        throw new Error(linkError.message || 'Case created, but patient linking failed');
      }
      form.reset();
      setSelectedPatient(null);
      setShowCreateCase(false);
      navigate(`/cases?case=${data.id}`, { replace: true });
      notifyClinicalDataChanged({ type: 'case-created', caseId: data.id });
      if (uploadErrors.length) toast.error(`Case created, but some slides could not be uploaded: ${uploadErrors.join('; ')}`);
      else toast.success(`Case “${data.case_id}” created.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addSlide(event) {
    event.preventDefault();
    if (busy || !selectedCase) return;
    const form = event.currentTarget;
    const file = form.elements.image.files[0];
    if (!validateFile(file)) return;
    setBusy(true);
    toast('Uploading and validating slide…');
    try {
      const response = await apiFetch(`${API}/api/cases/${selectedCase.id}/slides`, {
        method: 'POST', body: new FormData(form),
      });
      const slide = await response.json();
      if (!response.ok) throw new Error(slide.detail || 'Slide upload failed');
      form.reset();
      await refresh();
      setSelectedSlideId(slide.id);
      setShowSlideForm(false);
      notifyClinicalDataChanged({ type: 'slide-created', slideId: slide.id, caseId: selectedCase.id });
      toast.success(`Slide “${slide.label}” is ready.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }


  async function saveSlideQc(event, slide) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = event.currentTarget;
    try {
      const data = {
        qc_status: form.elements.qc_status.value || null,
        qc_missing_tissue: form.elements.qc_missing_tissue.checked,
        qc_blur: form.elements.qc_blur.checked,
        qc_scan_artifact: form.elements.qc_scan_artifact.checked,
        qc_incorrect_label: form.elements.qc_incorrect_label.checked,
        qc_unusual_staining: form.elements.qc_unusual_staining.checked,
        qc_note: form.elements.qc_note.value
      };
      const response = await apiFetch(`${API}/api/slides/${slide.id}/qc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Could not update QC');
      await refresh();
      setEditingSlideId(null);
      toast.success('Slide QC saved.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSlide(event, slide) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await apiFetch(`${API}/api/slides/${slide.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not update slide');
      await refresh();
      setEditingSlideId(null);
      toast.success('Slide details updated.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeSlide() {
    if (!deleteSlideTarget || busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(`${API}/api/platform/slides/${deleteSlideTarget.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || 'Could not remove slide');
      }
      const updatedCases = await refresh();
      const updatedCase = updatedCases.find((item) => item.id === selectedCaseId);
      setSelectedSlideId(updatedCase?.slides[0]?.id ?? null);
      setCompareSlideIds([]);
      setSplitView(false);
      setDeleteSlideTarget(null);
      notifyClinicalDataChanged({ type: 'slide-deleted', slideId: deleteSlideTarget.id, caseId: selectedCaseId });
      toast.success('Slide removed and its source file moved to protected deleted storage.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCase() {
    if (!deleteCaseTarget || busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(`${API}/api/platform/cases/${deleteCaseTarget.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || 'Could not remove case');
      }
      await refresh();
      setSelectedCaseId(null);
      setSelectedSlideId(null);
      setCompareSlideIds([]);
      setSplitView(false);
      setDeleteCaseTarget(null);
      notifyClinicalDataChanged({ type: 'case-deleted', caseId: deleteCaseTarget.id });
      toast.success('Case removed and source files moved to protected deleted storage.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateReview(event, endpoint, successText) {
    event.preventDefault();
    if (busy || !selectedCase) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (endpoint === 'status' && values.status === selectedCase.status) {
      toast(`Case is already "${selectedCase.status}".`);
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(`${API}/api/cases/${selectedCase.id}/${endpoint}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not update case');
      await refresh();
      toast.success(successText);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addReviewNote(event) {
    event.preventDefault();
    if (busy || !selectedCase) return;
    setBusy(true);
    const form = event.currentTarget;
    try {
      const response = await apiFetch(`${API}/api/cases/${selectedCase.id}/review-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not add review note');
      form.elements.note.value = '';
      await refresh();
      toast.success('Review note added.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  const viewerError = useCallback((text) => toast.error(text), []);
  const reportMessage = useCallback(({ text, type }) => type === 'error' ? toast.error(text) : toast.success(text), []);
  const { filteredCases, reviewers } = useCaseWorklist(cases, {
    searchQuery, worklistTab, statusFilter, reviewerFilter, user,
  });
  const worklistMetrics = {
    total: cases.length,
    awaiting: cases.filter((item) => item.status === 'New' || !item.reviewer).length,
    reviewing: cases.filter((item) => item.status === 'In Review').length,
    reviewed: cases.filter((item) => item.status === 'Reviewed').length,
    slides: cases.reduce((total, item) => total + item.slide_count, 0),
  };
  const formatDate = (value) => {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };

  const slideUploadForm = showSlideForm ? <form className="add-slide-form" onSubmit={addSlide}>
    <Field label="Slide label *"><input name="label" required maxLength={120} placeholder="Slide A H&E" /></Field>
    <Field label="Stain"><input name="stain" placeholder="H&E, IHC, PAS…" /></Field>
    <Field label="Specimen description"><input name="specimen_description" placeholder="Block, level, tissue…" /></Field>
    <Field label={`File (JPG/PNG max 10 MB, SVS/TIF/TIFF max ${wsiLimitMb} MB) *`}><input name="image" required type="file" accept="image/jpeg,image/png,image/tiff,.svs,.tif,.tiff" /></Field>
    <button className="btn-primary" disabled={busy}><Upload size={16} /> {busy ? 'Uploading…' : 'Upload Slide'}</button>
  </form> : null;
  const canRemoveSlides = ['Laboratory Manager', SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE].includes(user?.role);
  const selectWorklist = (tab) => {
    setWorklistTab(tab);
    if (tab === 'All') {
      setSearchQuery('');
      setStatusFilter('All');
      setReviewerFilter('All');
    }
  };

  if (!user) return <Login />;
  return (
    <main id="main-content" className={`layout${showCreateCase ? ' layout--create-case' : ''}${selectedCase ? ` layout--case-review layout--section-${caseSection}` : ''}`}>
      {selectedCase && !showCreateCase && (
        <section className="case-review-hero" aria-label="Case review header">
          <div className="case-review-hero__crumbs"><Link to="/cases">Cases workspace</Link><ChevronDown size={14} /><strong>{selectedCase.case_id}</strong></div>
          <div className="case-review-hero__main">
            <div><div className="case-review-hero__title"><h1>{selectedCase.case_id}</h1><span className={`review-status status-${(selectedCase.status || 'New').toLowerCase().replace(' ', '-')}`}>{selectedCase.status || 'New'}</span></div>
              <p>{selectedCase.description || 'Histology case'} · {selectedCase.slide_count} slides · Assigned to {selectedCase.reviewer || 'Unassigned'}</p>
            </div>
            <div className="case-review-hero__meta"><div><small>Patient / specimen ID</small><strong>{selectedCase.patient_identifier || selectedCase.patient_id || 'Not recorded'}</strong></div><div><small>Specimen type</small><strong>{selectedCase.specimen_type || selectedCase.description || 'Not recorded'}</strong></div><div><small>Case created</small><strong>{formatDate(selectedCase.created_at)}</strong></div></div>
          </div>
          <Tabs className="case-review-tabs" ariaLabel="Case sections" value={caseSection} onChange={(key) => openCaseSection(key, key === 'details' ? 'review' : key === 'report' ? 'report' : null)}
            items={[{ value: 'slides', label: 'Slide comparison', icon: FileImage }, { value: 'details', label: 'Case details', icon: ClipboardCheck }, { value: 'report', label: 'Report', icon: Edit3 }]} />
        </section>
      )}

      {!isAuditorRole(user?.role) && showCreateCase && (
        <CreateCaseForm onSubmit={createCase} selectedPatient={selectedPatient} onPatientChange={setSelectedPatient}
          requestedPatientId={requestedPatientId} busy={busy} reviewersLoading={reviewersLoading}
          reviewersError={reviewersError} availableReviewers={availableReviewers} />
      )}

      {!showCreateCase && (
        <section className="columns case-workspace">
          <aside className="sidebar-card">
            <div className="sidebar-title-row"><h2>Cases</h2><span className="case-count-pill">{cases.length}</span></div>
            <div className="worklist-tabs" role="tablist" aria-label="Case worklists">
              {['All', 'My Cases', 'Unassigned', 'Awaiting Review', 'Completed'].map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={worklistTab === tab} className={worklistTab === tab ? 'worklist-tab worklist-tab--active' : 'worklist-tab'} onClick={() => selectWorklist(tab)}>{tab}</button>
              ))}
            </div>
            <div className="search-bar"><Search size={16} className="search-icon" /><input placeholder="Search cases…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
            <div className="archive-filters">
              <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>All</option><option>New</option><option>In Review</option><option>Reviewed</option></select>
              <select aria-label="Filter by reviewer" value={reviewerFilter} onChange={(e) => setReviewerFilter(e.target.value)}><option>All</option>{reviewers.map((reviewer) => <option key={reviewer}>{reviewer}</option>)}</select>
            </div>
            <div className="cases-list-scroll">
              {!cases.length ? <Empty icon={FileImage} title="No cases yet" text="Create a case to begin." /> :
                !filteredCases.length ? <Empty icon={Search} title="No matching cases" text="Try another worklist or clear the filters." /> :
                  filteredCases.map((item) => <button type="button" key={item.id} className={`case ${item.id === selectedCaseId ? 'case-active' : ''}`} aria-pressed={item.id === selectedCaseId} onClick={() => selectCase(item)}>
                    <div className="case-item-header"><strong className="case-id">{item.case_id}</strong><span className="case-count-pill">{item.slide_count} slides</span></div>
                    <p className="case-desc">{item.description || 'No case description'}</p>
                    <div className="case-review-summary"><span className={`review-status status-${(item.status || 'New').toLowerCase().replace(' ', '-')}`}>{item.status || 'New'}</span><span><UserRound size={12} /> {item.reviewer || 'Unassigned'}</span></div>
                    <div className="case-footer"><Calendar size={12} /> {formatDate(item.created_at)}</div>
                  </button>)}
            </div>
          </aside>

          <section className="viewer-card multi-slide-card">
            {!selectedCase ? (
              <div className="viewer-placeholder"><Empty icon={Layers} title="Select a case" text="Open a case to view its slides." /></div>
            ) : (
              <>
                <div className="viewer-header">
                  <div className="viewer-info-title"><Layers size={20} color="var(--primary)" /><h2>{selectedCase.case_id}</h2><span className="specimen-tag">{selectedCase.slide_count} slides</span></div>
                  <div className="viewer-header-actions">
                    {isAdministratorRole(user?.role) && <button type="button" className="btn-control-secondary btn-case-remove" onClick={() => setDeleteCaseTarget(selectedCase)}><Trash2 size={15} /> Remove case</button>}
                    {!isAuditorRole(user?.role) && <button type="button" className="btn-control-secondary" onClick={() => setShowSlideForm((value) => !value)}><Upload size={15} /> Add slide</button>}
                  </div>
                </div>
                {caseSection === 'details' && <section className="case-tab-page"><h2>Case details</h2><dl className="case-tab-detail-grid"><div><dt>Status</dt><dd>{selectedCase.status || 'New'}</dd></div><div><dt>Patient ID</dt><dd>{selectedCase.patient_identifier || selectedCase.patient_id || 'Not recorded'}</dd></div><div><dt>Reviewer</dt><dd>{selectedCase.reviewer || 'Unassigned'}</dd></div></dl></section>}
                {caseSection === 'report' && <section className="case-tab-page case-tab-page--report"><ReportEditor selectedCase={selectedCase} selectSlide={selectSlide} setMessage={reportMessage} onReportFinalized={refresh} /></section>}

                <aside className="case-inspector">
                  <div className="inspector-tabs" role="tablist" aria-label="Case details">
                    {['review', 'timeline', 'links', 'report'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={inspectorTab === tab} className={inspectorTab === tab ? 'inspector-tab inspector-tab--active' : 'inspector-tab'} onClick={() => setInspectorTab(tab)}>{tab === 'review' ? 'Review & QC' : tab === 'links' ? 'Related Cases' : tab === 'timeline' ? 'Timeline' : 'Report'}</button>)}
                  </div>
                  {inspectorTab === 'review' && <section className="review-panel" key={`review-${selectedCase.id}`}>
                    <div className="review-panel-title"><ClipboardCheck size={17} /><div><h3>Case review</h3><span>Review status and recorded notes.</span></div></div>
                    {isAuditorRole(user?.role) ? <p className="review-empty">Auditor mode: Read-only access.</p> : <>
                      <form onSubmit={(e) => updateReview(e, 'status', 'Status updated.')}><Field label="Case status"><select name="status" defaultValue={selectedCase.status || 'New'}>{CASE_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></Field><button type="submit" className="btn-primary" disabled={busy}>Update status</button></form>
                      <form onSubmit={addReviewNote}><Field label="Review note"><textarea name="note" required /></Field><button type="submit" className="btn-primary" disabled={busy}>Add note</button></form>
                    </>}
                    <div className="review-records"><details open><summary>Notes ({(selectedCase.review_notes || []).length})</summary>{(selectedCase.review_notes || []).map((note) => <article key={note.id}><strong>{note.author}</strong><p>{note.note}</p></article>)}</details></div>
                  </section>}
                  {inspectorTab === 'timeline' && <section className="review-panel inspector-tab-content"><h3>Audit & Case Timeline</h3>{timelineLoading ? <p>Loading…</p> : caseTimelineEvents.map((evt, idx) => <div key={idx} className="timeline-item"><strong>{evt.summary}</strong><time>{formatDate(evt.event_at)}</time></div>)}</section>}
                  {inspectorTab === 'links' && <section className="review-panel inspector-tab-content"><h3>Related Cases</h3>{linksLoading ? <p>Loading…</p> : caseRelatedLinks.map((link) => <div key={link.id} className="link-item"><strong>Case #{link.related_case_id}</strong></div>)}</section>}
                  {inspectorTab === 'report' && <ReportEditor selectedCase={selectedCase} selectSlide={selectSlide} setMessage={reportMessage} onReportFinalized={refresh} />}
                </aside>

{showSlideForm && !(selectedCase.slides || []).length && slideUploadForm}

            {!(selectedCase.slides || []).length ? <div className="viewer-placeholder case-empty">
              <Empty icon={FileImage} title="This case has no slides" text="Use Add Slide to attach a JPG, PNG, or SVS file." />
            </div> : <>
              <div className="slide-tray" aria-label="Case slide tray">
                <div className="slide-tray-heading"><strong>Slides ({selectedCase.slides.length})</strong><button type="button" className="btn-control-secondary" onClick={() => setShowSlideForm((value) => !value)}><Plus size={13} /> Add</button></div>
                {selectedCase.slides.map((slide) => <div key={slide.id} className={`tray-item ${slide.id === selectedSlideId ? 'tray-active' : ''} ${compareSlideIds.includes(slide.id) ? 'tray-compare-active' : ''}`}>
                  <button type="button" className="tray-select" onClick={() => selectSlide(slide)}>
                    <img src={slide.thumbnail_url} alt={`${slide.label} thumbnail`} loading="lazy" />
                    <span className="tray-copy"><strong>{slide.label}</strong><small>{slide.stain || 'Unspecified stain'}</small>
                      <span><b>{slide.file_type === 'wsi' || slide.file_type === 'dicom-wsi' ? 'WSI' : slide.format}</b><i className={`upload-state ${slide.upload_state}`}>{slide.upload_state}</i>
                        {slide.qc_status && <span className={`qc-badge qc-${slide.qc_status.replace(/\s+/g, '-').toLowerCase()}`}>{slide.qc_status}</span>}
                      </span></span>
                  </button>
                  <div className="tray-actions">
                    <button type="button" className="tray-edit" aria-label={`Edit ${slide.label}`} title="Edit slide details" onClick={() => setEditingSlideId(slide.id)}><Edit3 size={14} /></button>
                    {canRemoveSlides && <button type="button" className="tray-delete" aria-label={`Remove ${slide.label}`} title="Remove slide" onClick={() => setDeleteSlideTarget(slide)}><Trash2 size={14} /></button>}
                    <button type="button" className="tray-compare" disabled={slide.id === selectedSlideId || (openScreenCount >= MAX_VIEWER_SCREENS && !compareSlideIds.includes(slide.id))} aria-label={compareSlideIds.includes(slide.id) ? `Remove ${slide.label} from multi-screen view` : `Add ${slide.label} to multi-screen view`} aria-pressed={compareSlideIds.includes(slide.id)} title={slide.id === selectedSlideId ? 'Primary screen' : openScreenCount >= MAX_VIEWER_SCREENS && !compareSlideIds.includes(slide.id) ? 'Maximum 4 screens reached' : compareSlideIds.includes(slide.id) ? 'Remove screen' : 'Add screen'} onClick={() => toggleScreenSlide(slide)}><Columns size={14} /></button>
                  </div>
                </div>)}
              </div>
              {slideUploadForm}

              {selectedSlide && editingSlideId === selectedSlide.id && <form className="edit-slide-form" onSubmit={(event) => saveSlide(event, selectedSlide)}>
                <Field label="Label"><input name="label" required defaultValue={selectedSlide.label} /></Field>
                <Field label="Stain"><input name="stain" defaultValue={selectedSlide.stain} /></Field>
                <Field label="Specimen description"><input name="specimen_description" defaultValue={selectedSlide.specimen_description} /></Field>
                <button className="btn-primary" disabled={busy}>Save</button>
                <button type="button" className="btn-control-secondary" onClick={() => setEditingSlideId(null)}>Cancel</button>
              </form>}

              {selectedSlide && editingSlideId === selectedSlide.id && ['Laboratory Manager', 'Pathologist', SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE].includes(user?.role) && <form className="edit-slide-form qc-form" onSubmit={(event) => saveSlideQc(event, selectedSlide)}>
                <h4 className="qc-title">Quality control</h4>
                <Field label="Status">
                  <select name="qc_status" defaultValue={selectedSlide.qc_status || ''}>
                    <option value="">None</option>
                    <option value="Pass">Pass</option>
                    <option value="Needs rescan">Needs rescan</option>
                    <option value="Cannot assess">Cannot assess</option>
                  </select>
                </Field>
                <div className="qc-defects">
                  <label><input type="checkbox" name="qc_missing_tissue" defaultChecked={selectedSlide.qc_missing_tissue} /> Missing tissue</label>
                  <label><input type="checkbox" name="qc_blur" defaultChecked={selectedSlide.qc_blur} /> Blur</label>
                  <label><input type="checkbox" name="qc_scan_artifact" defaultChecked={selectedSlide.qc_scan_artifact} /> Scan artifact</label>
                  <label><input type="checkbox" name="qc_incorrect_label" defaultChecked={selectedSlide.qc_incorrect_label} /> Incorrect label</label>
                  <label><input type="checkbox" name="qc_unusual_staining" defaultChecked={selectedSlide.qc_unusual_staining} /> Unusual staining</label>
                </div>
                <Field label="Note (optional)"><input name="qc_note" defaultValue={selectedSlide.qc_note || ''} /></Field>
                <button className="btn-primary" disabled={busy}>Save QC</button>
              </form>}


              {selectedSlide && !splitView && <SlideViewer key={selectedSlide.id} slide={selectedSlide} zoom={zoom} setZoom={setZoom}
                position={position} setPosition={setPosition} dragStart={dragStart} setDragStart={setDragStart}
                isDragging={isDragging} setIsDragging={setIsDragging} viewerRef={viewerRef}
                reset={resetRasterView} onError={viewerError} onOpenCompare={openSideBySideComparison} activePanel={caseSection === 'ai' ? 'ai' : 'findings'} />}

              {selectedSlide && splitView && compareSlideIds.length > 0 && <div className="compare-container">
                <div className="compare-toolbar">
                  <div className="multi-screen-summary"><Columns size={15} /><strong>{openScreenCount} screens</strong><span>Maximum {MAX_VIEWER_SCREENS}</span></div>
                  <label className="toggle-control"><input type="checkbox" checked={syncViews} onChange={e => setSyncViews(e.target.checked)} /><span>Synchronize navigation</span></label>
                  <button className="btn-control-secondary" onClick={() => setSplitView(false)}><X size={15} /> Exit split view</button>
                </div>
                <div className={`compare-panels screen-count-${compareSlides.length + 1}`}>
                  <div className="compare-panel primary-panel">
                    <div className="screen-label"><span>Primary</span><strong>{selectedSlide.label}</strong></div>
                    <SlideViewer key={selectedSlide.id} slide={selectedSlide} zoom={zoom} setZoom={setZoom}
                      position={position} setPosition={setPosition} dragStart={dragStart} setDragStart={setDragStart}
                      isDragging={isDragging} setIsDragging={setIsDragging} viewerRef={viewerRef}
                      reset={resetRasterView} onError={viewerError} onOpenCompare={openSideBySideComparison} syncViews={syncViews} syncedViewerRef={secondaryViewerRefs} isPrimary={true} activePanel={caseSection === 'ai' ? 'ai' : 'findings'} />
                  </div>{compareSlides.map((compareSlide, index) => <div className="compare-panel secondary-panel" key={compareSlide.id}>
                    <div className="screen-label"><span>Screen {index + 2}</span><strong>{compareSlide.label}</strong><button type="button" aria-label={`Close ${compareSlide.label} screen`} onClick={() => toggleScreenSlide(compareSlide)}><X size={13} /></button></div>
                    <SlideViewer key={compareSlide.id + '-compare'} slide={compareSlide} zoom={syncViews ? zoom : zoom2} setZoom={syncViews ? setZoom : setZoom2}
                      position={syncViews ? position : position2} setPosition={syncViews ? setPosition : setPosition2} dragStart={dragStart2} setDragStart={setDragStart2}
                      isDragging={isDragging2} setIsDragging={setIsDragging2} viewerRef={index === 0 ? viewerRef2 : index === 1 ? viewerRef3 : viewerRef4}
                      reset={resetRasterView} onError={viewerError} onOpenCompare={openSideBySideComparison} syncViews={syncViews} syncedViewerRef={viewerRef} isPrimary={false} activePanel={caseSection === 'ai' ? 'ai' : 'findings'} />
                  </div>)}
                </div>
              </div>}
            </>}
          </>}
        </section>
      )}
      <Modal open={Boolean(deleteSlideTarget)} title="Remove slide" onClose={() => !busy && setDeleteSlideTarget(null)} footer={<><button type="button" onClick={() => setDeleteSlideTarget(null)}>Cancel</button><button type="button" className="btn-delete" disabled={busy} onClick={removeSlide}>Remove slide</button></>}><p>Remove <strong>{deleteSlideTarget?.label}</strong> and its analysis records?</p></Modal>
      <Modal open={Boolean(deleteCaseTarget)} title="Remove case" onClose={() => !busy && setDeleteCaseTarget(null)} footer={<><button type="button" onClick={() => setDeleteCaseTarget(null)}>Cancel</button><button type="button" className="btn-delete" disabled={busy} onClick={removeCase}>Remove case</button></>}><p>Remove case <strong>{deleteCaseTarget?.case_id}</strong> and its related records?</p></Modal>
    </main>
  );
}
