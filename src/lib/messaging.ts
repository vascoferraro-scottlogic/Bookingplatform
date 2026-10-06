import { prisma } from "@/lib/prisma";
import type { ChannelType, ChannelMemberRole } from "@prisma/client";

// ─── Channel CRUD ────────────────────────────────────────────

export async function createChannel(params: {
  tenantId: string;
  createdById: string;
  name: string;
  type: ChannelType;
  description?: string;
  memberIds?: string[];
}) {
  const channel = await prisma.channel.create({
    data: {
      tenantId: params.tenantId,
      name: params.name,
      type: params.type,
      description: params.description,
      createdById: params.createdById,
      members: {
        create: [
          { userId: params.createdById, role: "OWNER" },
          ...(params.memberIds ?? [])
            .filter((id) => id !== params.createdById)
            .map((userId) => ({ userId, role: "MEMBER" as ChannelMemberRole })),
        ],
      },
    },
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  return channel;
}

export async function getOrCreateDirectChannel(tenantId: string, userIdA: string, userIdB: string) {
  const [u1, u2] = [userIdA, userIdB].sort();
  const name = `dm:${u1}:${u2}`;

  const existing = await prisma.channel.findUnique({
    where: { tenantId_name: { tenantId, name } },
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  if (existing) return existing;

  return createChannel({ tenantId, createdById: u1, name, type: "DIRECT", memberIds: [u2] });
}

export async function getUserChannels(userId: string, tenantId: string) {
  const memberships = await prisma.channelMember.findMany({
    where: { userId, channel: { tenantId } },
    include: {
      channel: {
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
          _count: { select: { messages: true } },
        },
      },
    },
    orderBy: { channel: { updatedAt: "desc" } },
  });

  const cursors = await prisma.messageReadCursor.findMany({
    where: { userId, channelId: { in: memberships.map((m) => m.channel.id) } },
  });
  const cursorMap = new Map(cursors.map((c) => [c.channelId, c.lastReadMessageId]));

  const channels = await Promise.all(
    memberships.map(async (m) => {
      const lastReadId = cursorMap.get(m.channel.id);
      let unreadCount = 0;
      if (lastReadId) {
        const lastRead = await prisma.message.findUnique({ where: { id: lastReadId }, select: { createdAt: true } });
        if (lastRead) {
          unreadCount = await prisma.message.count({
            where: { channelId: m.channel.id, createdAt: { gt: lastRead.createdAt }, deletedAt: null },
          });
        }
      } else {
        unreadCount = m.channel._count.messages;
      }

      return { ...m.channel, unreadCount, myRole: m.role, mutedUntil: m.mutedUntil };
    }),
  );

  return channels;
}

export async function getChannelById(channelId: string) {
  return prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
}

// ─── Messages ────────────────────────────────────────────────

export async function getChannelMessages(channelId: string, cursor?: string, limit = 50) {
  const messages = await prisma.message.findMany({
    where: { channelId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return messages.reverse();
}

export async function sendMessage(params: { channelId: string; tenantId: string; userId: string; body: string }) {
  const message = await prisma.message.create({
    data: {
      channelId: params.channelId,
      tenantId: params.tenantId,
      userId: params.userId,
      body: params.body,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  // Touch channel updatedAt for ordering
  await prisma.channel.update({ where: { id: params.channelId }, data: { updatedAt: new Date() } });

  return message;
}

export async function pinMessage(messageId: string, pinned: boolean) {
  return prisma.message.update({ where: { id: messageId }, data: { pinned } });
}

export async function softDeleteMessage(messageId: string) {
  return prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
}

// ─── Membership ──────────────────────────────────────────────

export async function isMember(channelId: string, userId: string) {
  const member = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  return member;
}

export async function addMember(channelId: string, userId: string, role: ChannelMemberRole = "MEMBER") {
  return prisma.channelMember.create({ data: { channelId, userId, role } });
}

export async function removeMember(channelId: string, userId: string) {
  return prisma.channelMember.delete({
    where: { channelId_userId: { channelId, userId } },
  });
}

export async function muteUser(channelId: string, userId: string, until: Date) {
  return prisma.channelMember.update({
    where: { channelId_userId: { channelId, userId } },
    data: { mutedUntil: until },
  });
}

export async function unmuteUser(channelId: string, userId: string) {
  return prisma.channelMember.update({
    where: { channelId_userId: { channelId, userId } },
    data: { mutedUntil: null },
  });
}

// ─── Read Cursors ────────────────────────────────────────────

export async function updateReadCursor(channelId: string, userId: string, lastReadMessageId: string) {
  return prisma.messageReadCursor.upsert({
    where: { channelId_userId: { channelId, userId } },
    update: { lastReadMessageId },
    create: { channelId, userId, lastReadMessageId },
  });
}

// ─── Admin Queries ───────────────────────────────────────────

export async function getTenantChannels(tenantId: string) {
  return prisma.channel.findMany({
    where: { tenantId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}
