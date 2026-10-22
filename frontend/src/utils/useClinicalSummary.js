import { useState, useEffect, useCallback, useContext } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { AuthContext } from '../AuthContext';

// The allergies, regular medication and history of a patient (S10-03). Only doctors and
// admins may read them (the API answers 403 to anyone else), so with `enabled` false nothing
// is requested. Every load is a read the clinic audits, so it is not repeated needlessly.
export default function useClinicalSummary(patientId, enabled = true) {
  const { token } = useContext(AuthContext);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled || !patientId) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/patients/${patientId}/clinical/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSummary(res.data);
      setError(false);
    } catch {
      setSummary(null);
      setError(true);
    }
  }, [patientId, token, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { summary, error, reload };
}
