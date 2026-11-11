// Remote MCP endpoint (Streamable HTTP, stateless). Auth: MCP_API_KEY as `Authorization: Bearer <key>`,
// or `?key=<key>` for clients that can't set headers. Optional `?client=<name>` labels the caller in
// the decision trail when the client doesn't send a recognisable User-Agent.
import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createVouchMcpServer } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request, url: URL): boolean {
  const expected = process.env.MCP_API_KEY?.trim();
  if (!expected) return false;
  const header = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const given = header ?? url.searchParams.get('key')?.trim() ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicOrigin(req: Request, url: URL): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0] ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Best-effort name of the calling app, e.g. "Claude-User" -> "Claude".
function clientName(req: Request, url: URL): string | null {
  const named = url.searchParams.get('client')?.trim();
  if (named) return named.slice(0, 60);
  const ua = req.headers.get('user-agent') ?? '';
  const known = ua.match(/claude|chatgpt|openai|cursor|mcp-inspector|vscode|windsurf|goose/i)?.[0];
  if (known) return { claude: 'Claude', chatgpt: 'ChatGPT', openai: 'ChatGPT', cursor: 'Cursor', 'mcp-inspector': 'MCP Inspector', vscode: 'VS Code', windsurf: 'Windsurf', goose: 'Goose' }[known.toLowerCase()] ?? known;
  return ua ? ua.split(/[\s/]/)[0].slice(0, 60) || null : null;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!process.env.MCP_API_KEY?.trim()) return Response.json({ error: 'MCP server is not configured (MCP_API_KEY unset)' }, { status: 503 });
  if (!authorized(req, url))
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: send the Vouch MCP key as Authorization: Bearer <key> or ?key=<key>' }, id: null },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="vouch-mcp"' } },
    );

  // Stateless: a fresh server and transport per request, so it works on any number of instances.
  const server = createVouchMcpServer({ baseUrl: publicOrigin(req, url), client: clientName(req, url) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON responses are complete once handleRequest resolves.
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
