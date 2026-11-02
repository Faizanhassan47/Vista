import { Link, useLocation } from 'react-router-dom';
import TopBar from '../TopBar/TopBar';

const pages = {
  '/': ['Main Menu', ''],
  '/case-library': ['Case Library', ''],
  '/slides': ['Slide Library', ''],
  '/ai-features': ['AI Extensions', ''],
  '/patients': ['Patient Directory', ''],
  '/platform': ['Operations Control Center', ''],
  '/admin': ['User management', ''],
  '/admin/settings': ['System settings', ''],
  '/admin/logs': ['Activity logs', ''],
  '/admin/ai-licensing': ['AI licensing', ''],
  '/admin/ai-features': ['Manage AI Features', ''],
  '/cases': ['Case Workspace', ''],
  '/create-case': ['Case Library', ''],
};

export default function ClinicalShell({ children, pageTitle, pageSubtitle, backTo }) {
  const { pathname, search: locationSearch } = useLocation();
  const createCasePage = pathname === '/create-case' || (pathname === '/cases' && new URLSearchParams(locationSearch).get('createCase') === '1');
  const [defaultTitle] = pathname.startsWith('/patients/')
    ? ['Patient Profile', '']
    : (pages[pathname] || ['Pathology workspace', '']);
  const title = pageTitle || (createCasePage ? 'Create Case' : defaultTitle);
  const showBack = backTo !== undefined ? Boolean(backTo) : pathname !== '/';
  const backTarget = backTo ?? (createCasePage ? '/case-library' : '/');

  return <div className="clinical-shell"><div className={`clinical-shell__content${createCasePage ? ' clinical-shell__content--create-case' : ''}`}>
    <TopBar />
    <div className="library-shell__title"><strong>{title}</strong>{showBack && <Link to={backTarget}>&lt;&nbsp; Back</Link>}</div>
    {children}
  </div></div>;
}
