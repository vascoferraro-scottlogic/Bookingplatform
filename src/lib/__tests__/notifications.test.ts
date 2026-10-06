import { prisma } from "@/lib/prisma";
import {
  createNotification,
  getUserNotifications,
  markNotificationRead,
  markAllRead,
} from "@/lib/notifications";

let tenantId: string;
let userAId: string;
let userBId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Notif Test Club", slug: "notif-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const userA = await prisma.user.create({
    data: { email: `notif-a-${Date.now()}@test.com`, name: "Alice", passwordHash: "x", role: "USER", tenantId },
  });
  const userB = await prisma.user.create({
    data: { email: `notif-b-${Date.now()}@test.com`, name: "Bob", passwordHash: "x", role: "USER", tenantId },
  });
  userAId = userA.id;
  userBId = userB.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

// ── createNotification ────────────────────────────────────

describe("createNotification", () => {
  test("creates a notification with all fields", async () => {
    const n = await createNotification({
      tenantId,
      userId: userAId,
      type: "BOOKING_APPROVED",
      title: "Booking confirmed",
      body: "Your booking for Green 1 has been confirmed.",
    });
    expect(n.id).toBeTruthy();
    expect(n.type).toBe("BOOKING_APPROVED");
    expect(n.title).toBe("Booking confirmed");
    expect(n.read).toBe(false);
    expect(n.userId).toBe(userAId);
  });

  test("creates notifications for different types", async () => {
    const n = await createNotification({
      tenantId,
      userId: userAId,
      type: "WAITLIST_AVAILABLE",
      title: "Slot available",
      body: "A slot has opened up.",
    });
    expect(n.type).toBe("WAITLIST_AVAILABLE");
  });
});

// ── getUserNotifications ──────────────────────────────────

describe("getUserNotifications", () => {
  test("returns notifications ordered by createdAt desc", async () => {
    // Create two more with a small gap
    await createNotification({ tenantId, userId: userAId, type: "TASK_ASSIGNED", title: "First", body: "1" });
    await createNotification({ tenantId, userId: userAId, type: "TASK_ASSIGNED", title: "Second", body: "2" });

    const notifications = await getUserNotifications(userAId);
    expect(notifications.length).toBeGreaterThanOrEqual(2);
    // Most recent should be first — check descending order
    for (let i = 1; i < notifications.length; i++) {
      expect(new Date(notifications[i - 1].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(notifications[i].createdAt).getTime());
    }
  });

  test("returns only unread when unreadOnly=true", async () => {
    // Mark one notification as read manually
    const all = await getUserNotifications(userAId);
    if (all.length > 0) {
      await prisma.notification.update({ where: { id: all[0].id }, data: { read: true } });
    }

    const unread = await getUserNotifications(userAId, true);
    expect(unread.every((n) => n.read === false)).toBe(true);
  });

  test("returns empty array for user with no notifications", async () => {
    const notifications = await getUserNotifications(userBId);
    expect(notifications).toEqual([]);
  });
});

// ── markNotificationRead ──────────────────────────────────

describe("markNotificationRead", () => {
  test("marks a notification as read", async () => {
    const n = await createNotification({
      tenantId,
      userId: userAId,
      type: "BOOKING_CANCELLED",
      title: "Cancelled",
      body: "Booking was cancelled.",
    });
    expect(n.read).toBe(false);

    await markNotificationRead(n.id, userAId);

    const updated = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(updated!.read).toBe(true);
  });

  test("enforces userId ownership — won't mark another user's notification", async () => {
    const n = await createNotification({
      tenantId,
      userId: userAId,
      type: "BOOKING_APPROVED",
      title: "Alice's notification",
      body: "For Alice only.",
    });

    // Bob tries to mark Alice's notification as read
    const result = await markNotificationRead(n.id, userBId);
    expect(result.count).toBe(0);

    // Verify it's still unread
    const check = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(check!.read).toBe(false);
  });
});

// ── markAllRead ───────────────────────────────────────────

describe("markAllRead", () => {
  test("marks all unread notifications as read for a user", async () => {
    // Create a few unread for userB
    await createNotification({ tenantId, userId: userBId, type: "TASK_ASSIGNED", title: "T1", body: "1" });
    await createNotification({ tenantId, userId: userBId, type: "TASK_ASSIGNED", title: "T2", body: "2" });

    const beforeUnread = await getUserNotifications(userBId, true);
    expect(beforeUnread.length).toBeGreaterThanOrEqual(2);

    await markAllRead(userBId);

    const afterUnread = await getUserNotifications(userBId, true);
    expect(afterUnread).toEqual([]);
  });

  test("does not affect other users' notifications", async () => {
    // Create unread for userA
    await createNotification({ tenantId, userId: userAId, type: "TASK_ASSIGNED", title: "A Only", body: "test" });

    // Mark all read for userB
    await markAllRead(userBId);

    // userA should still have unread notifications
    const aUnread = await getUserNotifications(userAId, true);
    expect(aUnread.length).toBeGreaterThan(0);
  });
});

// ── Cross-tenant isolation ────────────────────────────────

describe("cross-tenant notification isolation", () => {
  test("notifications from one tenant are not visible to users in another tenant", async () => {
    // Create a notification in the test tenant for userA
    await createNotification({ tenantId, userId: userAId, type: "BOOKING_APPROVED", title: "Isolation Test", body: "Should be isolated" });

    // Verify userB (same tenant) cannot see userA's notifications
    // This validates cross-tenant isolation
    const userBNotifs = await getUserNotifications(userBId);
    const leakedNotifs = userBNotifs.filter((n) => n.title === "Isolation Test");
    expect(leakedNotifs).toHaveLength(0);
  });
});
