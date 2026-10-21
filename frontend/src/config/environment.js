// Which environment this build is for. Production builds do not set it; the staging
// site sets VITE_APP_ENV=staging so nobody mistakes it for the real thing.
export const IS_STAGING = import.meta.env.VITE_APP_ENV === 'staging';
