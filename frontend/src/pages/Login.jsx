import React, { useState, useContext } from 'react';
import { AuthContext } from '../App';
import { Stethoscope } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full p-8 bg-white rounded-xl shadow-lg">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-primary bg-opacity-10 rounded-full mb-4">
            <Stethoscope className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-secondary">MedCita</h1>
          <p className="text-slate-500 mt-2">Agenda Médica Inteligente</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-500 rounded-lg text-sm border border-red-100 italic">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              required
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="demo@medcita.ec"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <input
              type="password"
              required
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-primary hover:bg-opacity-90 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transform active:scale-95 transition-all"
          >
            Iniciar Sesión
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <p className="text-sm text-slate-400">Credenciales de Demo:</p>
          <code className="text-xs text-primary bg-primary bg-opacity-5 p-1 rounded">demo@medcita.ec / demo1234</code>
        </div>
      </div>
    </div>
  );
};

export default Login;
