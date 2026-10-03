import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGoogle } from "@langchain/google";
import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MESSAGE_LENGTH = 12_000;

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null || !("role" in value) || !("content" in value)) {
    return false;
  }

  return (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.trim().length > 0 &&
    value.content.length <= MAX_MESSAGE_LENGTH
  );
}

function isChatRequest(value: unknown): value is { messages: ChatMessage[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "messages" in value &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.every(isChatMessage)
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && typeof error.status === "number") return error.status;
  if ("code" in error && typeof error.code === "number") return error.code;
  return undefined;
}

function getVisibleText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (typeof block !== "object" || block === null) return "";
      if ("thought" in block && block.thought === true) return "";
      if ("type" in block && block.type === "reasoning") return "";
      return "text" in block && typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isChatRequest(body)) {
    return NextResponse.json(
      { error: "Send at least one valid message to continue." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The chat service is not configured. Add your Google AI Studio key as GOOGLE_API_KEY in .env." },
      { status: 503 },
    );
  }

  const chat = new ChatGoogle({
    apiKey,
    model: process.env.GOOGLE_MODEL || "gemini-3.8-flash",
    temperature: 0.7,
  });

  const messages = [
    new SystemMessage(
      "You are Kindred, a thoughtful and friendly AI companion. Be clear, warm, and useful. Give only the polished final answer; never include internal reasoning, analysis, or draft options. Answer directly in a few sentences by default and give more detail when the user asks.",
    ),
    ...body.messages.map((message) =>
      message.role === "user"
        ? new HumanMessage(message.content)
        : new AIMessage(message.content),
    ),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: { token?: string; error?: string; done?: boolean }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const chunks = await chat.stream(messages);
        let hasText = false;

        for await (const chunk of chunks) {
          const text = getVisibleText(chunk.content);

          if (text) {
            hasText = true;
            send({ token: text });
          }
        }

        if (!hasText) {
          send({ error: "The model returned an empty response. Please try again." });
        } else {
          send({ done: true });
        }
      } catch (error) {
        const status = getErrorStatus(error);
        const message = error instanceof Error ? error.message : "Unknown provider error";
        console.error("Google AI chat request failed:", { status, message });

        if (status === 429 || /quota|rate.?limit|resource_exhausted/i.test(message)) {
          send({
            error:
              "This Google AI Studio key has reached its Gemini API quota. Check usage and limits at https://ai.google.dev/gemini-api/docs/rate-limits, then retry when the quota resets or enable billing if available.",
          });
        } else if (status === 401 || status === 403) {
          send({
            error:
              "Google rejected the API key. Check that GOOGLE_API_KEY in .env is a valid Google AI Studio key with the Gemini API enabled.",
          });
        } else if (/model .* (not found|not available)|not supported for generatecontent/i.test(message)) {
          send({
            error:
              "This model isn't available through the direct Google AI Studio API. Choose a Gemini model in .env, or use OpenRouter for Gemma 4 31B.",
          });
        } else {
          send({ error: "The model could not answer right now. Please try again shortly." });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
