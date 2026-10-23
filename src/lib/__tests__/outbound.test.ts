jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import { renderTemplate, sendOutbound } from "@/lib/outbound";
import { prismaMock } from "@/test-utils/prisma-mock";

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
  beforeEach(() => {
    prismaMock.outboundMessage.create.mockResolvedValue({ id: "msg-1", status: "STUBBED" } as never);
  });

  const written = () => (prismaMock.outboundMessage.create.mock.calls[0][0] as any).data;

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

    expect(result).toEqual({ id: "msg-1", status: "STUBBED" });
    expect(written()).toMatchObject({
      channel: "EMAIL",
      status: "STUBBED",
      toAddress: "wullie@test.local",
      subject: "Test Wullie",
      relatedEntity: "TestSuite",
      relatedEntityId: "outbound-1",
      error: null,
    });
    expect(written().bodyText).toContain("Wullie");
    expect(written().bodyText).toContain("Burnside");
    expect(written().bodyHtml).toContain("Burnside");
  });

  test("flags an SMS body over 160 characters in the error column without failing", async () => {
    await sendOutbound({
      channel: "SMS",
      to: "+447000000000",
      template: "booking-confirmed",
      data: { clubName: "x".repeat(200) },
    });

    expect(written().channel).toBe("SMS");
    expect(written().bodyText.length).toBeGreaterThan(160);
    expect(written().error).toMatch(/limit 160/);
  });

  test("an SMS within 160 characters has no error", async () => {
    await sendOutbound({
      channel: "SMS",
      to: "+447000000000",
      template: "booking-confirmed",
      data: { clubName: "Burnside" },
    });

    expect(written().bodyText.length).toBeLessThanOrEqual(160);
    expect(written().error).toBeNull();
  });

  test("captures social posts with the specified platform", async () => {
    await sendOutbound({
      channel: "SOCIAL_POST",
      to: "page-id",
      socialPlatform: "FACEBOOK",
      template: "tenant-joined",
      data: { tenantName: "Burnside Bowls", clubName: "Burnside Bowls" },
    });

    expect(written()).toMatchObject({ channel: "SOCIAL_POST", socialPlatform: "FACEBOOK" });
  });
});
