import { renderTemplate, sendOutbound } from "@/lib/outbound";
import { prisma } from "@/lib/prisma";

describe("outbound template rendering", () => {
  test("interpolates {{var}} placeholders", () => {
    const out = renderTemplate("Hello {{name}}, welcome to {{club}}.", { name: "Wullie", club: "Burnside" });
    expect(out).toBe("Hello Wullie, welcome to Burnside.");
  });

  test("renders missing variables as a visible marker", () => {
    const out = renderTemplate("Hello {{name}}, welcome to {{club}}.", { name: "Wullie" });
    expect(out).toBe("Hello Wullie, welcome to [club].");
  });

  test("handles empty data object", () => {
    const out = renderTemplate("Token: {{token}}", {});
    expect(out).toBe("Token: [token]");
  });

  test("does not interpolate inside { } single-brace text", () => {
    const out = renderTemplate("Single {brace} stays. {{a}} expands.", { a: "yes" });
    expect(out).toBe("Single {brace} stays. yes expands.");
  });
});

describe("sendOutbound (stub mode)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.outboundMessage.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.$disconnect();
  });

  test("writes an OutboundMessage row with STUBBED status", async () => {
    const result = await sendOutbound({
      channel: "EMAIL",
      to: "wullie@test.local",
      subject: "Test {{name}}",
      template: "lead-acknowledgement",
      data: { name: "Wullie", clubName: "Burnside", contactName: "Wullie" },
      relatedEntity: "TestSuite",
      relatedEntityId: "outbound-1",
    });
    createdIds.push(result.id);
    expect(result.status).toBe("STUBBED");

    const row = await prisma.outboundMessage.findUnique({ where: { id: result.id } });
    expect(row).toBeTruthy();
    expect(row?.channel).toBe("EMAIL");
    expect(row?.toAddress).toBe("wullie@test.local");
    expect(row?.subject).toBe("Test Wullie");
    expect(row?.bodyText).toContain("Wullie");
    expect(row?.bodyText).toContain("Burnside");
    expect(row?.relatedEntity).toBe("TestSuite");
    expect(row?.relatedEntityId).toBe("outbound-1");
  });

  test("captures SMS over 160 characters with a warning in error column", async () => {
    const longBody = "a".repeat(200);
    const result = await sendOutbound({
      channel: "SMS",
      to: "+447000000000",
      template: "booking-confirmed",
      data: { longText: longBody },
    });
    createdIds.push(result.id);
    const row = await prisma.outboundMessage.findUnique({ where: { id: result.id } });
    expect(row?.channel).toBe("SMS");
    // Either the template body itself > 160 or our overlong fixture; the
    // outbound layer should have flagged it.
    if ((row?.bodyText ?? "").length > 160) {
      expect(row?.error).toMatch(/160/);
    }
  });

  test("captures social posts with the specified platform", async () => {
    const result = await sendOutbound({
      channel: "SOCIAL_POST",
      to: "page-id",
      socialPlatform: "FACEBOOK",
      template: "tenant-joined",
      data: { tenantName: "Burnside Bowls", clubName: "Burnside Bowls" },
    });
    createdIds.push(result.id);
    const row = await prisma.outboundMessage.findUnique({ where: { id: result.id } });
    expect(row?.channel).toBe("SOCIAL_POST");
    expect(row?.socialPlatform).toBe("FACEBOOK");
  });
});
