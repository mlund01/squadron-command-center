import { useSyncExternalStore } from 'react';

const query = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useWideAgentLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
