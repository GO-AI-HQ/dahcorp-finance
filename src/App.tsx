import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './hooks/useSession.js';
import { AppShell } from './components/AppShell.js';
import { LoginScreen } from './components/LoginScreen.js';
import { LoadingCards } from './components/States.js';
import { Overview } from './pages/Overview.js';
import { IncomeEngine } from './pages/IncomeEngine.js';
import { Portfolio } from './pages/Portfolio.js';
import { Semiconductor } from './pages/Semiconductor.js';
import { Opportunities } from './pages/Opportunities.js';
import { Simulator } from './pages/Simulator.js';
import { ClaudeConsole } from './pages/ClaudeConsole.js';
import { Activity } from './pages/Activity.js';
import { Settings } from './pages/Settings.js';

/**
 * The whole application is behind the session gate. There is no public route:
 * an unauthenticated visitor sees the sign-in screen and nothing else, and the
 * functions enforce the same rule independently.
 */
export function App() {
  const { session, loading, error } = useSession();

  if (loading) {
    return (
      <div className="main">
        <LoadingCards count={4} />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="login">
        <div className="card login__card" role="alert">
          <p className="card__label">
            <span>DAHCorp Finance</span>
          </p>
          <h1 style={{ fontSize: '1.3rem', marginBottom: 8 }}>Cannot reach the server</h1>
          <p className="meta">{error}</p>
          <button type="button" className="btn btn--gold btn--block" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) return <LoginScreen />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/income" element={<IncomeEngine />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/semiconductor" element={<Semiconductor />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/claude" element={<ClaudeConsole />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
