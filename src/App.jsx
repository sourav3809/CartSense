import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import RunningLow from './pages/RunningLow';
import Settings from './pages/Settings';
import Prices from './pages/Prices';
import OrderChecklist from './pages/OrderChecklist';
import History from './pages/History';
import Insights from './pages/Insights';
import InstallPrompt from './components/InstallPrompt';
import OfflineBanner from './components/OfflineBanner';
import { setupSWNotificationListeners, autoRefreshSubscription } from './lib/notifications';

// Helper component to bind service worker deep links to React Router
function SWNavigationHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const cleanup = setupSWNotificationListeners(navigate);
    return cleanup;
  }, [navigate]);

  return null;
}

// Placeholder components for empty pages
const Placeholder = ({ title }) => (
  <div className="p-6">
    <h1 className="text-2xl font-bold mb-4">{title}</h1>
    <p className="text-muted">Coming soon...</p>
    <button onClick={() => window.history.back()} className="mt-4 text-brand font-medium">← Back</button>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        localStorage.setItem('userId', u.uid);
        // Objective 1: Auto refresh push subscription on startup
        autoRefreshSubscription(u.uid).catch((err) => {
          console.warn('[Notifications] Auto subscription refresh error on boot:', err);
        });
      } else {
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
      }
    });
    return unsubscribe;
  }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-brand font-bold">Loading...</div>;
  if (!user) return <Navigate to="/auth" />;
  return children;
};

export default function App() {
  return (
    <Router>
      <SWNavigationHandler />
      <div className="max-w-[375px] mx-auto min-h-screen bg-white relative shadow-2xl flex flex-col">
        <OfflineBanner />
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/running-low" element={<ProtectedRoute><RunningLow /></ProtectedRoute>} />
          
          {/* Settings, History, Insights */}
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
          <Route path="/prices" element={<ProtectedRoute><Prices /></ProtectedRoute>} />
          <Route path="/order/:platform" element={<ProtectedRoute><OrderChecklist /></ProtectedRoute>} />
        </Routes>
        <InstallPrompt />
      </div>
    </Router>
  );
}

