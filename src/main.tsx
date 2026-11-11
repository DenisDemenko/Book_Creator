import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary';
import {LanguageProvider} from './i18n/LanguageContext';
import {installApiBasePath} from './utils/basePath';
import {installPrivacyGuard} from './utils/privateStore';
import './index.css';
import './styles/tokenModuleTheme.css';

// До першого рендера: коли Nova роздається під префіксом (/studio на
// домені маркетплейсу — Фаза G3), запити до /api мають нести цей префікс.
// Без префікса не робить нічого. Деталі — src/utils/basePath.ts.
installApiBasePath();
// Приватні матеріали (журнал #549): поки відкрито такий матеріал, запити зі вмістом до Studio блокуються.
installPrivacyGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Зовнішня межа: ловить падіння самого App (шапка, модалки, гідратація). */}
    <ErrorBoundary>
      {/* Двомовність (UA/EN) користувацької частини сайту — src/i18n/LanguageContext.tsx */}
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
