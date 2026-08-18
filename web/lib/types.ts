// Typed models for the API contract. Kept in lockstep with api/main.py.

export type Basis = "forecast" | "typical" | "closed";

export interface HourPrediction {
  hour: number;
  predicted: number;
  low: number;
  high: number;
}

export interface ForecastResponse {
  basis: Basis;
  day: string;
  is_weekend: boolean;
  unit: string;
  open_hours: number[] | null;
  /** Present for basis "forecast" and "typical"; absent for "closed". */
  predictions?: HourPrediction[];
  /** Present for basis "closed". */
  message?: string;
}

export interface TempRange {
  min: number;
  max: number;
}

export interface WhatIfRequest {
  is_weekend: boolean;
  temperature: number;
  precipitation: boolean;
}

export interface WhatIfResponse {
  conditions: {
    is_weekend: boolean;
    temperature: number;
    precipitation: boolean;
    assumed: Record<string, number>;
  };
  temp_range: TempRange;
  extrapolating: boolean;
  unit: string;
  predictions: HourPrediction[];
}

/** One prior turn sent back to /chat. Text only -- the server never accepts tool
 *  blocks from the browser, so a reply can't be built on a forged tool result. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  history: ChatTurn[];
}

export interface ChatResponse {
  answer: string;
  tools_used: string[];
  /** Which bases the answer rests on. Empty for what-if answers and refusals. */
  basis: Basis[];
  unit: string;
}
