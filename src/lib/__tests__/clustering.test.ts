/**
 * Pure unit tests for the message clustering helper. No DB; tests just the
 * algorithm shape: union-find by (channel, time-window, token Jaccard).
 */

import {
  clusterMessages,
  jaccardSimilarity,
  type ClusterableMessage,
} from "@/lib/agent/clustering";

function msg(
  id: string,
  channelId: string,
  body: string,
  userId = "u",
  minutesAgo = 0,
): ClusterableMessage {
  return {
    id,
    channelId,
    body,
    userId,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  };
}

describe("jaccardSimilarity", () => {
  test("equal sets → 1", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });
  test("disjoint sets → 0", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
  test("partial overlap", () => {
    // |∩|=1, |∪|=3
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
  test("empty sets → 0", () => {
    expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0);
  });
});

describe("clusterMessages", () => {
  test("merges similar messages in the same channel within window", () => {
    const messages = [
      msg("m1", "c1", "Rink 3 surface uneven near the south end"),
      msg("m2", "c1", "Rink 3 has uneven surface, hard to bowl"),
      msg("m3", "c1", "Anyone fancy a coffee in the clubhouse?"),
    ];
    const clusters = clusterMessages(messages);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].messageIds).toEqual(["m1", "m2"]);
    expect(clusters[0].participantCount).toBe(1);
    expect(clusters[1].messageIds).toEqual(["m3"]);
  });

  test("counts distinct authors as participantCount", () => {
    const messages = [
      msg("m1", "c1", "Sprinkler stuck on green 2", "userA"),
      msg("m2", "c1", "Sprinkler stuck on green 2 still", "userB"),
      msg("m3", "c1", "Yeah the sprinkler on green 2", "userC"),
    ];
    const clusters = clusterMessages(messages);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].participantCount).toBe(3);
  });

  test("does not merge across channels", () => {
    const messages = [
      msg("m1", "c1", "Net torn rink 4"),
      msg("m2", "c2", "Net torn rink 4"), // different channel
    ];
    const clusters = clusterMessages(messages);
    expect(clusters).toHaveLength(2);
  });

  test("does not merge outside the time window", () => {
    const messages = [
      msg("m1", "c1", "Loose paving slab outside clubhouse", "u", 0),
      msg("m2", "c1", "Loose paving slab outside clubhouse", "u", 120), // 2h ago
    ];
    const clusters = clusterMessages(messages, { windowMs: 60 * 60 * 1000 });
    expect(clusters).toHaveLength(2);
  });

  test("transitive merge via union-find (a~b, b~c → all in one cluster)", () => {
    const messages = [
      msg("m1", "c1", "Heating broken clubhouse"),
      msg("m2", "c1", "Heating broken pavilion"), // links to m1 via heating+broken
      msg("m3", "c1", "Pavilion broken urgently"), // links to m2 via pavilion+broken, NOT to m1 directly
    ];
    const clusters = clusterMessages(messages);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].messageIds).toHaveLength(3);
  });

  test("representativeId is the longest message in the cluster", () => {
    const messages = [
      msg("m1", "c1", "Rink three uneven surface"),
      msg("m2", "c1", "Rink three uneven surface near south end with serious bumps everywhere"),
    ];
    const clusters = clusterMessages(messages);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].representativeId).toBe("m2");
  });

  test("empty input → empty output", () => {
    expect(clusterMessages([])).toEqual([]);
  });

  test("preserves input order across clusters", () => {
    const messages = [
      msg("m1", "c1", "Sprinkler issue green 1"),
      msg("m2", "c1", "Net torn"),
      msg("m3", "c1", "Sprinkler issue on green 1"),
    ];
    const clusters = clusterMessages(messages);
    expect(clusters[0].messageIds[0]).toBe("m1"); // first cluster starts with m1
    expect(clusters[1].messageIds[0]).toBe("m2"); // second cluster starts with m2
  });
});
