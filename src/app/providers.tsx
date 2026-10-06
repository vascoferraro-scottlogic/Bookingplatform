"use client";

import { SessionProvider } from "next-auth/react";
import TrackingProvider from "@/components/TrackingProvider";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ImpersonationBanner />
      <TrackingProvider>{children}</TrackingProvider>
    </SessionProvider>
  );
}
