import "server-only";

import OpenAI from "openai";

import {
  describeProviderError,
  type AiMessage,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
  VERIFY_TIMEOUT_MS,
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

  /**
   * One turn of `input`, with pictures as content parts when it has any.
   *
   * The Responses API wants a `data:` URL rather than raw base64, and it
   * distinguishes input from output text — `input_text` here, not `text`, which
   * is the mistake that costs an afternoon.
   */
  private toInput(message: AiMessage) {
    if (!message.images?.length) {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: [
        ...message.images.map((image) => ({
          type: "input_image" as const,
          image_url: `data:${image.mediaType};base64,${image.data}`,
          detail: "high" as const,
        })),
        { type: "input_text" as const, text: message.content },
      ],
    };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const model = options.model ?? this.model;
    const response = await this.client.responses.create(
      {
        model,
        ...(options.system ? { instructions: options.system } : {}),
        input: options.messages.map((message) => this.toInput(message)),
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
        input: options.messages.map((message) => this.toInput(message)),
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
      await this.client.responses.create(
        { model: this.model, input: "ok", max_output_tokens: 16 },
        { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) },
      );
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describeProviderError(error) };
    }
  }
}
