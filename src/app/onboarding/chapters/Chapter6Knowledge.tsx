"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell, Field, inputClass } from "./shared";
import type { ChapterProps } from "./shared";

// Friendly prompts that get auto-classified into AgentKnowledge categories.
// Bowls-specific prompts (greens, drainage etc.) are only shown for BOWLS vertical.
const BOWLS_PROMPTS = [
  { key: "greens", category: "facility", title: "Anything unusual about your greens?", placeholder: "e.g. East green slopes 4° toward the pond; west green has thin turf in the centre." },
  { key: "pavilion", category: "facility", title: "Any quirks with the pavilion or pump house?", placeholder: "e.g. taps freeze under -3°C; the boiler is older and slow to restart." },
  { key: "events", category: "calendar", title: "Big events coming up the agents should plan around?", placeholder: "e.g. Open day 3rd Saturday in May; County match early June." },
  { key: "rules", category: "policy", title: "What's always urgent — drop everything if this happens?", placeholder: "e.g. Standing water on the green; vandalism; injuries during play." },
  { key: "calm", category: "policy", title: "What is NOT urgent, even if a member reports it?", placeholder: "e.g. Footprints on the green; minor litter; cosmetic flag wear." },
  { key: "local", category: "environment", title: "Anything about local weather, soil, or surroundings the agents should know?", placeholder: "e.g. Coastal: salt-laden wind; clay soil holds water for 2-3 days after rain." },
];

const GENERIC_PROMPTS = [
  { key: "facilities", category: "facility", title: "Any quirks with your facilities or premises?", placeholder: "e.g. Boiler slow to restart; roof leak in the east wing; car park floods after heavy rain." },
  { key: "events", category: "calendar", title: "Big events coming up the agents should plan around?", placeholder: "e.g. Annual AGM in March; fundraiser in June." },
  { key: "rules", category: "policy", title: "What's always urgent — drop everything if this happens?", placeholder: "e.g. Data breach; safeguarding concern; major building fault." },
  { key: "calm", category: "policy", title: "What is NOT urgent, even if a member reports it?", placeholder: "e.g. Minor cosmetic issues; routine supply requests." },
  { key: "local", category: "environment", title: "Anything about your operating environment the agents should know?", placeholder: "e.g. Mostly volunteers; seasonal activity peaks in spring/summer." },
];

export default function Chapter6Knowledge({ onAdvance, vertical }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const PROMPTS = vertical === "BOWLS" || !vertical ? BOWLS_PROMPTS : GENERIC_PROMPTS;

  const update = (key: string, val: string) => setAnswers((s) => ({ ...s, [key]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    for (const p of PROMPTS) {
      const content = answers[p.key]?.trim();
      if (!content) continue;
      await fetch("/api/agent/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "TENANT",
          category: p.category,
          title: p.title,
          content,
          priority: 5,
          source: "MANUAL",
        }),
      });
    }
    setBusy(false);
    await onAdvance();
  };

  return (
    <ChapterShell
      title={t("chapters.knowledge")}
      intro="Anything you tell us here helps the maintenance and triage agents make smarter calls. Skip any that don't apply."
      onSubmit={submit}
      busy={busy}
      canSkip
      onSkip={onAdvance}
    >
      {PROMPTS.map((p) => (
        <Field key={p.key} label={p.title}>
          <textarea
            className={inputClass + " min-h-[80px]"}
            placeholder={p.placeholder}
            value={answers[p.key] ?? ""}
            onChange={(e) => update(p.key, e.target.value)}
          />
        </Field>
      ))}
    </ChapterShell>
  );
}
