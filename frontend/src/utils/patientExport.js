import axios from 'axios';
import { API_BASE_URL } from '../config/api';

// Downloads the export of a patient's data (admin only; the API writes it to the activity log):
// the JSON file or the PDF to read and hand over.
export async function downloadPatientExport(patientId, format, token) {
  const res = await axios.get(`${API_BASE_URL}/api/patients/${patientId}/export`, {
    params: { format },
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'blob'
  });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `patient-${patientId}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
