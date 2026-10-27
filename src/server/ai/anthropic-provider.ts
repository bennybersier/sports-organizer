import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  describeProviderError,
  type AiMessage,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
  VERIFY_TIMEOUT_MS,
} from "./provider";

/**
 * Anthropic adapter, via the official SDK.
 *
 * `response.content` is a discriminated union, so text is collected by
 * narrowing on `type` rather than indexing — indexing breaks the moment a
 * thinking block leads the response.
 */
export class AnthropicProvider implements AiProvider {
  readonly id = "ANTHROPIC" as const;

  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * A message's content, as blocks when it carries pictures.
   *
   * Plain string when it does not: the API accepts both, and leaving existing
   * text-only calls byte-identical means nothing about them can change here.
   * Images lead, because a model reads the instruction better when it already
   * has the thing the instruction is about.
   */
  private toContent(message: AiMessage): Anthropic.MessageParam["content"] {
    if (!message.images?.length) return message.content;
    return [
      ...message.images.map(
        (image): Anthropic.ImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.data },
        }),
      ),
      { type: "text", text: message.content },
    ];
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const response = await this.client.messages.create(
      {
        model: options.model ?? this.model,
        max_tokens: options.maxTokens ?? 4096,
        ...(options.system ? { system: options.system } : {}),
        messages: options.messages.map((message) => ({
          role: message.role,
          content: this.toContent(message),
        })),
      },
      { signal: options.signal },
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: options.model ?? this.model,
        max_tokens: options.maxTokens ?? 4096,
        ...(options.system ? { system: options.system } : {}),
        messages: options.messages.map((message) => ({
          role: message.role,
          content: this.toContent(message),
        })),
      },
      { signal: options.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }

  async verify() {
    try {
      // One token is enough to prove the key and model are usable. The
      // deadline matters more than the token: somebody is watching a spinner,
      // and the SDK's own timeout is measured in minutes.
      await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ok" }],
        },
        { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) },
      );
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describeProviderError(error) };
    }
  }
}
