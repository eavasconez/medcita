import React, { useState, useContext, useEffect } from 'react';
import { AuthContext } from '../App';
import { Link } from 'react-router-dom';
import { Stethoscope, Mail, Lock, LogIn, FileText, Download } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useContext(AuthContext);

  // Picked up once after a global 401 (expired/invalid token) redirected here.
  useEffect(() => {
    const authMessage = sessionStorage.getItem('authMessage');
    if (authMessage) {
      setError(authMessage);
      sessionStorage.removeItem('authMessage');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,420px)] gap-8 items-center">

        {/* Demo guide panel — self-serve testing instructions for admin/doctor/secretary,
            so a pilot tester doesn't need someone from the team walking them through it. */}
        <div className="order-2 lg:order-1 bg-secondary text-white rounded-3xl p-8 sm:p-10 flex flex-col gap-5">
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center">
            <FileText className="text-white" size={26} />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight mb-2">Guía completa de demo</h2>
            <p className="text-white/60 font-medium text-sm leading-relaxed">
              Todo lo necesario para probar MedCita por tu cuenta, sin importar tu rol: credenciales de prueba, qué explorar como admin, médico o secretaria, y el flujo paso a paso de la funcionalidad principal — con capturas reales de la app.
            </p>
          </div>
          <ul className="space-y-2 text-sm text-white/70 font-medium">
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">→</span> Credenciales listas para admin, doctor y secretaria</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">→</span> Qué probar según tu rol</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">→</span> Cómo agendar una cita, paso a paso con capturas</li>
          </ul>
          <a
            href="/medcita-demo-guide.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center justify-center gap-2 bg-white text-secondary font-black py-3.5 rounded-2xl hover:bg-white/90 transition-colors uppercase tracking-widest text-xs"
          >
            <Download size={18} /> Descargar guía (PDF)
          </a>
        </div>

        <div className="order-1 lg:order-2 max-w-md w-full mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100">
        <div className="bg-primary p-8 sm:p-12 text-center text-white relative">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            {/* Pattern placeholder or subtle grid */}
            <div className="w-full h-full border-2 border-white/20 border-dashed rounded-full scale-150 rotate-45"></div>
          </div>
          
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 backdrop-blur-md rounded-[2rem] mb-6">
            <Stethoscope className="text-white w-10 h-10" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter mb-2">MedCita Core</h1>
          <p className="text-white/70 font-medium">Manage your professional medical agenda</p>
        </div>

        <div className="p-6 sm:p-10">
          {error && (
            <div className="mb-8 p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold border border-red-100 flex items-center gap-3 animate-shake">
              <span className="w-2 h-2 bg-red-600 rounded-full animate-ping"></span>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Professional Email</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={20} />
                <input
                  type="email"
                  required
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-bold text-secondary"
                  placeholder="doctor@hospital.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Password</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={20} />
                <input
                  type="password"
                  required
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-bold text-secondary"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-5 rounded-3xl shadow-primary/30 hover:shadow-primary/40 flex items-center justify-center gap-3 uppercase tracking-widest text-sm"
            >
              <LogIn size={20} />
              {loading ? 'Entering...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-10 text-center space-y-4">
            <p className="text-slate-500 text-sm font-medium">
              Are you new?{' '}
              <Link to="/register" className="text-primary font-black hover:underline underline-offset-4">
                Register here
              </Link>
            </p>
            <div className="pt-6 border-t border-slate-50">
              <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-2">Demo Quick Access</p>
              <code className="text-xs bg-slate-50 text-slate-400 px-3 py-1.5 rounded-full font-bold">demo@medcita.ec / demo1234</code>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
