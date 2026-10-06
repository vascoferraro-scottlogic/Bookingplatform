type Writer = WritableStreamDefaultWriter<Uint8Array>;

const connections = new Map<string, Writer[]>();

const encoder = new TextEncoder();

export function addConnection(userId: string, writer: Writer) {
  const existing = connections.get(userId) ?? [];
  existing.push(writer);
  connections.set(userId, existing);
}

export function removeConnection(userId: string, writer: Writer) {
  const existing = connections.get(userId);
  if (!existing) return;
  const filtered = existing.filter((w) => w !== writer);
  if (filtered.length === 0) {
    connections.delete(userId);
  } else {
    connections.set(userId, filtered);
  }
}

export function isConnected(userId: string): boolean {
  return (connections.get(userId)?.length ?? 0) > 0;
}

export function sendToUser(userId: string, event: string, data: unknown) {
  const writers = connections.get(userId);
  if (!writers?.length) return;
  const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const writer of writers) {
    writer.write(payload).catch(() => {
      removeConnection(userId, writer);
    });
  }
}

export function sendToUsers(userIds: string[], event: string, data: unknown) {
  for (const userId of userIds) {
    sendToUser(userId, event, data);
  }
}
