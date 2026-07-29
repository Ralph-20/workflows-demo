import { FORECASTS, type City } from "@/lib/forecast";

/**
 * Mock scope is deliberately narrow: only the MODEL CALLS on tab 06 are faked,
 * and only when no gateway key is configured. The workflow around them still
 * runs for real — real steps, real event log, real retries. The UI shows a MOCK
 * badge whenever this is in play, so nothing on the page is quietly simulated.
 */

export function isMockMode(): boolean {
  return !process.env.AI_GATEWAY_API_KEY;
}

/**
 * A canned string comes back instantly, which would make a mock agent turn
 * finish faster than anyone can press Stop — and the Stop button is one of the
 * things this tab exists to demonstrate. So the mock model calls spend roughly
 * as long as a real one would.
 *
 * This is latency, not fabricated data: the answer is still deterministic and
 * the UI still shows the MOCK badge.
 */
export const MOCK_MODEL_LATENCY_MS = 1_200;

export function mockModelLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_MODEL_LATENCY_MS));
}

/** Stands in for the planning model call: picks a city out of the question. */
export function mockPlanCity(question: string): City {
  const asked = question.toLowerCase();
  const match = (Object.keys(FORECASTS) as City[]).find((city) =>
    asked.includes(city.toLowerCase()),
  );
  return match ?? "Lisbon";
}

/** Stands in for the answering model call: deterministic prose from real data. */
export function mockAnswer(city: City): string {
  const forecast = FORECASTS[city];
  const verdict =
    forecast.rainChance >= 50
      ? "Worth taking something waterproof"
      : "You can leave the umbrella at home";

  return `${city} is sitting at ${forecast.tempC}°C with ${forecast.summary.toLowerCase()} and a ${forecast.rainChance}% chance of rain. ${verdict}, and wind is around ${forecast.windKph} km/h.`;
}
