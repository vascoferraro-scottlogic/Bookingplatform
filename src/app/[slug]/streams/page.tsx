"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

type LiveStream = {
  id: string;
  title: string;
  status: string;
  rink: { name: string; green: { name: string } };
  event: { id: string; title: string } | null;
  startedAt: string;
  _count: { viewers: number };
};

export default function StreamDiscoveryPage() {
  const { slug } = useParams<{ slug: string }>();
  const t = useTranslations("streaming");
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/public/${slug}/streams`)
      .then((r) => r.json())
      .then((data) => {
        setStreams(data.streams || []);
        setClubName(data.club?.name || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="p-6">{t("loading")}</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{t("discovery.title")}</h1>
      <p className="text-gray-600 mb-6">{clubName}</p>

      {streams.length === 0 ? (
        <p className="text-gray-500">{t("discovery.noStreams")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {streams.map((stream) => (
            <a
              key={stream.id}
              href={`/${slug}/watch/${stream.id}`}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded animate-pulse">{t("discovery.live")}</span>
                <span className="text-xs text-gray-500">{t("watchingCount", { count: stream._count.viewers })}</span>
              </div>
              <h3 className="font-semibold">{stream.title}</h3>
              <p className="text-sm text-gray-600">
                {stream.rink.green.name} — {stream.rink.name}
                {stream.event && ` • ${stream.event.title}`}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
