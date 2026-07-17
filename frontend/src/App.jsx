import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import Availability from './pages/Availability';
import AdminDoctors from './pages/AdminDoctors';
import Settings from './pages/Settings';
import Reports from './pages/Reports';

export const AuthContext = createContext();

const API_URL = 'http://localhost:5000/api';

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
