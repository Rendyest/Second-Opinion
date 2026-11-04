import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MockStreamProvider } from './mock/MockStreamContext';
import { AppNav } from './components/AppNav';
import { SetupPage } from './pages/SetupPage';
import { SessionPage } from './pages/SessionPage';
import { MetricsPage } from './pages/MetricsPage';
import { ReviewPage } from './pages/ReviewPage';
import { ValidationPage } from './pages/ValidationPage';

function NotFound() {
  return (
    <div>
      <h1>Page not found</h1>
      <p>Use the navigation above — Setup, Session, Metrics, Review, or Validation.</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MockStreamProvider>
        <AppNav />
        <main id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Navigate to="/setup" replace />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/validation" element={<ValidationPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </MockStreamProvider>
    </BrowserRouter>
  );
}
