import { Activity, BrainCircuit, FileText, FolderOpen, HelpCircle, Images, Microscope, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isAdministratorRole, isProtectedSuperAdmin, SUPER_ADMIN_ROLE } from '../../config/roles';
import './Dashboard.css';

const workspaceCards = [['Case Library', '/case-library', Microscope, ''], ['Create Case', '/create-case', FolderOpen, ''], ['Slide Library', '/slides', Images, ''], ['Patient Directory', '/patients', UsersRound, ''], ['AI Extensions', '/ai-features', Sparkles, ''], ['Operations', '/platform', Activity, ''], ['Help Center', '/help', HelpCircle, '']];
const adminCards = [['Organization Management', '/admin', UsersRound], ['AI Models Management', '/admin/ai-features', BrainCircuit], ['AI Licensing', '/admin/ai-licensing', ShieldCheck], ['System Logs', '/admin/logs', FileText]];

function DashboardCard({ label, to, Icon, className = '' }) { return <Link className={`dashboard-card ${className}`} to={to}><strong>{label}</strong><Icon className="dashboard-card__icon" size={88} strokeWidth={1.4} /></Link>; }

export default function Dashboard() {
  const { user } = useAuth();
  const canOperate = ['Laboratory Manager', 'System Administrator', SUPER_ADMIN_ROLE].includes(user?.role);
  const canManage = isAdministratorRole(user?.role);
  const canManageModels = user?.role === SUPER_ADMIN_ROLE || isProtectedSuperAdmin(user?.username);
  return <main className="dashboard-home" id="main-content">
    <section className="dashboard-home__content"><div className="dashboard-home__grid">{workspaceCards.map(([label, to, Icon, className]) => { if (label === 'Patient Directory' && user?.role === 'Pathologist') return null; if (label === 'Operations' && !canOperate) return null; return <DashboardCard key={label} label={label} to={to} Icon={Icon} className={className} />; })}</div>{canManage && <><h2>System Administration</h2><div className="dashboard-home__grid dashboard-home__grid--admin">{adminCards.map(([label, to, Icon]) => { if (label === 'AI Models Management' && !canManageModels) return null; return <DashboardCard key={label} label={label} to={to} Icon={Icon} />; })}</div></>}</section>
  </main>;
}
