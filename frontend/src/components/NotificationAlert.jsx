import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';
import { AlertTriangle } from 'lucide-react';

const LABEL = { whatsapp: 'WhatsApp', email: 'Email' };

// Warns the clinic admin when a channel has failed several messages in a row, so a
// broken provider (an expired token, a bad key) is seen the same day and not when a
// patient complains. It goes away by itself once a message goes out again.
const NotificationAlert = () => {
  const { token } = useContext(AuthContext);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/admin/notification-status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setStatus(res.data))
      .catch(() => {}); // a warning, not a feature: stay quiet if it cannot be loaded
  }, [token]);

  const failing = status ? Object.entries(status.channels).filter(([, channel]) => channel.failing) : [];
  if (failing.length === 0) return null;

  return (
    <div role="alert" className="mb-8 space-y-3">
      {failing.map(([name, channel]) => (
        <div key={name} className="p-5 bg-red-50 border border-red-100 rounded-3xl flex items-start gap-4">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={24} />
          <div className="min-w-0">
            <p className="font-black text-red-600">{LABEL[name] || name} messages are failing</p>
            <p className="text-sm font-medium text-red-500 mt-1">
              The last {channel.failedInARow} {channel.failedInARow === 1 ? 'message' : 'messages'} could not be sent
              {channel.lastSentAt ? `; the last one that went out was on ${new Date(channel.lastSentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ' and none has gone out recently'}.
              Patients may not be receiving their confirmations and reminders.
            </p>
            {channel.lastFailure?.error && (
              <p className="text-xs font-medium text-red-400 mt-2 break-words">
                Last error ({channel.lastFailure.provider}{channel.lastFailure.errorCode ? `, ${channel.lastFailure.errorCode}` : ''}): {channel.lastFailure.error}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default NotificationAlert;
