import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../modules/auth/AuthProvider';
import { caseService } from '../../services/caseService';
import { patientService } from '../../services/patientService';
import vistaLogo from '../../assets/logo and images/VISTA logo white transparent.png';
import './TopBar.css';

export default function TopBar() {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ cases: [], patients: [] });
  const [profileOpen, setProfileOpen] = useState(false);
  const accountRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('vista-theme') || 'light');
  const displayName = user?.display_name || user?.username || 'User';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('vista-theme', theme);
  }, [theme]);

  const applyTheme = (nextTheme) => {
    const root = document.documentElement;
    const switchTheme = () => {
      root.classList.add('theme-animating');
      setTheme(nextTheme);
      window.setTimeout(() => root.classList.remove('theme-animating'), 360);
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTheme(nextTheme);
      return;
    }

    if (typeof document.startViewTransition === 'function') {
      root.classList.add('theme-animating');
      const transition = document.startViewTransition(() => {
        setTheme(nextTheme);
      });
      transition.finished.finally(() => {
        root.classList.remove('theme-animating');
      });
      return;
    }

    switchTheme();
  };

  useEffect(() => {
    if (!profileOpen) return undefined;
    const closeOnOutside = (event) => {
      if (!accountRef.current?.contains(event.target)) setProfileOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [profileOpen]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults({ cases: [], patients: [] });
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const requests = [caseService.list({ search: term, limit: 5 }, controller.signal)];
        if (user?.role !== 'Pathologist') requests.push(patientService.list({ search: term, page: 1, page_size: 5 }, controller.signal));
        const [caseData, patientData] = await Promise.all(requests);
        setResults({
          cases: Array.isArray(caseData) ? caseData : caseData?.items || [],
          patients: Array.isArray(patientData) ? patientData : patientData?.items || [],
        });
      } catch (error) {
        if (error.name !== 'AbortError') setResults({ cases: [], patients: [] });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, user?.role]);

  return <header className="top-bar">
    <Link to="/" className="top-bar__brand" aria-label="VISTA home"><img src={vistaLogo} alt="VISTA®" /></Link>
    <div className="top-bar__search-wrap">
      <label className="top-bar__search"><span className="sr-only">Search cases and patients</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ..." /></label>
      {query.trim().length >= 2 && <div className="top-bar__results">
        {results.cases.map((item) => <Link key={`case-${item.id}`} to={`/cases?case=${item.id}`} onClick={() => setQuery('')}><strong>Case</strong><span>{item.case_id || item.id} · {item.description || 'Pathology case'}</span></Link>)}
        {results.patients.map((item) => <Link key={`patient-${item.id}`} to={`/patients/${item.id}`} onClick={() => setQuery('')}><strong>Patient</strong><span>{item.display_label || item.patient_identifier || item.id}</span></Link>)}
        {!results.cases.length && !results.patients.length && <p>No permitted records found.</p>}
      </div>}
    </div>
    <div className="top-bar__account" ref={accountRef}>
      <button type="button" className="top-bar__profile" aria-expanded={profileOpen} aria-haspopup="menu" aria-controls="top-bar-profile-menu" onClick={() => setProfileOpen((open) => !open)}>
        <span className="top-bar__avatar"><UserRound size={16} aria-hidden="true" /></span><span className="top-bar__identity"><strong>{displayName}</strong><small>{user?.role || 'User'}</small></span><ChevronDown className="top-bar__chevron" size={14} />
      </button>
      {profileOpen && <div className="top-bar__profile-menu" id="top-bar-profile-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <><Sun size={15} aria-hidden="true" /> Light mode</> : <><Moon size={15} aria-hidden="true" /> Dark mode</>}
        </button>
        <button type="button" role="menuitem" onClick={logout}><LogOut size={15} aria-hidden="true" /> Log out</button>
      </div>}
    </div>
  </header>;
}
