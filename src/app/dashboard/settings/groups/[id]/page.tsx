"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PERMISSION_DOMAINS } from "@/lib/permission-defs";
import type { Permission } from "@prisma/client";

type Grant = { id: string; permission: Permission };
type GroupMemberEntry = {
  id: string;
  membershipId: string;
  membership: {
    id: string;
    user: { id: string; name: string | null; email: string };
  };
};

type GroupDetail = {
  id: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  grants: Grant[];
  members: GroupMemberEntry[];
};

type TenantMembership = {
  id: string;
  userId: string;
  role: string;
  status: string;
  user: { id: string; name: string | null; email: string };
};

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("settings.groups");

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"permissions" | "members">("permissions");

  // Permission editing state
  const [selectedPerms, setSelectedPerms] = useState<Set<Permission>>(new Set());
  const [permsDirty, setPermsDirty] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);
  const [permsMsg, setPermsMsg] = useState("");

  // Member management state
  const [allMemberships, setAllMemberships] = useState<TenantMembership[]>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [memberMsg, setMemberMsg] = useState("");

  // Name/description editing
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaMsg, setMetaMsg] = useState("");

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadGroup = useCallback(() => {
    fetch(`/api/groups/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setGroup(data);
          setSelectedPerms(new Set(data.grants.map((g: Grant) => g.permission)));
          setEditName(data.name);
          setEditDesc(data.description ?? "");
          setPermsDirty(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  // Load all memberships for the add-member dropdown
  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((users: any[]) => {
        // Convert users response to membership format
        // We need the memberships list — fetch from a different endpoint
      })
      .catch(() => {});

    // Fetch memberships for this tenant
    fetch("/api/groups/memberships")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAllMemberships)
      .catch(() => {});
  }, []);

  function togglePermission(perm: Permission) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
    setPermsDirty(true);
    setPermsMsg("");
  }

  async function savePermissions() {
    setSavingPerms(true);
    setPermsMsg("");
    const res = await fetch(`/api/groups/${id}/grants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: Array.from(selectedPerms) }),
    });
    setSavingPerms(false);
    if (res.ok) {
      setPermsMsg(t("permissionsSaved"));
      setPermsDirty(false);
      loadGroup();
    } else {
      setPermsMsg(t("permissionsFailed"));
    }
  }

  async function addMember(membershipId: string) {
    setMemberMsg("");
    setAddingMember(true);
    const res = await fetch(`/api/groups/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    setAddingMember(false);
    if (res.ok) {
      setMemberMsg(t("memberAdded"));
      loadGroup();
    } else {
      const body = await res.json().catch(() => ({}));
      setMemberMsg(body.error ?? t("saveFailed"));
    }
  }

  async function removeMember(membershipId: string) {
    setMemberMsg("");
    const res = await fetch(`/api/groups/${id}/members/${membershipId}`, { method: "DELETE" });
    if (res.ok) {
      setMemberMsg(t("memberRemoved"));
      loadGroup();
    } else {
      setMemberMsg(t("saveFailed"));
    }
  }

  async function saveMeta() {
    if (!editName.trim()) return;
    setSavingMeta(true);
    setMetaMsg("");
    const res = await fetch(`/api/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
    });
    setSavingMeta(false);
    if (res.ok) {
      setMetaMsg(t("saved"));
      loadGroup();
    } else {
      const body = await res.json().catch(() => ({}));
      setMetaMsg(body.error ?? t("saveFailed"));
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard/settings/groups");
    }
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!group) return <div className="p-6 text-red-600">Group not found.</div>;

  const currentMemberIds = new Set(group.members.map((m) => m.membershipId));
  const availableToAdd = allMemberships.filter((m) => !currentMemberIds.has(m.id) && m.status === "ACTIVE");

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/dashboard/settings">{t("breadcrumb")}</Link>
        <span className="mx-2">/</span>
        <Link href="/dashboard/settings/groups">{t("title")}</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{group.name}</span>
      </nav>

      {/* Group metadata */}
      <div className="rounded-xl border bg-white p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-3">
            {group.isBuiltIn ? (
              <div>
                <h1 className="text-2xl font-bold">
                  {group.name}
                  <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {t("builtIn")}
                  </span>
                </h1>
                {group.description && <p className="text-sm text-gray-500 mt-1">{group.description}</p>}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("groupName")}</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("description")}</label>
                  <input
                    type="text"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                    className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveMeta}
                    disabled={savingMeta || !editName.trim() || (editName === group.name && editDesc === (group.description ?? ""))}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {t("save")}
                  </button>
                  {metaMsg && <span className="text-sm text-emerald-600">{metaMsg}</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab("permissions")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "permissions" ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("permissions")} ({group.grants.length})
        </button>
        <button
          onClick={() => setTab("members")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "members" ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("members")} ({group.members.length})
        </button>
      </div>

      {/* Permissions tab */}
      {tab === "permissions" && (
        <div className="space-y-4">
          {Object.entries(PERMISSION_DOMAINS).map(([key, domain]) => (
            <div key={key} className="rounded-xl border bg-white p-4">
              <h3 className="font-medium text-gray-800 mb-2">{domain.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {domain.permissions.map((perm) => (
                  <label key={perm} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={selectedPerms.has(perm)}
                      onChange={() => togglePermission(perm)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-700">{perm.replace(/_/g, ".")}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button
              onClick={savePermissions}
              disabled={savingPerms || !permsDirty}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("save")}
            </button>
            {permsMsg && (
              <span className={`text-sm ${permsMsg === t("permissionsSaved") ? "text-emerald-600" : "text-red-600"}`}>
                {permsMsg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Members tab */}
      {tab === "members" && (
        <div className="space-y-4">
          {/* Add member */}
          <div className="rounded-xl border bg-white p-4">
            <h3 className="font-medium text-gray-800 mb-2">{t("addMember")}</h3>
            {availableToAdd.length === 0 ? (
              <p className="text-sm text-gray-500">All active members are already in this group.</p>
            ) : (
              <div className="flex gap-2 items-center">
                <select
                  id="add-member-select"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addMember(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  disabled={addingMember}
                >
                  <option value="" disabled>{t("selectMember")}</option>
                  {availableToAdd.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user.name ?? m.user.email} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {memberMsg && <p className="text-sm text-emerald-600 mt-2">{memberMsg}</p>}
          </div>

          {/* Current members */}
          {group.members.length === 0 ? (
            <p className="text-gray-500 text-sm">{t("noMembers")}</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-white">
              {group.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{m.membership.user.name ?? m.membership.user.email}</p>
                    {m.membership.user.name && (
                      <p className="text-sm text-gray-500">{m.membership.user.email}</p>
                    )}
                  </div>
                  <button
                    onClick={() => removeMember(m.membershipId)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    {t("removeMember")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Delete group (custom groups only) */}
      {!group.isBuiltIn && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          {confirmDelete ? (
            <div className="space-y-3">
              <p className="text-sm text-red-700">{t("deleteConfirm")}</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  {t("delete")}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-600 hover:text-red-800 font-medium"
            >
              {t("delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
