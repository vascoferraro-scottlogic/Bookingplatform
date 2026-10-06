"use client";

import { useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatTime } from "@/lib/format";

type Message = {
  id: string;
  body: string;
  pinned: boolean;
  deletedAt: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
};

export default function MessageThread({
  messages,
  currentUserId,
  onLoadMore,
  hasMore,
  isAdmin,
  onDelete,
  onPin,
}: {
  messages: Message[];
  currentUserId: string;
  onLoadMore: () => void;
  hasMore: boolean;
  isAdmin: boolean;
  onDelete: (msgId: string) => void;
  onPin: (msgId: string, pinned: boolean) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const locale = useLocale();
  const t = useTranslations("messaging");

  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLenRef.current = messages.length;
  }, [messages.length]);

  function handleScroll() {
    if (!containerRef.current || !hasMore) return;
    if (containerRef.current.scrollTop === 0) {
      onLoadMore();
    }
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
      {hasMore && (
        <button onClick={onLoadMore} className="w-full text-center text-sm text-gray-500 hover:text-gray-700 py-2">
          {t("messageThread.loadOlder")}
        </button>
      )}
      {messages.map((msg) => {
        const isMine = msg.user.id === currentUserId;
        const isDeleted = !!msg.deletedAt;
        return (
          <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
            <div className="text-xs text-gray-500 mb-1">
              {msg.user.name ?? msg.user.email}
              {msg.pinned && <span className="ml-1 text-yellow-600">📌</span>}
              <span className="ml-2">{formatTime(msg.createdAt, locale)}</span>
            </div>
            <div
              className={`rounded-lg px-3 py-2 max-w-[75%] ${
                isDeleted ? "bg-gray-100 text-gray-400 italic" : isMine ? "bg-green-600 text-white" : "bg-gray-200 text-gray-900"
              }`}
            >
              {isDeleted ? t("messageThread.deleted") : msg.body}
            </div>
            {!isDeleted && (isAdmin || isMine) && (
              <div className="flex gap-2 mt-1 text-xs">
                {(isAdmin) && (
                  <button onClick={() => onPin(msg.id, !msg.pinned)} className="text-gray-500 hover:text-yellow-600">
                    {msg.pinned ? t("messageThread.unpin") : t("messageThread.pin")}
                  </button>
                )}
                <button onClick={() => onDelete(msg.id)} className="text-gray-500 hover:text-red-600">
                  {t("messageThread.delete")}
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
