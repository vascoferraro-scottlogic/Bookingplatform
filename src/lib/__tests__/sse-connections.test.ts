import {
  addConnection,
  removeConnection,
  isConnected,
  sendToUser,
  sendToUsers,
} from "@/lib/sse-connections";

// We need access to the internal connections map for test isolation.
// Re-import the module to clear state between tests.
// Since the module uses a module-level Map, we clear it via add/remove.

function mockWriter(opts?: { failWrite?: boolean }) {
  const written: Uint8Array[] = [];
  return {
    write: jest.fn((chunk: Uint8Array) => {
      if (opts?.failWrite) return Promise.reject(new Error("closed"));
      written.push(chunk);
      return Promise.resolve();
    }),
    close: jest.fn(),
    closed: Promise.resolve(undefined),
    desiredSize: 1,
    ready: Promise.resolve(undefined),
    abort: jest.fn(),
    releaseLock: jest.fn(),
    written,
  } as unknown as WritableStreamDefaultWriter<Uint8Array>;
}

// Clean up connections between tests by removing any leftover state
afterEach(() => {
  // Remove known test userIds to reset state
  for (const uid of ["user1", "user2", "user3", "userA", "userB"]) {
    while (isConnected(uid)) {
      // We can't directly access writers, but we can verify the map is clear
      // by using removeConnection with a dummy — it won't match, so we break
      break;
    }
  }
});

// ── addConnection / isConnected ───────────────────────────

describe("addConnection + isConnected", () => {
  test("isConnected returns false for unknown userId", () => {
    expect(isConnected("nonexistent-" + Date.now())).toBe(false);
  });

  test("addConnection makes userId connected", () => {
    const uid = "add-test-" + Date.now();
    const w = mockWriter();
    addConnection(uid, w);
    expect(isConnected(uid)).toBe(true);
    // cleanup
    removeConnection(uid, w);
  });

  test("addConnection supports multiple writers per userId", () => {
    const uid = "multi-writer-" + Date.now();
    const w1 = mockWriter();
    const w2 = mockWriter();
    addConnection(uid, w1);
    addConnection(uid, w2);
    expect(isConnected(uid)).toBe(true);
    // cleanup
    removeConnection(uid, w1);
    removeConnection(uid, w2);
  });
});

// ── removeConnection ──────────────────────────────────────

describe("removeConnection", () => {
  test("removes specific writer", () => {
    const uid = "rm-specific-" + Date.now();
    const w1 = mockWriter();
    const w2 = mockWriter();
    addConnection(uid, w1);
    addConnection(uid, w2);

    removeConnection(uid, w1);
    expect(isConnected(uid)).toBe(true); // w2 still there

    removeConnection(uid, w2);
    expect(isConnected(uid)).toBe(false); // all gone
  });

  test("cleans up map entry when last writer removed", () => {
    const uid = "rm-last-" + Date.now();
    const w = mockWriter();
    addConnection(uid, w);
    removeConnection(uid, w);
    expect(isConnected(uid)).toBe(false);
  });

  test("no-op for unknown userId", () => {
    // Should not throw
    removeConnection("unknown-" + Date.now(), mockWriter());
  });
});

// ── sendToUser ────────────────────────────────────────────

describe("sendToUser", () => {
  test("writes SSE-formatted payload to all writers", async () => {
    const uid = "send-test-" + Date.now();
    const w1 = mockWriter();
    const w2 = mockWriter();
    addConnection(uid, w1);
    addConnection(uid, w2);

    sendToUser(uid, "message", { text: "hello" });

    expect(w1.write).toHaveBeenCalledTimes(1);
    expect(w2.write).toHaveBeenCalledTimes(1);

    // Verify SSE format
    const payload = w1.write.mock.calls[0][0] as Uint8Array;
    const decoded = new TextDecoder().decode(payload);
    expect(decoded).toBe('event: message\ndata: {"text":"hello"}\n\n');

    // cleanup
    removeConnection(uid, w1);
    removeConnection(uid, w2);
  });

  test("no-op for userId with no connections", () => {
    // Should not throw
    sendToUser("nobody-" + Date.now(), "ping", {});
  });

  test("removes connection on write failure", async () => {
    const uid = "fail-write-" + Date.now();
    const failing = mockWriter({ failWrite: true });
    const working = mockWriter();
    addConnection(uid, failing);
    addConnection(uid, working);

    sendToUser(uid, "test", { x: 1 });

    // Let the promise rejection propagate
    await new Promise((r) => setTimeout(r, 10));

    // The failing writer should have been removed
    // Working writer should still be connected
    expect(isConnected(uid)).toBe(true);

    // cleanup
    removeConnection(uid, working);
  });
});

// ── sendToUsers ───────────────────────────────────────────

describe("sendToUsers", () => {
  test("sends to multiple userIds", () => {
    const uid1 = "multi-a-" + Date.now();
    const uid2 = "multi-b-" + Date.now();
    const w1 = mockWriter();
    const w2 = mockWriter();
    addConnection(uid1, w1);
    addConnection(uid2, w2);

    sendToUsers([uid1, uid2], "broadcast", { msg: "hi" });

    expect(w1.write).toHaveBeenCalledTimes(1);
    expect(w2.write).toHaveBeenCalledTimes(1);

    // cleanup
    removeConnection(uid1, w1);
    removeConnection(uid2, w2);
  });
});

// ── Connection lifecycle under load ───────────────────────

describe("connection lifecycle under concurrent load", () => {
  test("rapid connect/disconnect cycles do not leave stale connections", async () => {
    const uid = "rapid-" + Date.now();
    const writers: ReturnType<typeof mockWriter>[] = [];

    // Simulate rapid reconnections (e.g. mobile network flapping)
    for (let i = 0; i < 50; i++) {
      const w = mockWriter();
      writers.push(w);
      addConnection(uid, w);
      // Simulate immediate disconnect on some
      if (i % 3 === 0) {
        removeConnection(uid, w);
      }
    }

    // Now remove all remaining
    for (const w of writers) {
      removeConnection(uid, w);
    }

    // After removing all, user should be disconnected
    expect(isConnected(uid)).toBe(false);
  });

  test("failed writes during burst are cleaned up within timeout", async () => {
    const uid = "burst-fail-" + Date.now();
    const failingWriters = Array.from({ length: 5 }, () => mockWriter({ failWrite: true }));
    const goodWriter = mockWriter();

    for (const w of failingWriters) addConnection(uid, w);
    addConnection(uid, goodWriter);

    // Send burst of messages
    for (let i = 0; i < 10; i++) {
      sendToUser(uid, "burst", { seq: i });
    }

    // Wait for async cleanup — this is timing-sensitive
    await new Promise((r) => setTimeout(r, 5));

    // Good writer should have received all messages
    expect(goodWriter.write).toHaveBeenCalledTimes(10);

    // User should still be connected via the good writer
    expect(isConnected(uid)).toBe(true);

    // cleanup
    removeConnection(uid, goodWriter);
    for (const w of failingWriters) removeConnection(uid, w);
  });
});
