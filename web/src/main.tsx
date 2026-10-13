import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoRoot } from './app/DemoRoot';
import { HttpRoot } from './app/HttpRoot';
import { applyTheme, savedTheme } from './app/theme';
import { I18nProvider } from './i18n/i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/print.css';

applyTheme(savedTheme());

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

// VITE_API_MODE=mock runs the billing engine in the page (the GitHub Pages demo);
// otherwise the dashboard talks to the server at VITE_API_URL.
const demo = import.meta.env.VITE_API_MODE === 'mock';
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

createRoot(root).render(
  <StrictMode>
    <I18nProvider>{demo ? <DemoRoot /> : <HttpRoot baseUrl={apiUrl} />}</I18nProvider>
  </StrictMode>,
);
