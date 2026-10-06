"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";

type Channel = "EMAIL" | "SMS" | "SOCIAL_POST";
type Status = "STUBBED" | "SENT_MANUAL" | "SENT" | "FAILED";

type Message = {
  id: string;
  channel: Channel;
  status: Status;
  toAddress: string;
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  template: string | null;
  templateData: string | null;
  socialPlatform: "FACEBOOK" | "TWITTER" | "INSTAGRAM" | null;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string } | null;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  sentAt: string | null;
  error: string | null;
};

const CHANNEL_FILTERS: ("ALL" | Channel)[] = ["ALL", "EMAIL", "SMS", "SOCIAL_POST"];

const CHANNEL_ICONS: Record<Channel, string> = {
  EMAIL: "✉️",
  SMS: "📱",
  SOCIAL_POST: "📣",
};

const STATUS_STYLES: Record<Status, string> = {
  STUBBED: "bg-gray-100 text-gray-700",
  SENT_MANUAL: "bg-blue-100 text-blue-700",
  SENT: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

export default function OutboundInspectorPage() {
  const locale = useLocale();
  const t = useTranslations("admin");
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<"ALL" | Channel>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch("/api/admin/outbound?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMessages(Array.isArray(d) ? d : []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => (filter === "ALL" ? messages : messages.filter((m) => m.channel === filter)),
    [messages, filter],
  );

  const selected = messages.find((m) => m.id === selectedId) ?? null;

  async function markSent(id: string) {
    await fetch(`/api/admin/outbound/${id}`, { method: "PATCH" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">{t("platform.outbound.title")}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t("platform.outbound.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHANNEL_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setSelectedId(null); }}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              filter === f
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {f === "ALL" ? "All" : `${CHANNEL_ICONS[f]} ${f.toLowerCase().replace("_", " ")}`}{" "}
            <span className="opacity-60">
              ({f === "ALL" ? messages.length : messages.filter((m) => m.channel === f).length})
            </span>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {loading ? (
            <p className="p-6 text-gray-500">{t("platform.outbound.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-gray-500">{t("platform.outbound.noMessages")}</p>
          ) : (
            <ul className="divide-y max-h-[70vh] overflow-y-auto">
              {filtered.map((m) => (
                <li
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${
                    selectedId === m.id ? "bg-green-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span>{CHANNEL_ICONS[m.channel]}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_STYLES[m.status]}`}>
                      {m.status.toLowerCase()}
                    </span>
                    <span className="ml-auto text-xs text-gray-400">
                      {formatDateTime(m.createdAt, locale)}
                    </span>
                  </div>
                  <div className="mt-1 font-medium text-gray-800 truncate">
                    {m.subject ?? m.template ?? m.bodyText.slice(0, 60)}
                  </div>
                  <div className="text-xs text-gray-500 truncate">→ {m.toAddress}</div>
                  {m.tenant && (
                    <div className="text-xs text-gray-400">{m.tenant.name}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-5 max-h-[70vh] overflow-y-auto">
          {selected ? (
            <Preview message={selected} onMarkSent={markSent} />
          ) : (
            <p className="text-gray-500">{t("platform.outbound.selectToPreview")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Preview({ message, onMarkSent }: { message: Message; onMarkSent: (id: string) => void }) {
  const t = useTranslations("admin");
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase text-gray-500">{message.channel}</div>
          <div className="font-semibold text-gray-800">
            {message.subject ?? message.template ?? t("platform.outbound.noSubject")}
          </div>
          <div className="text-sm text-gray-500">→ {message.toAddress}</div>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLES[message.status]}`}>
          {message.status.toLowerCase()}
        </span>
      </div>

      {message.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {message.error}
        </div>
      )}

      {message.channel === "EMAIL" && <EmailPreview message={message} />}
      {message.channel === "SMS" && <SmsPreview message={message} />}
      {message.channel === "SOCIAL_POST" && <SocialPreview message={message} />}

      <div>
        <div className="text-xs uppercase text-gray-500 mb-1">{t("platform.outbound.plainText")}</div>
        <pre className="bg-gray-50 rounded p-3 text-xs whitespace-pre-wrap text-gray-700">
          {message.bodyText}
        </pre>
      </div>

      {message.templateData && (
        <details>
          <summary className="text-xs uppercase text-gray-500 cursor-pointer">
            {t("platform.outbound.templateVariables")}
          </summary>
          <pre className="bg-gray-50 rounded p-3 text-xs mt-1 overflow-x-auto">
            {JSON.stringify(JSON.parse(message.templateData), null, 2)}
          </pre>
        </details>
      )}

      {message.status === "STUBBED" && (
        <button
          onClick={() => onMarkSent(message.id)}
          className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          {t("platform.outbound.markSentManually")}
        </button>
      )}
    </div>
  );
}

function EmailPreview({ message }: { message: Message }) {
  const t = useTranslations("admin");
  return (
    <div>
      <div className="text-xs uppercase text-gray-500 mb-1">{t("platform.outbound.htmlPreview")}</div>
      {message.bodyHtml ? (
        <iframe
          title="Email preview"
          srcDoc={message.bodyHtml}
          className="w-full border rounded"
          style={{ height: 360 }}
        />
      ) : (
        <p className="text-sm text-gray-500 italic">{t("platform.outbound.noHtmlBody")}</p>
      )}
    </div>
  );
}

function SmsPreview({ message }: { message: Message }) {
  const overLimit = message.bodyText.length > 160;
  return (
    <div className="flex justify-center">
      <div className="w-72 bg-gray-900 rounded-3xl p-3 text-white">
        <div className="bg-blue-500 rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap">
          {message.bodyText}
        </div>
        <div className={`text-xs mt-2 text-right ${overLimit ? "text-red-300" : "text-gray-400"}`}>
          {message.bodyText.length} / 160 chars
        </div>
      </div>
    </div>
  );
}

function SocialPreview({ message }: { message: Message }) {
  const colors: Record<string, string> = {
    FACEBOOK: "bg-blue-600",
    TWITTER: "bg-sky-500",
    INSTAGRAM: "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600",
  };
  const platform = message.socialPlatform ?? "FACEBOOK";
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className={`p-3 text-white text-sm font-semibold ${colors[platform] ?? "bg-gray-700"}`}>
        {platform.toLowerCase()} post
      </div>
      <div className="p-4 whitespace-pre-wrap text-sm text-gray-800">
        {message.bodyText}
      </div>
    </div>
  );
}
