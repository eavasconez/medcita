// Backend origin - overridable via VITE_API_URL (frontend/.env) so a
// production build can point at the real deployed backend instead of
// silently assuming localhost.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
