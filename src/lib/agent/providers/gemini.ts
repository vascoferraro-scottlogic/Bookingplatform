import {
  LLMCallParams,
  LLMCallResult,
  LLMProvider,
  LLMProviderError,
  LLMRateLimitError,
} from "@/lib/agent/llm-provider";

/**
 * Google Gemini provider. Uses the REST API directly so we don't pull in the
 * official SDK (keeps dependency footprint small and avoids version churn).
 *
 * Free tier (gemini-1.5-flash): ~15 RPM, 1500 req/day. Plenty for batched
 * agent runs in dev / training environments.
 *
 * Env:
 *   AGENT_GEMINI_API_KEY   — required
 *   AGENT_GEMINI_MODEL     — optional, defaults to "gemini-1.5-flash"
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey ?? process.env.AGENT_GEMINI_API_KEY ?? "";
    this.model = model ?? process.env.AGENT_GEMINI_MODEL ?? "gemini-1.5-flash";
    if (!this.apiKey) {
      throw new LLMProviderError(
        "Gemini provider requires AGENT_GEMINI_API_KEY env var",
      );
    }
  }

  async call(params: LLMCallParams): Promise<LLMCallResult> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const generationConfig: Record<string, unknown> = {
      temperature: params.temperature ?? 0.3,
      maxOutputTokens: params.maxTokens ?? 2048,
    };
    if (params.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = params.responseSchema;
    }

    const body = {
      systemInstruction: {
        role: "system",
        parts: [{ text: params.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: params.userPrompt }],
        },
      ],
      generationConfig,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new LLMProviderError("Network error calling Gemini", e);
    }

    if (res.status === 429) {
      throw new LLMRateLimitError("Gemini rate limit exceeded");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMProviderError(`Gemini ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      throw new LLMProviderError("Gemini returned no text content");
    }

    let content: unknown = text;
    if (params.responseSchema) {
      try {
        content = JSON.parse(text);
      } catch (e) {
        throw new LLMProviderError("Gemini returned non-JSON for structured request", e);
      }
    }

    return {
      content,
      model: this.model,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount,
        completionTokens: json.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
