import { prisma } from "@/lib/prisma";
import {
  createChannel,
  getOrCreateDirectChannel,
  getUserChannels,
  getChannelMessages,
  sendMessage,
  pinMessage,
  softDeleteMessage,
  isMember,
  addMember,
  removeMember,
  muteUser,
  unmuteUser,
  updateReadCursor,
  getChannelById,
} from "@/lib/messaging";

let tenantId: string;
let userAId: string;
let userBId: string;
let userCId: string;

beforeAll(async () => {
  // Create tenant + users for test isolation
  const tenant = await prisma.tenant.create({
    data: { name: "Msg Test Club", slug: "msg-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const mkUser = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash: "x", role: "USER", tenantId } });

  const a = await mkUser(`msg-a-${Date.now()}@test.com`, "Alice");
  const b = await mkUser(`msg-b-${Date.now()}@test.com`, "Bob");
  const c = await mkUser(`msg-c-${Date.now()}@test.com`, "Charlie");
  userAId = a.id;
  userBId = b.id;
  userCId = c.id;
});

afterAll(async () => {
  await prisma.messageReadCursor.deleteMany({ where: { channel: { tenantId } } });
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.channelMember.deleteMany({ where: { channel: { tenantId } } });
  await prisma.channel.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

// ── Channel Creation ──────────────────────────────────────

test("createChannel creates channel with owner membership", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "general", type: "PUBLIC" });
  expect(ch.name).toBe("general");
  expect(ch.members).toHaveLength(1);
  expect(ch.members[0].user.id).toBe(userAId);
});

test("createChannel with initial members", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "team", type: "GROUP", memberIds: [userBId, userCId] });
  expect(ch.members).toHaveLength(3);
});

test("createChannel rejects duplicate name per tenant", async () => {
  await expect(createChannel({ tenantId, createdById: userAId, name: "general", type: "PUBLIC" })).rejects.toThrow();
});

// ── Direct Messages ───────────────────────────────────────

test("getOrCreateDirectChannel creates DIRECT channel", async () => {
  const ch = await getOrCreateDirectChannel(tenantId, userAId, userBId);
  expect(ch.type).toBe("DIRECT");
  expect(ch.members).toHaveLength(2);
});

test("getOrCreateDirectChannel deduplicates regardless of arg order", async () => {
  const ch1 = await getOrCreateDirectChannel(tenantId, userAId, userBId);
  const ch2 = await getOrCreateDirectChannel(tenantId, userBId, userAId);
  expect(ch1.id).toBe(ch2.id);
});

// ── Messages ──────────────────────────────────────────────

test("sendMessage creates a message", async () => {
  const ch = await getOrCreateDirectChannel(tenantId, userAId, userBId);
  const msg = await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: "Hello!" });
  expect(msg.body).toBe("Hello!");
  expect(msg.user.id).toBe(userAId);
});

test("getChannelMessages returns messages in chronological order", async () => {
  const ch = await getOrCreateDirectChannel(tenantId, userAId, userBId);
  await sendMessage({ channelId: ch.id, tenantId, userId: userBId, body: "First" });
  await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: "Second" });

  const msgs = await getChannelMessages(ch.id);
  const bodies = msgs.map((m) => m.body);
  expect(bodies.indexOf("First")).toBeLessThan(bodies.indexOf("Second"));
});

test("getChannelMessages supports cursor pagination", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "paginate-test", type: "PUBLIC" });
  for (let i = 0; i < 5; i++) {
    await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: `msg-${i}` });
  }
  const first = await getChannelMessages(ch.id, undefined, 3);
  expect(first).toHaveLength(3);

  const rest = await getChannelMessages(ch.id, first[0].id, 10);
  expect(rest.length).toBeGreaterThan(0);
});

// ── Pin / Delete ──────────────────────────────────────────

test("pinMessage toggles pin flag", async () => {
  const ch = await getOrCreateDirectChannel(tenantId, userAId, userBId);
  const msg = await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: "Pin me" });
  const pinned = await pinMessage(msg.id, true);
  expect(pinned.pinned).toBe(true);

  const unpinned = await pinMessage(msg.id, false);
  expect(unpinned.pinned).toBe(false);
});

test("softDeleteMessage sets deletedAt", async () => {
  const ch = await getOrCreateDirectChannel(tenantId, userAId, userBId);
  const msg = await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: "Delete me" });
  const deleted = await softDeleteMessage(msg.id);
  expect(deleted.deletedAt).not.toBeNull();
});

// ── Membership ────────────────────────────────────────────

test("isMember returns membership or null", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "private-test", type: "PRIVATE" });
  expect(await isMember(ch.id, userAId)).toBeTruthy();
  expect(await isMember(ch.id, userCId)).toBeNull();
});

test("addMember and removeMember work", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "member-test", type: "PRIVATE" });
  await addMember(ch.id, userCId);
  expect(await isMember(ch.id, userCId)).toBeTruthy();

  await removeMember(ch.id, userCId);
  expect(await isMember(ch.id, userCId)).toBeNull();
});

// ── Mute ──────────────────────────────────────────────────

test("muteUser sets mutedUntil", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "mute-test", type: "PUBLIC", memberIds: [userBId] });
  const future = new Date(Date.now() + 60_000);
  await muteUser(ch.id, userBId, future);

  const member = await isMember(ch.id, userBId);
  expect(member?.mutedUntil).toEqual(future);
});

test("unmuteUser clears mutedUntil", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "unmute-test", type: "PUBLIC", memberIds: [userBId] });
  await muteUser(ch.id, userBId, new Date(Date.now() + 60_000));
  await unmuteUser(ch.id, userBId);

  const member = await isMember(ch.id, userBId);
  expect(member?.mutedUntil).toBeNull();
});

// ── Read Cursors / Unread ─────────────────────────────────

test("updateReadCursor tracks last read message", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "cursor-test", type: "PUBLIC", memberIds: [userBId] });
  const m1 = await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: "one" });
  await sendMessage({ channelId: ch.id, tenantId, userId: userAId, body: "two" });

  await updateReadCursor(ch.id, userBId, m1.id);

  const channels = await getUserChannels(userBId, tenantId);
  const target = channels.find((c) => c.id === ch.id);
  expect(target?.unreadCount).toBe(1);
});

test("getUserChannels returns all channels with unread counts", async () => {
  const channels = await getUserChannels(userAId, tenantId);
  expect(channels.length).toBeGreaterThan(0);
  for (const ch of channels) {
    expect(ch).toHaveProperty("unreadCount");
    expect(ch).toHaveProperty("myRole");
  }
});

// ── getChannelById ────────────────────────────────────────

test("getChannelById returns channel with members", async () => {
  const ch = await createChannel({ tenantId, createdById: userAId, name: "detail-test", type: "PUBLIC" });
  const detail = await getChannelById(ch.id);
  expect(detail?.id).toBe(ch.id);
  expect(detail?.members.length).toBeGreaterThan(0);
});

test("getChannelById returns null for non-existent channel", async () => {
  const detail = await getChannelById("nonexistent-id");
  expect(detail).toBeNull();
});
