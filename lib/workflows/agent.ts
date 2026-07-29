import { generateText } from "ai";
import { getWritable } from "workflow";
import type { AgentChunk } from "@/lib/chunks";
import { coerceCity, CITIES, FORECASTS, type City } from "@/lib/forecast";
import { mockAnswer, mockPlanCity } from "@/lib/mock";

/**
 * Tab 06 — agents on workflows.
 *
 * An agent turn expressed as a workflow. Every model call and every tool call
 * is its own `'use step'` function with a DESCRIPTIVE name, which is what makes
 * the observability dashboard readable: the trace says `planForecastLookup` and
 * `fetchForecast`, not `step1` and `step2`. Each is independently retryable, so
 * a flaky model call retries without re-running the tool.
 *
 * Steps are the agent loop. There is no separate agent runtime here.
 */

const MODEL_ID = "anthropic/claude-sonnet-4.6";

async function emit(
  writable: WritableStream<AgentChunk>,
  chunk: AgentChunk,
): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(chunk);
  } finally {
    writer.releaseLock();
  }
}

async function markStart(): Promise<number> {
  "use step";
  return Date.now();
}

/** Model call #1: decide which city the question is about. */
async function planForecastLookup(
  question: string,
  mock: boolean,
): Promise<{ city: City; corrected: boolean }> {
  "use step";

  const writable = getWritable<AgentChunk>();
  const startedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "running",
    name: "planForecastLookup",
    role: "model",
    at: startedAt,
  });

  let chosen: string;
  if (mock) {
    chosen = mockPlanCity(question);
  } else {
    const { text } = await generateText({
      model: MODEL_ID,
      prompt: `Which of these cities is this question about? Reply with the city name and nothing else.\n\nCities: ${CITIES.join(", ")}\n\nQuestion: ${question}`,
      maxOutputTokens: 16,
    });
    chosen = text;
  }

  // The model returns free text, so the choice is validated against the
  // zod-typed tool input before the tool is allowed to run.
  const result = coerceCity(chosen);

  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name: "planForecastLookup",
    role: "model",
    at: completedAt,
    durationMs: completedAt - startedAt,
    detail: result.corrected
      ? `picked ${result.city} (model returned something off-list, coerced by the zod schema)`
      : `picked ${result.city}`,
  });

  return result;
}

/** Tool call: its own step, so a retry re-runs only the lookup. */
async function fetchForecast(city: City): Promise<string> {
  "use step";

  const writable = getWritable<AgentChunk>();
  const startedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "running",
    name: "fetchForecast",
    role: "tool",
    at: startedAt,
  });

  await new Promise((resolve) => setTimeout(resolve, 400));

  const forecast = FORECASTS[city];
  const payload = `${forecast.tempC}C, ${forecast.summary}, ${forecast.rainChance}% rain, ${forecast.windKph} km/h wind`;

  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name: "fetchForecast",
    role: "tool",
    at: completedAt,
    durationMs: completedAt - startedAt,
    detail: payload,
  });

  return payload;
}

/** Model call #2: turn the tool result into an answer. */
async function composeAnswer(
  question: string,
  city: City,
  forecast: string,
  mock: boolean,
): Promise<string> {
  "use step";

  const writable = getWritable<AgentChunk>();
  const startedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "running",
    name: "composeAnswer",
    role: "model",
    at: startedAt,
  });

  const answer = mock
    ? mockAnswer(city)
    : (
        await generateText({
          model: MODEL_ID,
          prompt: `Answer the question in two sentences, using only the forecast data provided.\n\nQuestion: ${question}\nCity: ${city}\nForecast: ${forecast}`,
          maxOutputTokens: 160,
        })
      ).text;

  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name: "composeAnswer",
    role: "model",
    at: completedAt,
    durationMs: completedAt - startedAt,
  });

  await emit(writable, { kind: "answer", at: completedAt, text: answer });

  return answer;
}

async function finishRun(
  startedAt: number,
  mock: boolean,
  city: City,
): Promise<void> {
  "use step";

  const writable = getWritable<AgentChunk>();
  const completedAt = Date.now();

  await emit(writable, {
    kind: "run",
    phase: "completed",
    at: completedAt,
    totalMs: completedAt - startedAt,
    mock,
    city,
  });

  await writable.close();
}

export async function agentTurn(
  question: string,
  mock: boolean,
): Promise<{ answer: string; city: City }> {
  "use workflow";

  const startedAt = await markStart();

  const plan = await planForecastLookup(question, mock);
  const forecast = await fetchForecast(plan.city);
  const answer = await composeAnswer(question, plan.city, forecast, mock);

  await finishRun(startedAt, mock, plan.city);

  return { answer, city: plan.city };
}
