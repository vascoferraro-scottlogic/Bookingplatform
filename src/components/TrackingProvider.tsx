"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  trackPageView,
  trackSessionStart,
  trackFeatureUse,
  trackInteraction,
  attachLifecycleListeners,
} from "@/lib/tracking-client";

interface TrackingContextValue {
  trackFeature: (action: string, entity?: string) => void;
  trackAction: (action: string, entity?: string, entityId?: string) => void;
}

const TrackingContext = createContext<TrackingContextValue>({
  trackFeature: () => {},
  trackAction: () => {},
});

export function useTrack() {
  return useContext(TrackingContext);
}

export default function TrackingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sessionStarted = useRef(false);

  // Attach flush-on-leave listeners once
  useEffect(() => {
    attachLifecycleListeners();
  }, []);

  // Fire SESSION_START once
  useEffect(() => {
    if (!sessionStarted.current) {
      sessionStarted.current = true;
      trackSessionStart(pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track page views on route changes
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  const value: TrackingContextValue = {
    trackFeature: (action: string, entity?: string) => {
      trackFeatureUse(action, pathname, entity);
    },
    trackAction: (action: string, entity?: string, entityId?: string) => {
      trackInteraction(action, pathname, entity, entityId);
    },
  };

  return (
    <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
  );
}
