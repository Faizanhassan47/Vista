import { Activity, BrainCircuit, ClipboardList, FolderOpen, Images, LayoutDashboard, Microscope, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../modules/auth/AuthProvider';
import { isAdministratorRole, isProtectedSuperAdmin, SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE } from '../../config/roles';
import './ClinicalSidebar.css';

const isActive = (pathname, path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)) ? ' clinical-nav__link--active' : '';

export default function ClinicalSidebar({ branding }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const operations = ['Laboratory Manager', SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE].includes(user?.role);
  const isSuperAdmin = user?.role === SUPER_ADMIN_ROLE || isProtectedSuperAdmin(user?.username);

  return <aside className="clinical-sidebar" aria-label="Primary navigation">
    <Link to="/" className="clinical-brand">{branding?.logo ? <img src={branding.logo} alt="" /> : <Microscope size={23} />}<span><strong>{branding?.title || 'Digital Pathology Platform'}</strong><small>{branding?.subtitle || 'Digital Pathology Platform'}</small></span></Link>
    <nav className="clinical-nav">
      <span className="clinical-nav__label">WORKSPACE</span>
      <Link to="/" className={`clinical-nav__link${isActive(pathname, '/')}`}><LayoutDashboard size={16} />Dashboard</Link>
      <Link to="/cases" className={`clinical-nav__link${isActive(pathname, '/cases')}`}><ClipboardList size={16} />Cases workspace</Link>
      <Link to="/case-library" className={`clinical-nav__link${isActive(pathname, '/case-library')}`}><FolderOpen size={16} />Case library</Link>
      <Link to="/slides" className={`clinical-nav__link${isActive(pathname, '/slides')}`}><Images size={16} />Slide library</Link>
      {user?.role !== 'Pathologist' && <Link to="/patients" className={`clinical-nav__link${isActive(pathname, '/patients')}`}><UsersRound size={16} />Patient directory</Link>}
      <Link to="/ai-features" className={`clinical-nav__link${isActive(pathname, '/ai-features')}`}><BrainCircuit size={16} />AI Extensions</Link>
      {operations && <Link to="/platform" className={`clinical-nav__link${isActive(pathname, '/platform')}`}><Activity size={16} />Operations</Link>}
      {isAdministratorRole(user?.role) && <><span className="clinical-nav__spacer" /><span className="clinical-nav__label">MANAGEMENT</span><Link to="/admin" className={`clinical-nav__link${pathname === '/admin' ? ' clinical-nav__link--active' : ''}`}><ShieldCheck size={16} />Users & roles</Link><Link to="/admin/settings" className={`clinical-nav__link${isActive(pathname, '/admin/settings')}`}><Settings size={16} />System settings</Link>{isSuperAdmin && <><Link to="/admin/ai-features" className={`clinical-nav__link${isActive(pathname, '/admin/ai-features')}`}><Settings size={16} />AI model management</Link><Link to="/admin/ai-licensing" className={`clinical-nav__link${isActive(pathname, '/admin/ai-licensing')}`}><Settings size={16} />AI licensing</Link><Link to="/admin/logs" className={`clinical-nav__link${isActive(pathname, '/admin/logs')}`}><Activity size={16} />Activity logs</Link></>}</>}
    </nav>
  </aside>;
}
