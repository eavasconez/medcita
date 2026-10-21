import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { AuthContext } from './AuthContext';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from './config/api';
// Route-level code splitting: each page (and its own dependencies, e.g.
// Dashboard's react-big-calendar + lodash) ships in its own chunk instead of
// all being bundled into the initial load.
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Patients = lazy(() => import('./pages/Patients'));
const Availability = lazy(() => import('./pages/Availability'));
const AdminDoctors = lazy(() => import('./pages/AdminDoctors'));
const Settings = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));


// React.lazy() rejects (e.g. a chunk fails to load after a new deploy ships
// different asset hashes) throw during render, which Suspense does NOT
// catch - only an error boundary can. Without this, a stale tab hitting a
// missing chunk would show a blank/broken app with no way to recover short
// of the user manually refreshing.
class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Failed to load a page chunk:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-10 text-center">
          <p className="mb-4">Something went wrong loading this page.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-primary text-white font-bold"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const API_URL = `${API_BASE_URL}/api`;
const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please log in again.';

// Registered once at module load (every page shares this same global axios
// instance). Only reacts to 401s on requests that carried a token — this
// deliberately excludes /auth/login's own 401 ("Invalid credentials"), which
// is a normal form-validation error, not a session expiring mid-use.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const hadAuthHeader = !!error.config?.headers?.Authorization;
    if (error.response?.status === 401 && hadAuthHeader) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.setItem('authMessage', SESSION_EXPIRED_MESSAGE);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      // For demo, we just trust the token exists. In real app, verify with /me endpoint.
      setUser(JSON.parse(localStorage.getItem('user')));
    }
    setLoading(false);
  }, [token]);

  // Start (or replace) the session of whoever the server just signed in: after
  // logging in, and after using the link of a confirmation or invitation email.
  const startSession = useCallback((newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  }, []);

  const login = async (email, password) => {
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password });
      startSession(res.data.token, res.data.user);
      return true;
    } catch (err) {
      throw err.response?.data?.error || 'Login error';
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  // Merge fresh fields into the cached user (e.g. after a profile update) so the
  // sidebar and other screens reflect the change without forcing a re-login.
  const updateUser = useCallback((fields) => {
    setUser((prev) => {
      const next = { ...prev, ...fields };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  // Swap the session token for a fresh one without signing out (after a
  // password change the old token is no longer accepted).
  const updateToken = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  // A session saved before clinics existed has no clinic in its cached user: ask
  // for it once instead of making the person sign in again.
  useEffect(() => {
    if (!token || !user || user.clinic) return;
    axios
      .get(`${API_BASE_URL}/api/auth/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.data.clinic && updateUser({ clinic: res.data.clinic }))
      .catch(() => {}); // the name is cosmetic; the 401 interceptor already handles a dead session
  }, [token, user, updateUser]);

  // The tab says which clinic you are in (useful with several tabs or clinics open)
  const clinicName = user?.clinic?.name;
  useEffect(() => {
    document.title = clinicName ? `${clinicName} · MedCita` : 'MedCita';
  }, [clinicName]);

  if (loading) return <div className="p-10 text-center">Loading...</div>;

  return (
    <AuthContext.Provider value={{ user, token, login, startSession, logout, updateUser, updateToken }}>
      <Router>
        <RouteErrorBoundary>
          <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
            <Routes>
              <Route path="/login" element={!token ? <Login /> : <Navigate to="/dashboard" />} />
              <Route path="/register" element={!token ? <Register /> : <Navigate to="/dashboard" />} />
              <Route path="/forgot-password" element={!token ? <ForgotPassword /> : <Navigate to="/dashboard" />} />
              {/* Open to everyone, even with a session: whoever follows the emailed link must be able to use it */}
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/accept-invitation" element={<AcceptInvitation />} />
              <Route path="/dashboard" element={token ? <Dashboard /> : <Navigate to="/login" />} />
              <Route path="/patients" element={token ? <Patients /> : <Navigate to="/login" />} />
              <Route path="/availability" element={token ? <Availability /> : <Navigate to="/login" />} />
              <Route path="/settings" element={token ? <Settings /> : <Navigate to="/login" />} />
              <Route path="/admin" element={token && user?.role === 'admin' ? <AdminDoctors /> : <Navigate to="/dashboard" />} />
              <Route path="/reports" element={token && user?.role === 'admin' ? <Reports /> : <Navigate to="/dashboard" />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
