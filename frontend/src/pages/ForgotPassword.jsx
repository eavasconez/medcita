import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { KeyRound, Mail, MailCheck, ArrowLeft, Send } from 'lucide-react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email });
      // The server answers the same way whether or not the email has an account,
      // so this screen never says which one it was.
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
        {sent ? (
          <div className="text-center" role="status">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-50 rounded-2xl mb-4">
              <MailCheck className="text-emerald-500 w-8 h-8" />
            </div>
            <h1 className="text-3xl font-extrabold text-secondary">Check your inbox</h1>
            <p className="text-slate-500 mt-3 leading-relaxed">
              If an account exists for <span className="font-bold text-secondary">{email}</span>, we have sent a
              link to reset your password. It expires in 60 minutes.
            </p>
            <p className="text-slate-400 text-sm mt-4">
              Nothing arrived? Check your spam folder, or{' '}
              <button type="button" onClick={() => setSent(false)} className="text-primary font-bold hover:underline">
                try a different email
              </button>
              .
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex items-center gap-2 text-primary font-bold hover:underline"
            >
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-primary bg-opacity-10 rounded-2xl mb-4">
                <KeyRound className="text-primary w-8 h-8" />
              </div>
              <h1 className="text-3xl font-extrabold text-secondary">Forgot your password?</h1>
              <p className="text-slate-400 mt-2">Enter your email and we will send you a link to choose a new one.</p>
            </div>

            {error && (
              <div role="alert" className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100 animate-shake">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="email"
                  required
                  autoFocus
                  placeholder="Email address"
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3.5 rounded-xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 text-lg"
              >
                {loading ? 'Sending...' : (
                  <>
                    Send reset link <Send className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            <p className="text-center mt-8 text-slate-500 text-sm">
              Remembered it?{' '}
              <Link to="/login" className="text-primary font-bold hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
