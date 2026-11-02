import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from './AuthProvider';
import './Login.css';
import Button from '../../components/Button/Button';
import { platformService } from '../../services/platformService';
import microscopeImage from '../../assets/logo and images/logiin VISTA.png';
import vistaLogo from '../../assets/logo and images/VISTA logo .png';
import visoleLogo from '../../assets/logo and images/Visole.png';

export default function Login() {
  const { login, sessionExpired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [branding, setBranding] = useState({ title: 'Digital Pathology', subtitle: 'Sign in to continue to the case worklist.', logo: null, primaryColor: '' });

  useEffect(() => {
    const controller = new AbortController();
    platformService.branding(controller.signal).then((data) => {
      setBranding((current) => ({ ...current, ...data }));
      document.documentElement.dataset.theme = 'vista';
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    const result = await login(username, password);
    if (!result.success) toast.error(result.message);
    setLoading(false);
  };

  return <main className="login-container">
    <section className="login-visual" aria-label="Digital pathology laboratory">
      <img className="login-visual__image" src={microscopeImage} alt="Microscope" />
    </section>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-panel__content">
        <header className="login-header">
          <img className="login-brand" src={branding.logo || vistaLogo} alt="VISTA" />
          <h1 id="login-title">Sign in</h1>
          <p className="login-subtitle">{branding.subtitle}</p>
        </header>
      {sessionExpired && (
        <div className="login-session-expired-banner" role="alert">
          Session expired — please sign in again
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="login-username">Username</label>
          <input id="login-username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" placeholder="Enter your username" autoFocus />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <div className="password-field">
            <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)}
              onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))} required autoComplete="current-password" placeholder="Enter your password" />
            <Button type="button" variant="ghost" size="sm" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </Button>
          </div>
          {capsLock && <p className="field-hint field-hint--warning" role="status">Caps Lock is on.</p>}
        </div>
        <Button type="submit" loading={loading}>Sign in</Button>
      </form>
        <p className="login-disclaimer">Authorized laboratory use only. This prototype is not a diagnostic system.</p>
      </div>
      <footer className="login-panel__footer">
        <span>VISTA® (Visual Imaging, Scanning &amp; Tissue Analysis) developed by</span>
        <img src={visoleLogo} alt="Visole Group of Companies" />
      </footer>
    </section>
  </main>;
}
