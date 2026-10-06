import { prisma } from "@/lib/prisma";

export type NotificationType =
  | "WAITLIST_AVAILABLE"
  | "TASK_ASSIGNED"
  | "TASK_PRIORITY_CHANGED"
  | "BOOKING_APPROVED"
  | "BOOKING_CANCELLED";

export async function createNotification(params: {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
}) {
  return prisma.notification.create({ data: params });
}

export async function getUserNotifications(userId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markNotificationRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
}

export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}
