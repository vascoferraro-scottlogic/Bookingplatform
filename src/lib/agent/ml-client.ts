export interface NoShowPredictRequest {
  date: string;
  createdAt: string;
  userCreatedAt: string;
  timeSlot: string;
  isAllWeather: boolean;
  priorNoShowCount: number;
}

export interface NoShowPredictResponse {
  probability: number;
  modelVersion: string;
}

export class MlServiceError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "MlServiceError";
  }
}

function baseUrl(): string {
  return process.env.ML_SERVICE_URL ?? "http://localhost:8001";
}

export async function predictNoShow(
  req: NoShowPredictRequest,
  timeoutMs = 3000,
): Promise<NoShowPredictResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${baseUrl()}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new MlServiceError(
      `ML predict failed (${res.status})${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }

  const data = (await res.json()) as Partial<NoShowPredictResponse>;
  if (typeof data.probability !== "number" || typeof data.modelVersion !== "string") {
    throw new MlServiceError("ML predict returned an invalid response shape");
  }

  return {
    probability: Math.max(0, Math.min(1, data.probability)),
    modelVersion: data.modelVersion,
  };
}
