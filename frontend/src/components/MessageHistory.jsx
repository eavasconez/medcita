import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { CheckCircle2, XCircle, Info, Clock, MessageCircle } from 'lucide-react';

const KIND = {
  appointment_confirmation: 'Confirmation',
  appointment_reminder: 'Reminder',
  appointment_second_reminder: 'Second reminder',
  doctor_new_appointment: "Doctor's notice",
  patient_reply_answer: 'Answer to the patient',
  reschedule_request_notice: "Notice to the clinic's staff"
};
// What the patient did on the WhatsApp reminder (messages we received, not sent)
const RECEIVED = {
  patient_confirmed: 'The patient confirmed the appointment by WhatsApp',
  patient_cancelled: 'The patient cancelled the appointment by WhatsApp',
  patient_reschedule_request: 'The patient asked for another time by WhatsApp',
  patient_reply_ignored: 'The patient replied by WhatsApp, nothing was changed'
};
// Why a reply changed nothing
const IGNORED_BECAUSE = {
  already_confirmed: 'It was already confirmed.',
  already_cancelled: 'It was already cancelled.',
  repeated: 'The clinic had already been told.',
  past: 'The appointment time had passed.',
  closed: 'The visit was already closed.',
  cancelled: 'The appointment was cancelled.',
  stale: 'The reminder was about an earlier time of this appointment.',
  other_number: 'It came from a number that is not the patient\'s.'
};
const CHANNEL = { whatsapp: 'WhatsApp', email: 'email' };
const VERB = { sent: 'sent', failed: 'failed', simulated: 'simulated' };

// What really happened to the messages about one appointment: the confirmation and
// the reminder, on each channel, with the reason when one failed.
const MessageHistory = ({ appointmentId }) => {
  const { token } = useContext(AuthContext);
  const [state, setState] = useState({ loading: true, error: false, data: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: false, data: null });
    axios
      .get(`${API_BASE_URL}/api/appointments/${appointmentId}/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => !cancelled && setState({ loading: false, error: false, data: res.data }))
      .catch(() => !cancelled && setState({ loading: false, error: true, data: null }));
    return () => { cancelled = true; };
  }, [appointmentId, token]);

  const { loading, error, data } = state;

  return (
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100/50" aria-label="Messages sent">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Messages</p>
      {loading && <p className="text-sm font-bold text-slate-400">Loading messages...</p>}
      {error && <p className="text-sm font-bold text-slate-400">We couldn&apos;t load the messages.</p>}
      {data && (
        <ul className="space-y-3">
          {data.notifications.map((n) => (
            <li key={n.id} className="flex items-start gap-3">
              {n.status === 'sent' && <CheckCircle2 size={18} className="text-emerald-500 mt-0.5 shrink-0" />}
              {n.status === 'failed' && <XCircle size={18} className="text-red-500 mt-0.5 shrink-0" />}
              {n.status === 'simulated' && <Info size={18} className="text-slate-400 mt-0.5 shrink-0" />}
              {n.status === 'received' && <MessageCircle size={18} className="text-primary mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className={`text-sm font-bold ${n.status === 'failed' ? 'text-red-600' : 'text-secondary'}`}>
                  {n.status === 'received'
                    ? RECEIVED[n.kind] || `${n.kind} received`
                    : `${KIND[n.kind] || n.kind} ${VERB[n.status]} by ${CHANNEL[n.channel] || n.channel}`}
                </p>
                <p className="text-xs font-medium text-slate-400">
                  {new Date(n.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {n.provider}
                  {n.status === 'simulated' && ' · no provider configured, nothing was sent'}
                </p>
                {n.status === 'failed' && n.error && <p className="text-xs font-medium text-red-500 mt-0.5 break-words">{n.error}</p>}
                {n.status === 'received' && n.kind === 'patient_reply_ignored' && IGNORED_BECAUSE[n.errorCode] && (
                  <p className="text-xs font-medium text-slate-400 mt-0.5">{IGNORED_BECAUSE[n.errorCode]}</p>
                )}
              </div>
            </li>
          ))}
          {data.notifications.length === 0 && <li className="text-sm font-bold text-slate-400">No messages have been sent for this appointment.</li>}
          {data.reminderPending && (
            <li className="flex items-start gap-3 text-sm font-bold text-slate-400">
              <Clock size={18} className="mt-0.5 shrink-0" /> The reminder has not been sent yet.
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default MessageHistory;
