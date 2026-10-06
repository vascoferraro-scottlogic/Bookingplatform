"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type ChannelType = "PUBLIC" | "PRIVATE" | "GROUP";

export default function CreateChannelModal({
  onClose,
  onCreate,
  tenantUsers,
  error,
  onClearError,
}: {
  onClose: () => void;
  onCreate: (data: { name: string; type: ChannelType; description?: string; memberIds: string[] }) => void;
  tenantUsers: { id: string; name: string | null; email: string }[];
  error?: string | null;
  onClearError?: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("PUBLIC");
  const [description, setDescription] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const t = useTranslations("messaging");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), type, description: description.trim() || undefined, memberIds: selectedMembers });
  }

  function toggleMember(userId: string) {
    setSelectedMembers((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        <h3 className="font-bold text-lg mb-4">{t("createChannel.title")}</h3>

        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <label className="block text-sm font-medium mb-1">{t("createChannel.name")}</label>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); onClearError?.(); }}
          className="w-full border rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder={t("createChannel.namePlaceholder")}
          required
        />

        <label className="block text-sm font-medium mb-1">{t("createChannel.type")}</label>
        <select value={type} onChange={(e) => setType(e.target.value as ChannelType)} className="w-full border rounded px-3 py-2 mb-3">
          <option value="PUBLIC">{t("createChannel.typePublic")}</option>
          <option value="PRIVATE">{t("createChannel.typePrivate")}</option>
          <option value="GROUP">{t("createChannel.typeGroup")}</option>
        </select>

        <label className="block text-sm font-medium mb-1">{t("createChannel.description")}</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder={t("createChannel.descriptionPlaceholder")}
        />

        {type !== "PUBLIC" && (
          <>
            <label className="block text-sm font-medium mb-1">{t("createChannel.addMembers")}</label>
            <div className="max-h-40 overflow-y-auto border rounded p-2 mb-3">
              {tenantUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 px-1 rounded">
                  <input type="checkbox" checked={selectedMembers.includes(u.id)} onChange={() => toggleMember(u.id)} />
                  <span className="text-sm">{u.name ?? u.email}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded border hover:bg-gray-50">
            {t("createChannel.cancel")}
          </button>
          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
            {t("createChannel.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
