"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Notification {
  id: string;
  title: string;
  body?: string;
  type: string;
  createdAt: string;
}

export default function NotificationPreview() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("common");

  useEffect(() => {
    fetch("/api/notifications?unread=true")
      .then((r) => r.json())
      .then((data: Notification[]) => {
        setNotifications(Array.isArray(data) ? data.slice(0, 3) : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm animate-pulse">
        <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
        <div className="space-y-3">
          <div className="h-8 bg-gray-100 rounded" />
          <div className="h-8 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">
          {t("notifications.title")}
          {notifications.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold w-5 h-5">
              {notifications.length}
            </span>
          )}
        </h3>
        <Link href="/dashboard/notifications" className="text-sm text-green-600 hover:underline">
          View all &rarr;
        </Link>
      </div>
      {notifications.length === 0 ? (
        <p className="text-sm text-gray-500">{t("empty.noNotifications")}</p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li key={n.id} className="rounded-md bg-gray-50 px-4 py-2">
              <p className="text-sm font-medium text-gray-800">{n.title}</p>
              {n.body && <p className="text-xs text-gray-500 truncate">{n.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
