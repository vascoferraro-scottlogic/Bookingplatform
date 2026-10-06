"use client";

import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { visit } from "unist-util-visit";

/**
 * Renderer for help-article markdown.
 *
 * Supports two role-gated container directives:
 *   :::platform-admin     ...visible only when realRole === "PLATFORM_ADMIN"
 *   :::tenant-admin       ...visible only when realRole === "TENANT_ADMIN"
 *
 * Both render as styled callout boxes when shown. We use a tiny custom remark
 * plugin to convert directive nodes into HTML <div> nodes with a `data-callout`
 * attribute, then a custom div renderer surfaces them as styled blocks.
 *
 * We deliberately do NOT use rehype-raw or dangerouslySetInnerHTML — body
 * markdown is treated as untrusted (overrides are tenant-editable).
 */

interface Props {
  source: string;
  realRole?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function remarkRoleCallouts() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (
        node.type === "containerDirective" ||
        node.type === "leafDirective" ||
        node.type === "textDirective"
      ) {
        if (node.name !== "platform-admin" && node.name !== "tenant-admin") return;
        node.data = node.data || {};
        node.data.hName = "div";
        node.data.hProperties = { "data-callout": node.name };
      }
    });
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function HelpMarkdown({ source, realRole }: Props) {
  const t = useTranslations("help");
  return (
    <div className="prose prose-green max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkRoleCallouts]}
        components={{
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          div: ({ node, children, ...props }: any) => {
            const callout = props["data-callout"];
            if (callout === "platform-admin") {
              if (realRole !== "PLATFORM_ADMIN") return null;
              return (
                <div className="my-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 mb-1">
                    {t("markdown.forPlatformAdmins")}
                  </p>
                  <div className="text-sm text-orange-900">{children}</div>
                </div>
              );
            }
            if (callout === "tenant-admin") {
              if (realRole === "PLATFORM_ADMIN") return null;
              return (
                <div className="my-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-1">
                    {t("markdown.forClubAdmins")}
                  </p>
                  <div className="text-sm text-green-900">{children}</div>
                </div>
              );
            }
            return <div {...props}>{children}</div>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
