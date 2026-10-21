import React, { useState, useEffect, useRef, useContext } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { Building2, Lock, ArrowRight, LinkIcon } from 'lucide-react';

const MIN_PASSWORD_LENGTH = 6;
const ROLE_LABELS = { admin: 'Administrator', secretary: 'Secretary / Assistant', doctor: 'Medical Doctor' };

// Where the link of an invitation email lands: it says which clinic is inviting
// the person and lets them choose their own password.
const AcceptInvitation = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Keep the token in memory and take it out of the address bar straight away, so
  // it does not linger in the browser history, a bookmark or a screenshot.
  const [token] = useState(() => searchParams.get('token'));
  useEffect(() => {
    if (searchParams.has('token')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const [invitation, setInvitation] = useState(null);
  const [invalidLink, setInvalidLink] = useState(!token);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { startSession } = useContext(AuthContext);
  const navigate = useNavigate();
  const previewed = useRef(false);

  useEffect(() => {
    if (!token || previewed.current) return;
    previewed.current = true;
    axios
      .post(`${API_BASE_URL}/api/auth/invitation-preview`, { token })
      .then((res) => setInvitation(res.data))
      .catch(() => setInvalidLink(true));
  }, [token]);

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
      const res = await axios.post(`${API_BASE_URL}/api/auth/accept-invitation`, { token, password });
      startSession(res.data.token, res.data.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err.response?.data?.code === 'INVALID_LINK') {
        setInvalidLink(true);
      } else {
        setError(err.response?.data?.error || 'Could not accept the invitation. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (invalidLink) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center" role="alert">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-2xl mb-4">
            <LinkIcon className="text-red-500 w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-secondary">This invitation can&apos;t be used</h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            The link is invalid, has expired, was cancelled or was already used. Invitations work once and last
            7 days. Ask your clinic admin to send you a new one, or sign in if you already accepted it.
          </p>
          <Link to="/login" className="btn-primary mt-8 inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl">
            Go to sign in <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-slate-400 font-bold" role="status">Checking your invitation…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary bg-opacity-10 rounded-2xl mb-4">
            <Building2 className="text-primary w-8 h-8" />
          </div>
          <p className="text-slate-400 font-medium">{invitation.invitedByName} invited you to join</p>
          <h1 className="text-3xl font-extrabold text-secondary mt-1 break-words">{invitation.clinicName}</h1>
          <p className="mt-3 text-sm text-slate-500">
            as <span className="font-bold text-secondary">{ROLE_LABELS[invitation.role] || invitation.role}</span>
            {' · '}
            <span className="font-bold text-secondary">{invitation.email}</span>
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100 animate-shake">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <p className="text-slate-500 text-sm">Choose a password to create your account. At least {MIN_PASSWORD_LENGTH} characters.</p>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              placeholder="Password"
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
              placeholder="Confirm password"
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
            {loading ? 'Creating your account...' : (
              <>
                Create my account <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AcceptInvitation;
