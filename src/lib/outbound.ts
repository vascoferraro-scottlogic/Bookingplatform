/**
 * Outbound messaging — channel-agnostic stub.
 *
 * In v1 NOTHING is actually delivered. Every call writes an `OutboundMessage`
 * row that the platform admin can inspect at /dashboard/platform/outbound.
 * Templates live on disk under `content/messages/{channel}/{name}.{ext}`.
 *
 * To wire a real provider later, swap the `dispatch()` implementation per
 * channel — the public API stays the same.
 */

import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import type {
  OutboundChannel,
  OutboundStatus,
  SocialPlatform,
} from "@prisma/client";

export type SendOutboundInput = {
  channel: OutboundChannel;
  to: string;
  subject?: string;
  /** Template name relative to `content/messages/{channel}/`, without extension. */
  template: string;
  /** Variables interpolated into the template via `{{key}}` substitution. */
  data?: Record<string, string | number | null | undefined>;
  /** Required for SOCIAL_POST; ignored otherwise. */
  socialPlatform?: SocialPlatform;
  tenantId?: string | null;
  /** Optional traceability link, e.g. `relatedEntity: "TenantApplication"`. */
  relatedEntity?: string;
  relatedEntityId?: string;
};

export type SendOutboundResult = {
  id: string;
  status: OutboundStatus;
};

const TEMPLATE_ROOT = path.join(process.cwd(), "content", "messages");
const SMS_MAX_LENGTH = 160;

const templateCache = new Map<string, string>();

/**
 * Public entry point. Renders the template, writes an OutboundMessage row,
 * and returns the row id. Never throws on rendering or DB issues — failures
 * are recorded on the row's `error` column so the inspector can surface them.
 */
export async function sendOutbound(
  input: SendOutboundInput,
): Promise<SendOutboundResult> {
  const data = input.data ?? {};

  let bodyText = "";
  let bodyHtml: string | null = null;
  let renderError: string | null = null;

  try {
    const txtTemplate = await loadTemplate(input.channel, input.template, "txt");
    bodyText = interpolate(txtTemplate, data);

    if (input.channel === "EMAIL") {
      const htmlTemplate = await loadTemplate(input.channel, input.template, "html");
      const htmlBody = interpolate(htmlTemplate, data);
      const layout = await loadTemplate("EMAIL", "_layout", "html");
      bodyHtml = interpolate(layout, {
        subject: input.subject ?? "",
        body: htmlBody,
      });
    }

    if (input.channel === "SMS" && bodyText.length > SMS_MAX_LENGTH) {
      // Don't fail; surface as a soft warning on the row.
      renderError = `SMS body is ${bodyText.length} chars (limit ${SMS_MAX_LENGTH}).`;
    }
  } catch (err) {
    renderError = (err as Error).message;
  }

  const row = await prisma.outboundMessage.create({
    data: {
      channel: input.channel,
      status: "STUBBED",
      toAddress: input.to,
      subject: input.subject ? interpolate(input.subject, data) : null,
      bodyText: bodyText || `[render failed: ${renderError ?? "unknown"}]`,
      bodyHtml,
      template: input.template,
      templateData: JSON.stringify(data),
      socialPlatform:
        input.channel === "SOCIAL_POST" ? input.socialPlatform ?? null : null,
      tenantId: input.tenantId ?? null,
      relatedEntity: input.relatedEntity ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      error: renderError,
    },
    select: { id: true, status: true },
  });

  return row;
}

/** Convenience helpers — sugar over `sendOutbound`. */
export const sendEmail = (
  args: Omit<SendOutboundInput, "channel" | "socialPlatform">,
) => sendOutbound({ ...args, channel: "EMAIL" });

export const sendSms = (
  args: Omit<SendOutboundInput, "channel" | "subject" | "socialPlatform">,
) => sendOutbound({ ...args, channel: "SMS" });

export const sendSocial = (
  args: Omit<SendOutboundInput, "channel" | "subject"> & {
    socialPlatform: SocialPlatform;
  },
) => sendOutbound({ ...args, channel: "SOCIAL_POST" });

// ── Internals ───────────────────────────────────────────────

async function loadTemplate(
  channel: OutboundChannel | "EMAIL",
  name: string,
  ext: "txt" | "html",
): Promise<string> {
  const dir = channelDir(channel);
  const cacheKey = `${dir}/${name}.${ext}`;
  const cached = templateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const fullPath = path.join(TEMPLATE_ROOT, dir, `${name}.${ext}`);
  const contents = await fs.readFile(fullPath, "utf8");
  // Cache in production only; in dev, re-read so edits to templates show up.
  if (process.env.NODE_ENV === "production") {
    templateCache.set(cacheKey, contents);
  }
  return contents;
}

function channelDir(channel: OutboundChannel | "EMAIL"): string {
  switch (channel) {
    case "EMAIL":
      return "email";
    case "SMS":
      return "sms";
    case "SOCIAL_POST":
      return "social";
  }
}

/** Plain `{{key}}` substitution. Missing keys render as `[key]` for visibility. */
export function renderTemplate(
  template: string,
  data: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_, key: string) => {
    const v = data[key];
    if (v === undefined || v === null || v === "") {
      return `[${key}]`;
    }
    return String(v);
  });
}

/** Internal alias retained for callsites within this module. */
const interpolate = renderTemplate;
