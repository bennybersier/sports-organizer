import "server-only";

import { GoogleGenAI } from "@google/genai";

import {
  describeProviderError,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
  VERIFY_TIMEOUT_MS,
} from "./provider";

/** Google Gemini adapter, via the official SDK. */
export class GeminiProvider implements AiProvider {
  readonly id = "GEMINI" as const;

  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Gemini takes a single content list; roles are `user` and `model`.
   *
   * Pictures are `inlineData` parts and come before the text, so the model has
   * the thing in front of it before being told what to do with it.
   */
  private toContents(options: GenerateOptions) {
    return options.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        ...(message.images ?? []).map((image) => ({
          inlineData: { mimeType: image.mediaType, data: image.data },
        })),
        { text: message.content },
      ],
    }));
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const model = options.model ?? this.model;
    const response = await this.client.models.generateContent({
      model,
      contents: this.toContents(options),
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        maxOutputTokens: options.maxTokens ?? 4096,
        abortSignal: options.signal,
      },
    });

    return {
      text: response.text ?? "",
      model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<string> {
    const stream = await this.client.models.generateContentStream({
      model: options.model ?? this.model,
      contents: this.toContents(options),
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        maxOutputTokens: options.maxTokens ?? 4096,
        abortSignal: options.signal,
      },
    });

    for await (const chunk of stream) {
      if (chunk.text) yield chunk.text;
    }
  }

  /**
   * Counts the tokens in one word, rather than generating anything.
   *
   * It proves the same two things a generation would — the key is accepted and
   * the model name exists — and it proves them in a round trip instead of a
   * wait. The previous version asked `gemini-2.5-pro` to generate with
   * `maxOutputTokens: 1`, which is close to the worst request you can make of
   * a model that thinks before it answers: the cap applies to the reply, the
   * thinking happens first regardless, and the caller sits through all of it to
   * be told a key works. That is the spinner nobody could explain.
   *
   * The deadline is still here, because a slow provider must fail as a slow
   * provider rather than as a hang.
   */
  async verify() {
    try {
      await this.client.models.countTokens({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: "ok" }] }],
        config: { abortSignal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) },
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describeProviderError(error) };
    }
  }
}
