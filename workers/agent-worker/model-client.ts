import {
  JsonModelClient,
  type RawCompletionClient,
} from "@repo/agent/model";

interface OpenAIWorkerConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  reasoningEffort: "low" | "medium" | "high";
  timeoutMs: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be set before starting the worker.`);
  }

  return value;
}

function parsePositiveInteger(
  rawValue: string | undefined,
  fallbackValue: number,
  envName: string,
): number {
  if (!rawValue) {
    return fallbackValue;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer. Received: ${rawValue}`);
  }

  return parsed;
}

function parseReasoningEffort(
  rawValue: string | undefined,
): "low" | "medium" | "high" {
  if (!rawValue) {
    return "medium";
  }

  if (rawValue === "low" || rawValue === "medium" || rawValue === "high") {
    return rawValue;
  }

  throw new Error(
    `OPENAI_REASONING_EFFORT must be one of "low", "medium", or "high". Received: ${rawValue}`,
  );
}

function getOpenAIWorkerConfig(): OpenAIWorkerConfig {
  return {
    apiKey: getRequiredEnv("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
    baseUrl: (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    ),
    reasoningEffort: parseReasoningEffort(process.env.OPENAI_REASONING_EFFORT),
    timeoutMs: parsePositiveInteger(
      process.env.OPENAI_TIMEOUT_MS,
      120_000,
      "OPENAI_TIMEOUT_MS",
    ),
  };
}

function getErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (
    isObject(payload) &&
    isObject(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return fallbackMessage;
}

function extractOutputText(payload: unknown): string {
  if (isObject(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (
    isObject(payload) &&
    Array.isArray(payload.output)
  ) {
    for (const item of payload.output) {
      if (
        isObject(item) &&
        Array.isArray(item.content)
      ) {
        for (const contentPart of item.content) {
          if (
            isObject(contentPart) &&
            contentPart.type === "output_text" &&
            typeof contentPart.text === "string"
          ) {
            return contentPart.text;
          }
        }
      }
    }
  }

  throw new Error("OpenAI response did not contain output text.");
}

const AGENT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "rootCause",
    "planSummary",
    "patchSummary",
    "edits",
    "commandsToRun",
  ],
  properties: {
    rootCause: {
      type: "string",
    },
    planSummary: {
      type: "string",
    },
    patchSummary: {
      type: "string",
    },
    edits: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "search", "replace"],
        properties: {
          path: { type: "string" },
          search: { type: "string" },
          replace: { type: "string" },
        },
      },
    },
    commandsToRun: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
} as const;

class OpenAIResponsesCompletionClient implements RawCompletionClient {
  constructor(private readonly config: OpenAIWorkerConfig) {}

  async complete(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          instructions: input.systemPrompt,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: input.userPrompt,
                },
              ],
            },
          ],
          reasoning: {
            effort: this.config.reasoningEffort,
          },
          max_output_tokens: 4_000,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "agent_plan",
              strict: true,
              schema: AGENT_PLAN_JSON_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            payload,
            `OpenAI Responses API request failed with HTTP ${response.status}.`,
          ),
        );
      }

      return extractOutputText(payload);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `OpenAI Responses API request timed out after ${this.config.timeoutMs}ms.`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createModelClient() {
  return new JsonModelClient(
    new OpenAIResponsesCompletionClient(getOpenAIWorkerConfig()),
  );
}
