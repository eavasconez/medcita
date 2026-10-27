import { useState, useEffect } from 'react';

// `value`, but only after it has stopped changing for `delay` ms (a search box asks the server once
// the person pauses, not on every key)
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
