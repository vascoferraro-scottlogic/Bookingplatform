"use client";

import { useTranslations } from "next-intl";

type Channel = {
  id: string;
  name: string;
  type: string;
  description?: string;
  unreadCount: number;
  myRole: string;
  members: { userId: string; user: { id: string; name: string | null; email: string } }[];
};

export default function ChannelList({
  channels,
  activeChannelId,
  onSelect,
  onCreateClick,
  currentUserId,
}: {
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
  currentUserId: string;
}) {
  const t = useTranslations("messaging");
  const grouped = {
    PUBLIC: channels.filter((c) => c.type === "PUBLIC"),
    PRIVATE: channels.filter((c) => c.type === "PRIVATE"),
    GROUP: channels.filter((c) => c.type === "GROUP"),
    DIRECT: channels.filter((c) => c.type === "DIRECT"),
  };

  function displayName(ch: Channel) {
    if (ch.type === "DIRECT") {
      const other = ch.members.find((m) => m.userId !== currentUserId);
      return other?.user.name ?? other?.user.email ?? "Direct Message";
    }
    return ch.name;
  }

  const typeLabels: Record<string, string> = { PUBLIC: t("channelList.public"), PRIVATE: t("channelList.private"), GROUP: t("channelList.groups"), DIRECT: t("channelList.directMessages") };
  const typeIcons: Record<string, string> = { PUBLIC: "#", PRIVATE: "🔒", GROUP: "👥", DIRECT: "💬" };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="font-bold text-lg">{t("channelList.title")}</h3>
        <button onClick={onCreateClick} className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700" title="New Channel">
          {t("channelList.newChannel")}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(Object.keys(grouped) as (keyof typeof grouped)[]).map((type) =>
          grouped[type].length > 0 ? (
            <div key={type} className="mt-2">
              <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">{typeLabels[type]}</div>
              {grouped[type].map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => onSelect(ch.id)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-100 ${
                    ch.id === activeChannelId ? "bg-green-50 border-l-2 border-green-600" : ""
                  }`}
                >
                  <span className="flex items-center gap-1 truncate">
                    <span className="text-sm">{typeIcons[type]}</span>
                    <span className="truncate">{displayName(ch)}</span>
                  </span>
                  {ch.unreadCount > 0 && (
                    <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 ml-1">{ch.unreadCount}</span>
                  )}
                </button>
              ))}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
