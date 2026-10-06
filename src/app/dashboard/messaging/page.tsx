"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTrack } from "@/components/TrackingProvider";
import { useTranslations } from "next-intl";
import ChannelList from "@/components/messaging/ChannelList";
import MessageThread from "@/components/messaging/MessageThread";
import MessageInput from "@/components/messaging/MessageInput";
import ChannelHeader from "@/components/messaging/ChannelHeader";
import CreateChannelModal from "@/components/messaging/CreateChannelModal";
import MemberManager from "@/components/messaging/MemberManager";

type Channel = {
  id: string;
  name: string;
  type: string;
  description?: string;
  unreadCount: number;
  myRole: string;
  mutedUntil?: string | null;
  members: { userId: string; role: string; mutedUntil?: string | null; user: { id: string; name: string | null; email: string } }[];
};

type Message = {
  id: string;
  body: string;
  pinned: boolean;
  deletedAt: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
};

export default function MessagingPage() {
  const { data: session, status } = useSession();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [tenantUsers, setTenantUsers] = useState<{ id: string; name: string | null; email: string }[]>([]);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const { trackFeature } = useTrack();
  const t = useTranslations("messaging");

  useEffect(() => { trackFeature("messaging.opened", "Channel"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs ?? null;
  const effectiveRole = acting ? acting.role : role;
  const isAdmin = effectiveRole === "TENANT_ADMIN";
  const userId = (session?.user as any)?.id as string | undefined;

  // Load channels
  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/messaging/channels");
      if (res.status === 403) { setFeatureDisabled(true); return; }
      if (!res.ok) return;
      const data = await res.json();
      setChannels(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadChannels();
  }, [status, loadChannels]);

  // Load users for member management
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTenantUsers(Array.isArray(data) ? data.map((u: any) => ({ id: u.id, name: u.name, email: u.email })) : []))
      .catch(() => {});
  }, [isAdmin]);

  // Load messages when channel changes
  const loadMessages = useCallback(async (channelId: string, cursor?: string) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`/api/messaging/channels/${channelId}/messages${qs}`);
    if (!res.ok) return;
    const data: Message[] = await res.json();
    if (cursor) {
      setMessages((prev) => [...data, ...prev]);
    } else {
      setMessages(data);
    }
    setHasMore(data.length >= 50);

    // Update read cursor
    if (data.length > 0) {
      const lastMsg = data[data.length - 1];
      fetch(`/api/messaging/channels/${channelId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastReadMessageId: lastMsg.id }),
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!activeChannelId) { setMessages([]); return; }
    loadMessages(activeChannelId);
  }, [activeChannelId, loadMessages]);

  // SSE connection
  useEffect(() => {
    if (status !== "authenticated" || featureDisabled) return;

    const es = new EventSource("/api/messaging/stream");
    eventSourceRef.current = es;

    es.addEventListener("message", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.channelId === activeChannelId && data.message) {
          setMessages((prev) => [...prev, data.message]);
        }
        // Refresh channel list for unread counts
        loadChannels();
      } catch { /* ignore */ }
    });

    es.addEventListener("channel_update", () => {
      loadChannels();
      if (activeChannelId) loadMessages(activeChannelId);
    });

    es.onerror = () => {
      es.close();
      // Reconnect after delay
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      }, 5000);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [status, featureDisabled, activeChannelId, loadChannels, loadMessages]);

  // Send message
  async function handleSend(body: string) {
    if (!activeChannelId) return;
    const res = await fetch(`/api/messaging/channels/${activeChannelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
    }
  }

  // Create channel
  async function handleCreateChannel(data: { name: string; type: string; description?: string; memberIds: string[] }) {
    setCreateError(null);
    const res = await fetch("/api/messaging/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setShowCreate(false);
      await loadChannels();
      const ch = await res.json();
      setActiveChannelId(ch.id);
      return;
    }
    const body = await res.json().catch(() => ({}));
    setCreateError(body?.error ?? `Failed to create channel (${res.status})`);
  }

  // Delete message
  async function handleDeleteMessage(msgId: string) {
    if (!activeChannelId) return;
    await fetch(`/api/messaging/channels/${activeChannelId}/messages/${msgId}`, { method: "DELETE" });
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, deletedAt: new Date().toISOString() } : m)));
  }

  // Pin message
  async function handlePinMessage(msgId: string, pinned: boolean) {
    if (!activeChannelId) return;
    await fetch(`/api/messaging/channels/${activeChannelId}/messages/${msgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, pinned } : m)));
  }

  // Member management
  async function handleAddMember(addUserId: string) {
    if (!activeChannelId) return;
    await fetch(`/api/messaging/channels/${activeChannelId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: addUserId }),
    });
    loadChannels();
  }

  async function handleRemoveMember(removeUserId: string) {
    if (!activeChannelId) return;
    await fetch(`/api/messaging/channels/${activeChannelId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: removeUserId }),
    });
    loadChannels();
  }

  async function handleMuteMember(muteUserId: string, mutedUntil: string | null) {
    if (!activeChannelId) return;
    await fetch(`/api/messaging/channels/${activeChannelId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: muteUserId, mutedUntil }),
    });
    loadChannels();
  }

  if (featureDisabled) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold mb-2">{t("title")}</h1>
        <p className="text-gray-500">{t("disabled")}</p>
      </div>
    );
  }

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const myMembership = activeChannel?.members.find((m) => m.userId === userId);

  // DM display name
  function channelDisplayName(ch: Channel) {
    if (ch.type === "DIRECT") {
      const other = ch.members.find((m) => m.userId !== userId);
      return other?.user.name ?? other?.user.email ?? "Direct Message";
    }
    return ch.name;
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Channel sidebar */}
      <div className="w-64 border-r bg-white flex-shrink-0">
        <ChannelList
          channels={channels}
          activeChannelId={activeChannelId}
          onSelect={setActiveChannelId}
          onCreateClick={() => setShowCreate(true)}
          currentUserId={userId ?? ""}
        />
      </div>

      {/* Message area */}
      <div className="flex-1 flex flex-col bg-white">
        {activeChannel ? (
          <>
            <ChannelHeader
              channelName={channelDisplayName(activeChannel)}
              channelType={activeChannel.type}
              members={activeChannel.members}
              isAdmin={isAdmin}
              onManageMembers={() => setShowMembers(!showMembers)}
            />
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col">
                <MessageThread
                  messages={messages}
                  currentUserId={userId ?? ""}
                  onLoadMore={() => {
                    if (messages.length > 0) loadMessages(activeChannelId!, messages[0].id);
                  }}
                  hasMore={hasMore}
                  isAdmin={isAdmin}
                  onDelete={handleDeleteMessage}
                  onPin={handlePinMessage}
                />
                <MessageInput onSend={handleSend} mutedUntil={myMembership?.mutedUntil} />
              </div>
              {showMembers && isAdmin && (
                <div className="w-72 border-l overflow-y-auto">
                  <MemberManager
                    members={activeChannel.members}
                    channelId={activeChannel.id}
                    tenantUsers={tenantUsers}
                    onAdd={handleAddMember}
                    onRemove={handleRemoveMember}
                    onMute={handleMuteMember}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            {t("selectChannel")}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateChannelModal
          onClose={() => { setShowCreate(false); setCreateError(null); }}
          onCreate={handleCreateChannel}
          tenantUsers={tenantUsers}
          error={createError}
          onClearError={() => setCreateError(null)}
        />
      )}
    </div>
  );
}
