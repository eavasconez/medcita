import { createContext } from 'react';

// Kept apart from App.jsx: a file that exports a context next to a component breaks
// React fast refresh, and the pages importing it from App formed an import cycle.
export const AuthContext = createContext();
