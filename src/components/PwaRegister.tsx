"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Registers the service worker (production only) and offers an "Install app" button
// when the browser fires beforeinstallprompt.
export default function PwaRegister() {
  const t = useTranslations("common");
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    }
    function onInstalled() {
      setInstallEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!installEvent) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await installEvent.prompt();
        await installEvent.userChoice.catch(() => {});
        setInstallEvent(null);
      }}
      className="fixed bottom-4 right-4 z-50 rounded bg-green-700 px-4 py-2 text-sm text-white shadow hover:bg-green-800"
    >
      {t("pwa.install")}
    </button>
  );
}
