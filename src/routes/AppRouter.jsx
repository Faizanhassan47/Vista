import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../modules/auth/AuthProvider';
import ErrorBoundary from '../components/ErrorBoundary/ErrorBoundary';
import ClinicalShell from '../components/layout/ClinicalShell';
import Login from '../modules/auth/Login';
import { API_BASE_URL } from '../config';
import { isAdministratorRole, isProtectedSuperAdmin, SUPER_ADMIN_ROLE } from '../config/roles';

const Workspace = lazy(() => import('../modules/workspace/PathologyWorkspace'));
const Dashboard = lazy(() => import('../modules/dashboard/Dashboard'));
const SlideLibrary = lazy(() => import('../modules/slides/SlideLibrary'));
const CaseLibrary = lazy(() => import('../modules/cases/CaseLibrary'));
const AdminPanel = lazy(() => import('../components/AdminPanel/AdminPanel'));
const AdministrationLogs = lazy(() => import('../components/AdministrationLogs/AdministrationLogs'));
const PlatformOperations = lazy(() => import('../modules/platform/PlatformOperations'));
const PatientDirectory = lazy(() => import('../modules/patients/PatientDirectory'));
const PatientProfile = lazy(() => import('../modules/patients/PatientProfile'));
const AIFeatures = lazy(() => import('../modules/ai/AIFeatures'));
const AILicensing = lazy(() => import('../modules/ai/AILicensing'));
const ManageAIFeatures = lazy(() => import('../modules/ai/ManageAIFeatures'));
const SystemSettings = lazy(() => import('../modules/admin/SystemSettings'));

function LoadingScreen() { return <main className="route-loading" aria-live="polite"><span className="loading-spinner" /> Loading workspace...</main>; }
function ProtectedRoute({ adminOnly = false, superAdminOnly = false, operationsAccess = false, pathologistExcluded = false, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Login />;
  if (adminOnly && !isAdministratorRole(user.role)) return <Navigate to="/" replace />;
  if (superAdminOnly && user.role !== SUPER_ADMIN_ROLE && !isProtectedSuperAdmin(user.username)) return <Navigate to="/" replace />;
  if (operationsAccess && !isAdministratorRole(user.role) && user.role !== 'Laboratory Manager') return <Navigate to="/" replace />;
  if (pathologistExcluded && user.role === 'Pathologist') return <Navigate to="/" replace />;
  return children;
}
function AdminContent({ children }) { return <ClinicalShell><main id="main-content" className="admin-page-content"><div className="admin-page-inner">{children}</div></main></ClinicalShell>; }
function AdminPage() { return <AdminContent><AdminPanel API={API_BASE_URL} /></AdminContent>; }
function AdminLogsPage() { return <AdminContent><AdministrationLogs /></AdminContent>; }
function AILicensingPage() { return <AdminContent><AILicensing /></AdminContent>; }
function ManageAIFeaturesPage() { return <AdminContent><ManageAIFeatures /></AdminContent>; }
function SystemSettingsPage() { return <AdminContent><SystemSettings /></AdminContent>; }
function LibraryShell({ title, children }) { return <ClinicalShell pageTitle={title}>{children}</ClinicalShell>; }
function HelpCenterPage() { return <ClinicalShell pageTitle="Help Center"><main id="main-content" className="not-found"><h1>Help Center</h1><p>Help resources for the VISTA pathology workspace are being prepared.</p><Link to="/" className="btn-primary route-link">Return to dashboard</Link></main></ClinicalShell>; }
function NotFound() { return <ClinicalShell pageTitle="Page not found"><main id="main-content" className="not-found"><h1>Page not found</h1><p>The requested page does not exist.</p><Link to="/" className="btn-primary route-link">Return to workspace</Link></main></ClinicalShell>; }

export default function AppRouter() {
  return <BrowserRouter><Suspense fallback={<LoadingScreen />}><Routes>
    <Route path="/" element={<ProtectedRoute><ClinicalShell><ErrorBoundary title="The dashboard could not be displayed"><Dashboard /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/dashboard" element={<Navigate to="/" replace />} />
    <Route path="/slides" element={<ProtectedRoute><LibraryShell title="Slide Library"><ErrorBoundary title="The slide library could not be displayed"><SlideLibrary /></ErrorBoundary></LibraryShell></ProtectedRoute>} />
    <Route path="/case-library" element={<ProtectedRoute><LibraryShell title="Case Library"><ErrorBoundary title="The case library could not be displayed"><CaseLibrary /></ErrorBoundary></LibraryShell></ProtectedRoute>} />
    <Route path="/cases" element={<ProtectedRoute><ClinicalShell><ErrorBoundary title="The workspace could not be displayed"><Workspace /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/create-case" element={<ProtectedRoute><ClinicalShell><ErrorBoundary title="The create-case page could not be displayed"><Workspace /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/admin" element={<ProtectedRoute adminOnly><ErrorBoundary title="The admin panel could not be displayed"><AdminPage /></ErrorBoundary></ProtectedRoute>} />
    <Route path="/admin/settings" element={<ProtectedRoute adminOnly><ErrorBoundary title="System settings could not be displayed"><SystemSettingsPage /></ErrorBoundary></ProtectedRoute>} />
    <Route path="/admin/logs" element={<ProtectedRoute adminOnly><ErrorBoundary title="Activity logs could not be displayed"><AdminLogsPage /></ErrorBoundary></ProtectedRoute>} />
    <Route path="/admin/ai-licensing" element={<ProtectedRoute adminOnly><ErrorBoundary title="AI licensing could not be displayed"><AILicensingPage /></ErrorBoundary></ProtectedRoute>} />
    <Route path="/admin/ai-features" element={<ProtectedRoute superAdminOnly><ErrorBoundary title="AI feature management could not be displayed"><ManageAIFeaturesPage /></ErrorBoundary></ProtectedRoute>} />
    <Route path="/platform" element={<ProtectedRoute operationsAccess><ClinicalShell><ErrorBoundary title="Platform operations could not be displayed"><PlatformOperations /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/patients" element={<ProtectedRoute pathologistExcluded><ClinicalShell><ErrorBoundary title="The patient directory could not be displayed"><PatientDirectory /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/patients/:patientId" element={<ProtectedRoute pathologistExcluded><ClinicalShell><ErrorBoundary title="The patient profile could not be displayed"><PatientProfile /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/ai-features" element={<ProtectedRoute><ClinicalShell><ErrorBoundary title="AI features could not be displayed"><AIFeatures /></ErrorBoundary></ClinicalShell></ProtectedRoute>} />
    <Route path="/help" element={<ProtectedRoute><HelpCenterPage /></ProtectedRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes></Suspense></BrowserRouter>;
}
