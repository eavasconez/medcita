import React, { useState, useEffect, useRef, useContext } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { MailCheck, LinkIcon, ArrowRight } from 'lucide-react';

// Where the link of the sign-up confirmation email lands. Opening it is the
// confirmation: the page uses the link right away and signs the new admin in.
const VerifyEmail = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Keep the token in memory and take it out of the address bar straight away, so
  // it does not linger in the browser history, a bookmark or a screenshot.
  const [token] = useState(() => searchParams.get('token'));
  useEffect(() => {
    if (searchParams.has('token')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const [failed, setFailed] = useState(!token);
  const { startSession } = useContext(AuthContext);
  const navigate = useNavigate();
  // The link works once: never send it twice (React runs effects twice in development)
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    axios
      .post(`${API_BASE_URL}/api/auth/verify-email`, { token })
      .then((res) => {
        startSession(res.data.token, res.data.user);
        navigate('/dashboard', { replace: true });
      })
      .catch(() => setFailed(true));
  }, [token, startSession, navigate]);

  if (failed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center" role="alert">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-2xl mb-4">
            <LinkIcon className="text-red-500 w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-secondary">This link can&apos;t be used</h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            The confirmation link is invalid, has expired or was already used. If you already confirmed your
            email, just sign in. Otherwise, sign up again to get a new link.
          </p>
          <Link to="/login" className="btn-primary mt-8 inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-xl">
            Sign in <ArrowRight className="w-5 h-5" />
          </Link>
          <Link to="/register" className="mt-4 inline-block text-primary font-bold hover:underline">
            Sign up again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center" role="status">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary bg-opacity-10 rounded-2xl mb-4">
          <MailCheck className="text-primary w-8 h-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-secondary">Confirming your email…</h1>
        <p className="text-slate-400 mt-2">Creating your clinic. This only takes a moment.</p>
      </div>
    </div>
  );
};

export default VerifyEmail;
