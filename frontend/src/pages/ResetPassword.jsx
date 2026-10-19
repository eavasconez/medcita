import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../App';
import { KeyRound, Lock, ArrowRight, LinkIcon } from 'lucide-react';

const MIN_PASSWORD_LENGTH = 6;

const ResetPassword = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Keep the token in memory and take it out of the address bar straight away, so
  // it does not linger in the browser history, a bookmark or a screenshot.
  const [token] = useState(() => searchParams.get('token'));
  useEffect(() => {
    if (searchParams.has('token')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [invalidLink, setInvalidLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }

    setLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/api/auth/reset-password`, { token, password });
      // Whoever just reset their credentials starts from a clean session.
      logout();
      navigate('/login', {
        replace: true,
        state: { notice: 'Password updated. You can now sign in with your new password.' }
      });
    } catch (err) {
      if (err.response?.data?.code === 'INVALID_RESET_LINK') {
        setInvalidLink(true);
      } else {
        setError(err.response?.data?.error || 'Could not reset the password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // No token in the address, or the server said the link is unusable.
  if (!token || invalidLink) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center" role="alert">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-2xl mb-4">
            <LinkIcon className="text-red-500 w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-secondary">This link can&apos;t be used</h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            The password reset link is invalid, has expired or was already used. Reset links work once and
            last 60 minutes.
          </p>
          <Link to="/forgot-password" className="btn-primary mt-8 inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl">
            Request a new link <ArrowRight className="w-5 h-5" />
          </Link>
          <Link to="/login" className="mt-4 inline-block text-primary font-bold hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary bg-opacity-10 rounded-2xl mb-4">
            <KeyRound className="text-primary w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-secondary">Choose a new password</h1>
          <p className="text-slate-400 mt-2">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>

        {error && (
          <div role="alert" className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100 animate-shake">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              placeholder="New password"
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="password"
              required
              autoComplete="new-password"
              placeholder="Confirm new password"
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 rounded-xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 group text-lg"
          >
            {loading ? 'Saving...' : (
              <>
                Update password <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
