import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/variables.css';
import './styles/global.css';
import './styles/clinical.css';
import { AuthProvider } from './modules/auth/AuthProvider';
import { Toaster } from 'react-hot-toast';
import { APP_NAME } from './config';
import AppRouter from './routes/AppRouter';

document.title = APP_NAME;
document.documentElement.dataset.theme = 'vista';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AppRouter />
      <Toaster position="bottom-right" />
    </AuthProvider>
  </StrictMode>,
);
