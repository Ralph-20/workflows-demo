import { z } from "zod";

/**
 * The "tool" behind tab 06. It is a fixed table rather than a live weather API
 * on purpose: this page is public, and a demo should not fall over because a
 * third-party endpoint rate-limited it. What the tab demonstrates is the
 * SHAPE — a tool call is its own named, retryable step — not the data source.
 */

export const CITIES = ["Lisbon", "Reykjavik", "Singapore", "Denver"] as const;

export type City = (typeof CITIES)[number];

/** zod-typed tool input. The model's chosen city is validated against this. */
export const forecastToolInput = z.object({
  city: z.enum(CITIES),
});

export type ForecastToolInput = z.infer<typeof forecastToolInput>;

export type Forecast = {
  tempC: number;
  summary: string;
  rainChance: number;
  windKph: number;
};

export const FORECASTS: Record<City, Forecast> = {
  Lisbon: { tempC: 24, summary: "Mostly sunny", rainChance: 10, windKph: 18 },
  Reykjavik: { tempC: 8, summary: "Overcast", rainChance: 70, windKph: 34 },
  Singapore: { tempC: 31, summary: "Thunderstorms", rainChance: 85, windKph: 12 },
  Denver: { tempC: 17, summary: "Clear and dry", rainChance: 5, windKph: 22 },
};

/** Coerces whatever the model said into a valid city, without throwing. */
export function coerceCity(raw: string): { city: City; corrected: boolean } {
  const cleaned = raw.trim().replace(/[^a-zA-Z ]/g, "");

  const parsed = forecastToolInput.safeParse({ city: cleaned });
  if (parsed.success) return { city: parsed.data.city, corrected: false };

  const loose = CITIES.find(
    (city) => city.toLowerCase() === cleaned.toLowerCase(),
  );
  if (loose) return { city: loose, corrected: false };

  const mentioned = CITIES.find((city) =>
    cleaned.toLowerCase().includes(city.toLowerCase()),
  );
  return { city: mentioned ?? "Lisbon", corrected: true };
}
