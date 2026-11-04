import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { isAdministratorRole, isProtectedSuperAdmin, SUPER_ADMIN_ROLE } from '../../config/roles';
import './Dashboard.css';

function CardIcon({ children }) {
  return <svg className="dashboard-card__icon" viewBox="0 0 88 72" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

const icons = {
  caseLibrary: () => <CardIcon><path d="M28 58h32M36 58V46M52 58V46M34 46h20l4-16H30l4 16z" /><path d="M40 30V18M48 30V18M34 18h20" /><circle cx="44" cy="12" r="5" /><path d="M49 12h16M58 8v8" /></CardIcon>,
  workspace: () => <CardIcon><path d="M18 26h18l4 5h30v31H18V26z" /><path d="M26 40h28M26 48h20" /></CardIcon>,
  slides: () => <CardIcon><path d="M22 48h28v8H22zM26 40h28v8H26z" /><path d="M48 18c8 0 14 8 14 16" /><path d="M54 16l8-6 6 8-8 6" /><path d="M62 10v8" /></CardIcon>,
  patients: () => <CardIcon><circle cx="34" cy="24" r="9" /><path d="M18 54c2-12 10-18 16-18s14 6 16 18" /><path d="M58 28h16M58 38h16M58 48h12" /></CardIcon>,
  ai: () => <CardIcon><path d="M30 46l4-12 4 12M28 42h12" /><path d="M52 28l3-8 3 8M50 25h10" /><path d="M24 30l2-4 2 4" /></CardIcon>,
  operations: () => <CardIcon><circle cx="44" cy="36" r="8" /><path d="M44 22v6M44 44v6M30 36h6M52 36h6M34 26l4 4M50 42l4 4M34 46l4-4M50 30l4-4" /><path d="M62 22a22 22 0 0 1 0 28M26 50a22 22 0 0 1 0-28" /></CardIcon>,
  help: () => <CardIcon><circle cx="44" cy="36" r="18" /><path d="M38 32a6 6 0 1 1 8 6c-2 1-2 2-2 4" /><path d="M44 50h.1" /></CardIcon>,
  organization: () => <CardIcon><circle cx="30" cy="24" r="6" /><circle cx="48" cy="22" r="6" /><circle cx="40" cy="38" r="6" /><path d="M16 54c1-8 6-12 14-12M34 54c1-8 6-12 14-12M48 40c6 1 10 5 12 12" /><circle cx="62" cy="30" r="6" /><path d="M62 24v-3M62 39v-3M56 30h-3M71 30h-3" /></CardIcon>,
  models: () => <CardIcon><circle cx="44" cy="36" r="8" /><path d="M44 22v6M44 44v6M30 36h6M52 36h6" /><circle cx="22" cy="22" r="3" /><circle cx="66" cy="22" r="3" /><circle cx="22" cy="52" r="3" /><circle cx="66" cy="52" r="3" /><path d="M25 24l10 8M63 24L53 32M25 50l10-8M63 50L53 42" /></CardIcon>,
  licensing: () => <CardIcon><rect x="20" y="18" width="40" height="28" rx="3" /><path d="M32 54h16M36 46v8" /><path d="M48 34l4 4 8-10" /><circle cx="56" cy="40" r="10" /></CardIcon>,
  logs: () => <CardIcon><path d="M28 16h24l10 10v32H28V16z" /><path d="M52 16v10h10M36 36h16M36 44h12" /><circle cx="58" cy="50" r="8" /><path d="M58 46v5l3 2" /></CardIcon>,
};

const workspaceCards = [
  ['Case Library', '/case-library', icons.caseLibrary],
  //['Workspace', '/cases', icons.workspace],
  //['Slide Library', '/slides', icons.slides],
  ['Patient Directory', '/patients', icons.patients],
  ['AI Extensions', '/ai-features', icons.ai],
  //['Operations', '/platform', icons.operations],
  ['Help Center', '/help', icons.help],
];
const adminCards = [
  ['Organization Management', '/admin', icons.organization],
  ['AI Models Management', '/admin/ai-features', icons.models],
  ['AI Licensing', '/admin/ai-licensing', icons.licensing],
  ['System Logs', '/admin/logs', icons.logs],
];

function DashboardCard({ label, to, Icon, className = '' }) { return <Link className={`dashboard-card ${className}`} to={to}><strong>{label}</strong><Icon /></Link>; }

export default function Dashboard() {
  const { user } = useAuth();
  const canOperate = ['Laboratory Manager', 'System Administrator', SUPER_ADMIN_ROLE].includes(user?.role);
  const canManage = isAdministratorRole(user?.role);
  const canManageModels = user?.role === SUPER_ADMIN_ROLE || isProtectedSuperAdmin(user?.username);
  return <main className="dashboard-home" id="main-content">
    <section className="dashboard-home__content"><div className="dashboard-home__grid">{workspaceCards.map(([label, to, Icon]) => { if (label === 'Patient Directory' && user?.role === 'Pathologist') return null; if (label === 'Operations' && !canOperate) return null; return <DashboardCard key={label} label={label} to={to} Icon={Icon} />; })}</div>{canManage && <><h2>System Administration</h2><div className="dashboard-home__grid dashboard-home__grid--admin">{adminCards.map(([label, to, Icon]) => { if (label === 'AI Models Management' && !canManageModels) return null; return <DashboardCard key={label} label={label} to={to} Icon={Icon} />; })}</div></>}</section>
  </main>;
}
