import "server-only";

import OpenAI from "openai";

import {
  describeProviderError,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
} from "./provider";

/**
 * OpenAI adapter, via the official SDK's Responses API — the current surface,
 * and the one that carries system guidance as `instructions`.
 */
export class OpenAiProvider implements AiProvider {
  readonly id = "OPENAI" as const;

  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const model = options.model ?? this.model;
    const response = await this.client.responses.create(
      {
        model,
        ...(options.system ? { instructions: options.system } : {}),
        input: options.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_output_tokens: options.maxTokens ?? 4096,
      },
      { signal: options.signal },
    );

    return {
      text: response.output_text ?? "",
      model,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<string> {
    const stream = await this.client.responses.create(
      {
        model: options.model ?? this.model,
        ...(options.system ? { instructions: options.system } : {}),
        input: options.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_output_tokens: options.maxTokens ?? 4096,
        stream: true,
      },
      { signal: options.signal },
    );

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") yield event.delta;
    }
  }

  async verify() {
    try {
      await this.client.responses.create({
        model: this.model,
        input: "ok",
        max_output_tokens: 16,
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describeProviderError(error) };
    }
  }
}
