import "server-only";

import { GoogleGenAI } from "@google/genai";

import {
  describeProviderError,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
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

  /** Gemini takes a single content list; roles are `user` and `model`. */
  private toContents(options: GenerateOptions) {
    return options.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
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

  async verify() {
    try {
      await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: "ok" }] }],
        config: { maxOutputTokens: 1 },
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: describeProviderError(error) };
    }
  }
}
