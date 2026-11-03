// Backend origin. In development the backend runs apart, on localhost:5000. A production build is
// served by the backend itself (backend/src/middleware/webApp.js), so it asks the address it was
// loaded from: leave VITE_API_URL unset there. Set it (frontend/.env) when the site and the API live at
// different addresses, as on Render's static site.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000');
