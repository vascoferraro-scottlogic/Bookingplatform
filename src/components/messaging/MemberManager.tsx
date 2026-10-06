"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Member = {
  userId: string;
  role: string;
  mutedUntil?: string | null;
  user: { id: string; name: string | null; email: string };
};

export default function MemberManager({
  members,
  channelId,
  tenantUsers,
  onAdd,
  onRemove,
  onMute,
}: {
  members: Member[];
  channelId: string;
  tenantUsers: { id: string; name: string | null; email: string }[];
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  onMute: (userId: string, mutedUntil: string | null) => void;
}) {
  const [addUserId, setAddUserId] = useState("");
  const t = useTranslations("messaging");
  const memberIds = new Set(members.map((m) => m.userId));
  const nonMembers = tenantUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="p-4">
      <h4 className="font-bold mb-3">{t("memberManager.title", { count: members.length })}</h4>
      <div className="space-y-2 mb-4">
        {members.map((m) => {
          const isMuted = m.mutedUntil && new Date(m.mutedUntil) > new Date();
          return (
            <div key={m.userId} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
              <div>
                <span className="font-medium text-sm">{m.user.name ?? m.user.email}</span>
                <span className="ml-2 text-xs text-gray-500">{m.role}</span>
                {isMuted && <span className="ml-2 text-xs text-red-500">{t("memberManager.muted")}</span>}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => onMute(m.userId, isMuted ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}
                  className="text-xs px-2 py-1 rounded border hover:bg-gray-100"
                >
                  {isMuted ? t("memberManager.unmute") : t("memberManager.mute24h")}
                </button>
                {m.role !== "OWNER" && (
                  <button onClick={() => onRemove(m.userId)} className="text-xs px-2 py-1 rounded border text-red-600 hover:bg-red-50">
                    {t("memberManager.remove")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {nonMembers.length > 0 && (
        <div className="border-t pt-3">
          <h4 className="font-bold mb-2 text-sm">{t("memberManager.addMember")}</h4>
          <div className="flex gap-2">
            <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1 border rounded px-3 py-1 text-sm">
              <option value="">{t("memberManager.selectUser")}</option>
              {nonMembers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </select>
            <button
              onClick={() => { if (addUserId) { onAdd(addUserId); setAddUserId(""); } }}
              disabled={!addUserId}
              className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {t("memberManager.add")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
