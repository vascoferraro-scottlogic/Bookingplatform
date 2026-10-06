import type { LLMCallParams, LLMCallResult, LLMProvider } from "@/lib/agent/llm-provider";
import { GeminiProvider } from "@/lib/agent/providers/gemini";

/**
 * Stub provider used when no API key is configured. Returns empty/inert
 * responses so the agent framework can still spin up locally without
 * silently calling a real LLM. Decisions made by the stub are flagged so
 * UI can display "agent not configured".
 */
class StubProvider implements LLMProvider {
  readonly name = "stub";
  async call(params: LLMCallParams): Promise<LLMCallResult> {
    if (params.responseSchema) {
      return { content: {}, model: "stub", usage: {} };
    }
    return { content: "", model: "stub", usage: {} };
  }
}

let cached: { name: string; provider: LLMProvider } | null = null;

/**
 * Resolve the active LLM provider. Reads `AGENT_LLM_PROVIDER` env var
 * (default "gemini"). Returns a stub when the configured provider can't be
 * instantiated (e.g. missing API key) so we don't crash dev environments.
 */
export function getProvider(name?: string): LLMProvider {
  const want = name ?? process.env.AGENT_LLM_PROVIDER ?? "gemini";
  if (cached && cached.name === want) return cached.provider;

  let provider: LLMProvider;
  try {
    switch (want) {
      case "gemini":
        provider = new GeminiProvider();
        break;
      case "stub":
        provider = new StubProvider();
        break;
      default:
        // eslint-disable-next-line no-console
        console.warn(`[agent] Unknown LLM provider "${want}", falling back to stub`);
        provider = new StubProvider();
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[agent] Failed to init provider "${want}":`, (e as Error).message, "— using stub");
    provider = new StubProvider();
  }

  cached = { name: want, provider };
  return provider;
}

/** Test hook — clears the cached provider so subsequent calls re-resolve. */
export function _resetProviderCache() {
  cached = null;
}
