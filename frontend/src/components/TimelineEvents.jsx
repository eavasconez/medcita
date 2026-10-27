import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, AppointmentStatusBadge, NoteStatusBadge } from './ui';
import { describeReading } from '../utils/vitals';
import { diagnosisLabel, formatDateTime } from '../utils/consultationNote';
import { METHOD_LABEL } from '../utils/consent';
import { CalendarDays, FileText, Activity, ShieldCheck, MessageSquarePlus, Star } from 'lucide-react';

// How each kind of event looks: its icon and color, and the badge that names it
const EVENT_KINDS = {
  appointment: { icon: CalendarDays, tone: 'bg-sky-100 text-sky-600', label: 'Visit', badge: 'info' },
  note: { icon: FileText, tone: 'bg-indigo-100 text-indigo-600', label: 'Note', badge: 'primary' },
  addendum: { icon: MessageSquarePlus, tone: 'bg-violet-100 text-violet-600', label: 'Addendum', badge: 'primary' },
  vitals: { icon: Activity, tone: 'bg-emerald-100 text-emerald-600', label: 'Vital signs', badge: 'success' },
  consent: { icon: ShieldCheck, tone: 'bg-amber-100 text-amber-600', label: 'Consent', badge: 'warning' }
};

const monthOf = (iso) => new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' });

// What each kind of event says, and where it leads
const EventBody = ({ event, patientId }) => {
  const noteLink = (appointmentId, label) => (
    <Link to={`/patients/${patientId}/appointments/${appointmentId}/note`} className="mt-1 inline-block text-xs font-black text-primary hover:underline">{label}</Link>
  );

  switch (event.type) {
    case 'appointment':
      return (
        <>
          <p className="font-black text-secondary">Visit · {event.date} {event.time}</p>
          <p className="text-sm font-medium text-slate-500">{event.doctor}{event.appointmentType ? ` · ${event.appointmentType}` : ''}</p>
          {event.status !== 'cancelled' && noteLink(event.id, event.noteId ? 'Open the note' : 'Write the note')}
        </>
      );
    case 'note':
      return (
        <>
          <p className="font-black text-secondary">Consultation note · visit of {event.visit}</p>
          <p className="text-sm font-medium text-slate-500">
            {event.status === 'closed' ? `Closed by ${event.closedByName}` : `Being written by ${event.authorName}`}
            {event.addendaCount > 0 ? ` · ${event.addendaCount} ${event.addendaCount === 1 ? 'addendum' : 'addenda'}` : ''}
          </p>
          {event.diagnoses.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {event.diagnoses.map((d, i) => (
                <li key={`${d.code}-${i}`} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1 text-xs font-bold text-secondary">
                  {d.kind === 'primary' && <Star size={11} className="text-primary" aria-label="Primary diagnosis" />}
                  {d.code && <span className="text-slate-400">{d.code}</span>}
                  {diagnosisLabel(d.name)}
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{d.certainty === 'definitive' ? 'definitive' : 'presumptive'}</span>
                </li>
              ))}
            </ul>
          )}
          {noteLink(event.appointmentId, 'Open the note')}
        </>
      );
    case 'addendum':
      return (
        <>
          <p className="font-black text-secondary">Addendum by {event.authorName}</p>
          <p className="text-sm font-medium text-slate-500 whitespace-pre-wrap">{event.text}</p>
          {noteLink(event.appointmentId, 'Open the note')}
        </>
      );
    case 'vitals':
      return (
        <>
          <p className={`text-sm font-medium ${event.voided ? 'text-slate-300 line-through' : 'text-secondary'}`}>{describeReading(event.reading)}</p>
          <p className="text-[11px] font-semibold text-slate-400">{event.recordedByName}</p>
        </>
      );
    default: // consent
      return (
        <>
          <p className="font-black text-secondary">Health-data consent {event.granted ? 'given' : 'withdrawn'}</p>
          <p className="text-sm font-medium text-slate-500">{METHOD_LABEL[event.method] || event.method} · text {event.documentVersion} · recorded by {event.recordedByName}</p>
        </>
      );
  }
};

// The badges that sit beside the date of an event: its kind, and its state when it has one
const EventBadges = ({ event }) => {
  const kind = EVENT_KINDS[event.type];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={kind.badge} size="sm">{kind.label}</Badge>
      {event.type === 'appointment' && <AppointmentStatusBadge status={event.status} size="sm" />}
      {event.type === 'note' && <NoteStatusBadge status={event.status} size="sm" />}
      {event.type === 'vitals' && event.voided && <Badge tone="danger" size="sm">Voided</Badge>}
      {event.type === 'consent' && <Badge tone={event.granted ? 'success' : 'danger'} size="sm">{event.granted ? 'Given' : 'Withdrawn'}</Badge>}
    </span>
  );
};

// The events of one patient in order, grouped under their month. Pure display: the caller loads
// them (the timeline screen) and decides what to do when there are none.
const TimelineEvents = ({ events, patientId }) => {
  let lastMonth = null;
  return (
    <ol className="relative border-l-2 border-slate-100 ml-4 space-y-5">
      {events.map((event) => {
        const { icon: Icon, tone } = EVENT_KINDS[event.type];
        const month = monthOf(event.at);
        const heading = month !== lastMonth;
        lastMonth = month;
        return (
          <li key={`${event.type}-${event.id}`} className="pl-8 relative">
            {heading && <p className="-ml-8 mb-3 pl-8 text-[11px] font-black uppercase tracking-widest text-slate-400">{month}</p>}
            <span aria-hidden="true" className={`absolute -left-[17px] ${heading ? 'top-8' : 'top-1'} w-8 h-8 rounded-full flex items-center justify-center ring-4 ring-[#f8fafc] ${tone}`}><Icon size={15} /></span>
            <div className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-[11px] font-bold text-slate-400">{formatDateTime(event.at)}</p>
                <EventBadges event={event} />
              </div>
              <EventBody event={event} patientId={patientId} />
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default TimelineEvents;
