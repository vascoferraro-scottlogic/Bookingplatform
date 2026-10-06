import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { getUserNotifications, markNotificationRead, markAllRead } from "@/lib/notifications";

/** Get notifications for the current user. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";
  const notifs = await getUserNotifications(session.user.id, unreadOnly);
  return NextResponse.json(notifs);
}

/** Mark notification(s) as read. */
export async function PATCH(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id, all } = await req.json();
  if (all) {
    await markAllRead(session.user.id);
  } else if (id) {
    await markNotificationRead(id, session.user.id);
  } else {
    return jsonError("Provide id or all: true");
  }
  return NextResponse.json({ ok: true });
}
