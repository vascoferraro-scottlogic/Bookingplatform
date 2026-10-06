/**
 * Generic LLM provider interface.
 *
 * Each agent constructs its own system + user prompts. The provider just makes
 * the call and parses the response. Keeps providers swappable without agents
 * needing to care about which LLM is in play.
 */

export interface LLMCallParams {
  systemPrompt: string;
  userPrompt: string;
  /**
   * JSON schema describing the expected response shape. When provided, the
   * provider should request structured JSON output and parse before returning.
   */
  responseSchema?: object;
  /** Optional temperature override (0-1). Lower = more deterministic. */
  temperature?: number;
  /** Optional max output tokens. */
  maxTokens?: number;
}

export interface LLMCallResult {
  /** Parsed JSON response when responseSchema was supplied; raw text otherwise. */
  content: unknown;
  /** Provider-reported token usage for cost / rate-limit accounting. */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  /** Identifier of the underlying model used (e.g. "gemini-1.5-flash"). */
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  call(params: LLMCallParams): Promise<LLMCallResult>;
}

export class LLMRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMRateLimitError";
  }
}

export class LLMProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LLMProviderError";
  }
}
