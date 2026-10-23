/**
 * Real-time notification delivery (FR-NTF-001) and the override-notice
 * notification type (FR-BOOK-010).
 *
 * The real sse-connections module is used with a mock stream writer, as in
 * sse-connections.test.ts, so the test sees exactly what a connected
 * browser would receive.
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import fs from "fs";
import path from "path";
import { prismaMock } from "@/test-utils/prisma-mock";
import { addConnection, removeConnection } from "@/lib/sse-connections";
import { createNotification } from "@/lib/notifications";

function mockWriter() {
  return {
    write: jest.fn(() => Promise.resolve()),
    close: jest.fn(),
    closed: Promise.resolve(undefined),
    desiredSize: 1,
    ready: Promise.resolve(undefined),
    abort: jest.fn(),
    releaseLock: jest.fn(),
  } as unknown as WritableStreamDefaultWriter<Uint8Array>;
}

const decoded = (w: WritableStreamDefaultWriter<Uint8Array>) =>
  (w.write as jest.Mock).mock.calls.map(([chunk]) => new TextDecoder().decode(chunk as Uint8Array));

beforeEach(() => {
  prismaMock.notification.create.mockImplementation((async ({ data }: any) => ({
    id: "notif-1", read: false, createdAt: new Date(), ...data,
  })) as never);
});

describe("createNotification — real-time push", () => {
  test("[B-65] FR-NTF-001 – creating a notification pushes an SSE event to the user's open connection", async () => {
    const userId = `push-user-${Date.now()}`;
    const writer = mockWriter();
    addConnection(userId, writer);

    try {
      await createNotification({
        tenantId: "tenant-1",
        userId,
        type: "TASK_ASSIGNED",
        title: "Task assigned to you",
        body: "You have been assigned: Broken gate",
      });
      await new Promise((r) => setTimeout(r, 0));

      const frames = decoded(writer);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatch(/^event: \S+\ndata: [^\n]+\n\n$/);
      expect(frames[0]).toContain("Task assigned to you");
    } finally {
      removeConnection(userId, writer);
    }
  });

  test("[B-65] FR-NTF-001 – the push goes only to the notified user, not to other connections", async () => {
    const userId = `push-target-${Date.now()}`;
    const otherId = `push-other-${Date.now()}`;
    const target = mockWriter();
    const other = mockWriter();
    addConnection(userId, target);
    addConnection(otherId, other);

    try {
      await createNotification({ tenantId: "tenant-1", userId, type: "BOOKING_APPROVED", title: "Approved", body: "x" });
      await new Promise((r) => setTimeout(r, 0));

      expect(decoded(target)).toHaveLength(1);
      expect(decoded(other)).toHaveLength(0);
    } finally {
      removeConnection(userId, target);
      removeConnection(otherId, other);
    }
  });

  test("[B-65] FR-NTF-001 – the notification is still stored when the user has no open connection", async () => {
    await createNotification({ tenantId: "tenant-1", userId: `offline-${Date.now()}`, type: "BOOKING_CANCELLED", title: "t", body: "b" });

    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe("Notification types", () => {
  /**
   * NotificationType is a compile-time union in src/lib/notifications.ts
   * (Notification.type is a plain String column), so the declared values are
   * read from source: the union, or a NotificationType enum in the schema if
   * the fix moves it there.
   */
  function declaredNotificationTypes(): string[] {
    const root = path.resolve(__dirname, "../../..");
    const lib = fs.readFileSync(path.join(root, "src/lib/notifications.ts"), "utf8");
    const union = lib.match(/NotificationType\s*=([^;]+);/);
    const fromLib = union ? [...union[1].matchAll(/["']([A-Z_]+)["']/g)].map((m) => m[1]) : [];
    const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const enumBody = schema.match(/enum\s+NotificationType\s*\{([^}]*)\}/);
    const fromSchema = enumBody ? enumBody[1].split(/\s+/).filter((w) => /^[A-Z_]+$/.test(w)) : [];
    return [...fromLib, ...fromSchema];
  }

  test("[B-65] FR-BOOK-010 – an override-notice notification type exists", () => {
    const types = declaredNotificationTypes();

    expect(types.length).toBeGreaterThan(0);
    expect(types).toEqual(expect.arrayContaining([expect.stringMatching(/OVERRIDE/)]));
  });
});
