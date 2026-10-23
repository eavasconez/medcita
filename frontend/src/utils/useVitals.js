import { useState, useEffect, useCallback, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';

// The vital signs of a patient (S10-06), newest first. Only doctors and admins may read them (the
// API answers 403 to anyone else), so with `enabled` false nothing is requested. Every load is a
// read the clinic audits, so it only reloads when asked.
export default function useVitals(patientId, enabled = true) {
  const { token } = useContext(AuthContext);
  const [readings, setReadings] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled || !patientId) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/patients/${patientId}/clinical/vitals`, { headers: { Authorization: `Bearer ${token}` } });
      setReadings(res.data.readings);
      setTruncated(res.data.truncated);
      setError(false);
    } catch {
      setError(true);
    }
  }, [patientId, token, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { readings, truncated, error, reload };
}
