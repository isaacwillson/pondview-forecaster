import type {
  ForecastResponse,
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
