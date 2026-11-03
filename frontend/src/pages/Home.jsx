import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, MessageCircle, FileText, ShieldCheck, Building2 } from 'lucide-react';
import PublicLayout from '../components/PublicLayout';

const FEATURES = [
  { icon: <CalendarCheck className="text-primary" size={26} />, title: 'Agenda de citas', text: 'Calendario por médico, horarios de atención, bloqueos y tipos de cita, sin choques de horario.' },
  { icon: <MessageCircle className="text-primary" size={26} />, title: 'Confirmaciones y recordatorios', text: 'Mensajes por WhatsApp y correo con la fecha, la hora y el médico. El paciente confirma o cancela con un toque.' },
  { icon: <FileText className="text-primary" size={26} />, title: 'Historia clínica', text: 'Ficha del paciente, antecedentes, notas de consulta, diagnósticos y signos vitales, solo para médicos y administradores.' },
  { icon: <Building2 className="text-primary" size={26} />, title: 'Varios consultorios', text: 'Cada consultorio ve únicamente sus propios datos, con roles de administrador, médico y secretaría.' },
];

// The public home page (/). It tells a visitor, and the Meta and Google reviewers, what
// MedCita is and who is behind it. Signed-in users are sent to the dashboard by the route.
const Home = () => (
  <PublicLayout>
    <section className="bg-secondary text-white">
      <div className="max-w-5xl mx-auto px-6 py-16 sm:py-24">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight max-w-2xl">
          La agenda médica de tu consultorio, simple y segura.
        </h1>
        <p className="mt-6 text-lg text-slate-300 max-w-2xl leading-relaxed">
          MedCita es una plataforma web para consultorios y clínicas de Ecuador: agenda las citas, avisa a los pacientes
          por WhatsApp y correo, y lleva el registro de su atención.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link to="/login" className="btn-primary px-8 py-3 rounded-xl">Iniciar sesión</Link>
          <Link to="/register" className="px-8 py-3 rounded-xl font-bold border border-slate-500 hover:border-white">
            Registrar mi consultorio
          </Link>
        </div>
      </div>
    </section>

    <section className="max-w-5xl mx-auto px-6 py-14">
      <h2 className="text-2xl font-black text-secondary tracking-tight">Qué hace MedCita</h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {FEATURES.map(({ icon, title, text }) => (
          <div key={title} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            {icon}
            <h3 className="mt-4 text-lg font-bold text-secondary">{title}</h3>
            <p className="mt-2 text-slate-600 leading-relaxed">{text}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="max-w-5xl mx-auto px-6 pb-16">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 flex items-start gap-5">
        <ShieldCheck className="text-primary shrink-0" size={30} />
        <div>
          <h2 className="text-xl font-black text-secondary tracking-tight">Tus datos, bajo tu control</h2>
          <p className="mt-3 text-slate-600 leading-relaxed">
            El consultorio es el responsable de los datos de sus pacientes y MedCita los guarda por cuenta de este, sin
            usarlos para publicidad ni venderlos. Los datos de salud son una categoría especial en la Ley Orgánica de
            Protección de Datos Personales de Ecuador. Lee la{' '}
            <Link to="/privacy" className="text-primary font-bold hover:underline">política de privacidad</Link>, los{' '}
            <Link to="/terms" className="text-primary font-bold hover:underline">términos y condiciones</Link> y cómo{' '}
            <Link to="/data-deletion" className="text-primary font-bold hover:underline">pedir que se eliminen tus datos</Link>.
          </p>
        </div>
      </div>
    </section>
  </PublicLayout>
);

export default Home;
