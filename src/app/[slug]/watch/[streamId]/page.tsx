"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

type StreamWatch = {
  id: string;
  title: string;
  status: "IDLE" | "LIVE" | "ENDED" | "ARCHIVED";
  visibility: string;
  rink: { name: string; green: { name: string } };
  event: { id: string; title: string } | null;
  tenant: { name: string; slug: string };
  streamKey: string | null;
  viewerCount: number;
  accessMethod?: string;
};

export default function WatchStreamPage() {
  const { slug, streamId } = useParams<{ slug: string; streamId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const t = useTranslations("streaming");
  const [stream, setStream] = useState<StreamWatch | null>(null);
  const [error, setError] = useState("");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetchStream();
  }, [streamId, token]);

  useEffect(() => {
    // Cleanup: leave on unmount
    return () => {
      if (viewerId) {
        fetch(`/api/streaming/${streamId}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerId }),
        }).catch(() => {});
      }
    };
  }, [viewerId, streamId]);

  async function fetchStream() {
    const url = token
      ? `/api/streaming/${streamId}/watch?token=${token}`
      : `/api/streaming/${streamId}/watch`;
    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Unable to access stream");
      return;
    }
    const data = await res.json();
    setStream(data);

    if (data.status === "LIVE") {
      joinStream();
    }
  }

  async function joinStream() {
    const fingerprint = `viewer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const res = await fetch(`/api/streaming/${streamId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionFingerprint: fingerprint, token }),
    });
    if (res.ok) {
      const data = await res.json();
      setViewerId(data.viewerId);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{t("watch.accessDenied")}</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <p>{t("watch.loadingStream")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-5xl mx-auto p-4">
        {/* Video Area */}
        <div className="relative bg-black aspect-video rounded-lg overflow-hidden mb-4">
          {stream.status === "LIVE" ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 bg-red-600 px-2 py-0.5 rounded text-xs font-bold animate-pulse">
                ● LIVE
              </div>
              <div className="absolute top-3 right-3 bg-black/60 px-2 py-0.5 rounded text-xs">
                {t("watchingCount", { count: stream.viewerCount })}
              </div>
            </>
          ) : stream.status === "ENDED" ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <p className="text-xl font-bold">{t("watch.streamEnded")}</p>
                <p className="text-sm mt-1">{t("watch.streamEndedDescription")}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <p className="text-xl font-bold">{t("watch.streamStartingSoon")}</p>
                <p className="text-sm mt-1">{t("watch.waitingForBroadcaster")}</p>
              </div>
            </div>
          )}
        </div>

        {/* Stream Info */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{stream.title}</h1>
            <p className="text-gray-400 text-sm">
              {stream.tenant.name} • {stream.rink.green.name} — {stream.rink.name}
              {stream.event && ` • ${stream.event.title}`}
            </p>
          </div>
          <span className="text-xs bg-gray-700 px-2 py-1 rounded">
            {stream.visibility === "PUBLIC" ? t("publicBadge") : t("membersBadge")}
          </span>
        </div>
      </div>
    </div>
  );
}
