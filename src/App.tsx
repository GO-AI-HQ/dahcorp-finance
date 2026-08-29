import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './hooks/useSession.js';
import { AppShell } from './components/AppShell.js';
import { LoginScreen } from './components/LoginScreen.js';
import { LoadingCards } from './components/States.js';
import { OverviewV2 } from './pages/OverviewV2.js';
import { IncomeEngine } from './pages/IncomeEngine.js';
import { PortfolioV2 } from './pages/PortfolioV2.js';
import { Growth } from './pages/Growth.js';
import { Intelligence } from './pages/Intelligence.js';
import { StrategyLab } from './pages/StrategyLab.js';
import { ClaudeConsole } from './pages/ClaudeConsole.js';
import { Activity } from './pages/Activity.js';
import { Settings } from './pages/Settings.js';

export function App() {
  const { session, loading, error } = useSession();

  if (loading) {
    return <div className="main"><LoadingCards count={4} /></div>;
  }

  if (error && !session) {
    return (
      <div className="login">
        <div className="card login__card" role="alert">
          <p className="card__label"><span>DAHCorp Finance</span></p>
          <h1 style={{ fontSize: '1.3rem', marginBottom: 8 }}>Cannot reach the server</h1>
          <p className="meta">{error}</p>
          <button type="button" className="btn btn--gold btn--block" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) return <LoginScreen />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<OverviewV2 />} />
        <Route path="/income" element={<IncomeEngine />} />
        <Route path="/portfolio" element={<PortfolioV2 />} />
        <Route path="/growth" element={<Growth />} />
        <Route path="/intelligence" element={<Intelligence />} />
        <Route path="/strategy-lab" element={<StrategyLab />} />
        <Route path="/agent" element={<ClaudeConsole />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/settings" element={<Settings />} />

        <Route path="/semiconductor" element={<Navigate to="/growth?tab=semiconductors" replace />} />
        <Route path="/opportunities" element={<Navigate to="/growth?tab=opportunities" replace />} />
        <Route path="/simulator" element={<Navigate to="/strategy-lab" replace />} />
        <Route path="/claude" element={<Navigate to="/agent" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
