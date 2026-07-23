import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from './config/api';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import Availability from './pages/Availability';
import AdminDoctors from './pages/AdminDoctors';
import Settings from './pages/Settings';
import Reports from './pages/Reports';

export const AuthContext = createContext();

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

  const login = async (email, password) => {
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password });
      setToken(res.data.token);
      setUser(res.data.user);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
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
  const updateUser = (fields) => {
    setUser((prev) => {
      const next = { ...prev, ...fields };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  if (loading) return <div className="p-10 text-center">Loading...</div>;

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser }}>
      <Router>
        <Routes>
          <Route path="/login" element={!token ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/register" element={!token ? <Register /> : <Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={token ? <Dashboard /> : <Navigate to="/login" />} />
          <Route path="/patients" element={token ? <Patients /> : <Navigate to="/login" />} />
          <Route path="/availability" element={token ? <Availability /> : <Navigate to="/login" />} />
          <Route path="/settings" element={token ? <Settings /> : <Navigate to="/login" />} />
          <Route path="/admin" element={token && user?.role === 'admin' ? <AdminDoctors /> : <Navigate to="/dashboard" />} />
          <Route path="/reports" element={token && user?.role === 'admin' ? <Reports /> : <Navigate to="/dashboard" />} />
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
