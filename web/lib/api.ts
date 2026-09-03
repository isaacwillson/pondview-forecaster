import type {
  ChatRequest,
  ChatResponse,
  ForecastResponse,
  HealthResponse,
  WhatIfRequest,
  WhatIfResponse,
} from "@/lib/types";

/** A typed error carrying the HTTP status (0 = never reached the server). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new ApiError("API URL is not configured (set NEXT_PUBLIC_API_URL).", 0);
  }
  return url.replace(/\/$/, "");
}

async function detailOf(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
    }
  } catch {
    /* body was not JSON */
  }
  return null;
}

export async function getForecast(
  day: string,
  signal?: AbortSignal,
): Promise<ForecastResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/forecast?day=${encodeURIComponent(day)}`, {
      signal,
    });
  } catch {
    throw new ApiError("Could not reach the forecast service.", 0);
  }
  if (!res.ok) {
    throw new ApiError((await detailOf(res)) ?? `Request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as ForecastResponse;
}

/** What the deployed model was trained and scored on. Used by the model card, which
 *  degrades to prose-without-figures if this fails -- a metrics panel is worth showing
 *  only when the metrics are the live ones. */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/health`, { signal });
  } catch {
    throw new ApiError("Could not reach the forecast service.", 0);
  }
  if (!res.ok) {
    throw new ApiError((await detailOf(res)) ?? `Request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as HealthResponse;
}

export async function postWhatIf(
  req: WhatIfRequest,
  signal?: AbortSignal,
): Promise<WhatIfResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/whatif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    throw new ApiError("Could not reach the forecast service.", 0);
  }
  if (!res.ok) {
    throw new ApiError((await detailOf(res)) ?? `Request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as WhatIfResponse;
}

export async function postChat(
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    throw new ApiError("Could not reach the forecast service.", 0);
  }
  if (!res.ok) {
    // 503 (assistant not configured) and 429 (asking too fast) are both states a
    // resident can meet, so the server's own wording is worth surfacing verbatim
    // rather than flattening every failure into "something went wrong".
    throw new ApiError((await detailOf(res)) ?? `Request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as ChatResponse;
}
