import { NextResponse } from "next/server";

import { isAppError } from "@/lib/errors";
import { extractApiKey, resolveMcpIdentity } from "@/server/mcp/auth";
import { TOOLS_BY_NAME, runTool, toolsFor } from "@/server/mcp/tools";

/**
 * The MCP endpoint.
 *
 * JSON-RPC 2.0 over HTTP POST, which is what MCP's streamable-HTTP transport
 * reduces to for a stateless server. Implemented directly rather than through
 * the SDK's transport adapter, which expects Node's `IncomingMessage` and does
 * not fit a Web-standard Route Handler; the protocol shapes below follow the
 * MCP specification, and the version string is the one the current SDK reports.
 *
 * Stateless on purpose: there is no session to resume, so a request carries its
 * own authentication and nothing is held between calls. That also means it
 * scales the same way the rest of the app does.
 */

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "sport-club-organizer",
  title: "Sport Club Organizer",
  version: "0.1.0",
};

/** JSON-RPC error codes, per the specification. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: string | number | null | undefined, value: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result: value });
}

function failure(
  id: string | number | null | undefined,
  code: number,
  message: string,
  status = 200,
) {
  // JSON-RPC errors ride in the body with HTTP 200; only transport-level
  // problems — bad auth, unparseable body — use an HTTP status.
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status },
  );
}

export async function POST(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return failure(null, PARSE_ERROR, "Request body is not valid JSON.", 400);
  }

  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return failure(body?.id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.", 400);
  }

  const { id, method, params = {} } = body;

  /*
    Every method needs authentication, including `initialize` — an unauthenticated
    caller should learn nothing about a club, not even that it exists.
  */
  const rawKey = extractApiKey(request);
  if (!rawKey) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: id ?? null, error: { code: INVALID_REQUEST, message: "Missing API key." } },
      // The header a compliant client looks for when it needs to authenticate.
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="mcp"' } },
    );
  }

  let identity;
  try {
    identity = await resolveMcpIdentity(rawKey);
  } catch (error) {
    const message = isAppError(error) ? error.userMessage : "Authentication failed.";
    return NextResponse.json(
      { jsonrpc: "2.0", id: id ?? null, error: { code: INVALID_REQUEST, message } },
      { status: 401 },
    );
  }

  const { context, requestedScopes } = identity;

  switch (method) {
    case "initialize": {
      const requested = String((params as { protocolVersion?: string }).protocolVersion ?? "");
      // Meet the client where it is when we can; otherwise state our version
      // and let it decide, which is what the specification asks for.
      const negotiated = SUPPORTED_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION;

      return result(id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          `You are connected to ${context.tenant.name} as ${context.user.email}. ` +
          "Scheduling decisions are made by a deterministic engine: use check_placement " +
          "to find out whether a slot is valid, and do not assert validity yourself. " +
          "generate_schedule produces a draft; publishing is a separate step.",
      });
    }

    // Notifications carry no id and expect no result.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: toolsFor(context, requestedScopes).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const { name, arguments: args = {} } = params as {
        name?: string;
        arguments?: Record<string, unknown>;
      };

      const tool = name ? TOOLS_BY_NAME.get(name) : undefined;
      if (!tool) return failure(id, INVALID_PARAMS, `No such tool: ${name ?? "(unnamed)"}`);

      // Availability is re-derived rather than trusted from tools/list: a client
      // may call anything, so the gate has to be here too.
      const permitted = toolsFor(context, requestedScopes).some((t) => t.name === tool.name);
      if (!permitted) {
        return result(id, {
          isError: true,
          content: [
            {
              type: "text",
              text: `This API key is not permitted to use ${tool.name}. It needs the ${tool.permission} scope, and the account it belongs to must hold that permission.`,
            },
          ],
        });
      }

      const outcome = await runTool(tool, context, args);

      // MCP reports tool failures as results with isError, not as protocol
      // errors — the model needs to read the reason and adjust.
      return result(id, {
        isError: !outcome.ok,
        content: [
          {
            type: "text",
            text: outcome.ok
              ? JSON.stringify(outcome.data, null, 2)
              : outcome.message,
          },
        ],
        ...(outcome.ok ? { structuredContent: outcome.data } : {}),
      });
    }

    default:
      return failure(id, METHOD_NOT_FOUND, `Unsupported method: ${method}`);
  }
}

/** A bare GET is how some clients probe the endpoint. */
export async function GET() {
  return NextResponse.json(
    {
      name: SERVER_INFO.name,
      protocolVersion: PROTOCOL_VERSION,
      transport: "http",
      authentication: "Bearer token in the Authorization header, or X-API-Key.",
    },
    { status: 200 },
  );
}

export const dynamic = "force-dynamic";
