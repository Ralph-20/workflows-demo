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
