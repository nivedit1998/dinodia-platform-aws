'use client';

import { useEffect } from 'react';
import { triggerGlobalRefresh } from '@/lib/refreshBus';

const REFRESH_INTERVAL_MS = 2000;
const INTERACTION_DEBOUNCE_MS = 400;
const INTERACTION_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'keydown',
  'touchstart',
  'click',
];

type Props = {
  children: React.ReactNode;
};

export function GlobalRefreshProvider({ children }: Props) {
  useEffect(() => {
    let lastInteraction = 0;

    const handleInteraction = () => {
      const now = Date.now();
      if (now - lastInteraction < INTERACTION_DEBOUNCE_MS) return;
      lastInteraction = now;
      triggerGlobalRefresh();
    };

    const intervalId = window.setInterval(() => {
      triggerGlobalRefresh();
    }, REFRESH_INTERVAL_MS);

    INTERACTION_EVENTS.forEach((event) => {
      window.addEventListener(event, handleInteraction, { passive: true });
    });

    // Kick off one refresh immediately in case components subscribe late
    triggerGlobalRefresh();

    return () => {
      clearInterval(intervalId);
      INTERACTION_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleInteraction);
      });
    };
  }, []);

  return <>{children}</>;
}
