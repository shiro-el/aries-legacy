import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Presentation work follows the app, independently of background SSH services. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    setActive(AppState.currentState === 'active');
    return () => subscription.remove();
  }, []);
  return active;
}
