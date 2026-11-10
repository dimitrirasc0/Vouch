// Server side of the AG Studio assistant on Claude. Translates AG Studio's LLM request into a Claude
// Messages request, streams Claude's output back as AG Studio events (SSE), and ends with the final
// AgLlmResponse. The Anthropic key never leaves the server.
import type Anthropic from '@anthropic-ai/sdk';
import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmRequest, AgLlmResponse } from 'ag-studio';
import { aiEnabled, aiModels } from '@/lib/ai';
import { claude } from '@/lib/claude';

export const maxDuration = 300;

type Json = Record<string, unknown>;
type Block = Anthropic.Beta.BetaContentBlockParam;
type Msg = { role: 'user' | 'assistant'; content: Block[] };

// AG Studio's schema library marks optional values as anyOf [..., { not: {} }]. Drop that sentinel.
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const s = { ...(schema as Json) };
  if (Array.isArray(s.anyOf)) {
    const kept = (s.anyOf as Json[]).filter((b) => !(b && typeof b === 'object' && Object.keys(b).length === 1 && b.not && typeof b.not === 'object' && !Object.keys(b.not as Json).length));
    if (kept.length === 1) {
      delete s.anyOf;
      Object.assign(s, kept[0]);
    } else s.anyOf = kept;
  }
  for (const [k, v] of Object.entries(s)) if (v && typeof v === 'object') s[k] = cleanSchema(v);
  return s;
}

// AG Studio conversation items -> Claude messages (consecutive same-role items are merged).
function toMessages(items: AgAiConversationItem[]): { system: string[]; messages: Msg[] } {
  const system: string[] = [];
  const messages: Msg[] = [];
  const push = (role: Msg['role'], block: Block) => {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const item of items) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
      if (item.role === 'system') system.push(text);
      else if (text) push('user', { type: 'text', text });
    } else if (item.type === 'message' && item.kind === 'output') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('\n');
      if (text) push('assistant', { type: 'text', text });
    } else if (item.type === 'function_call') {
      let input: unknown = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {}
      push('assistant', { type: 'tool_use', id: item.callId, name: item.name, input });
    } else if (item.type === 'function_call_output') {
      push('user', { type: 'tool_result', tool_use_id: item.callId, content: item.output || '(empty)' });
    }
    // Reasoning items from earlier turns are not replayed.
  }
  return { system, messages };
}

export async function POST(req: Request) {
  if (!aiEnabled()) return Response.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 503 });
  const request = (await req.json()) as AgLlmRequest;
  const { system, messages } = toMessages(request.input);

  // Opus 5.5 rejects forced tool choice, so "required"/named choices become an instruction.
  const instructions = [request.instructions ?? '', ...system];
  if (request.toolChoice === 'required') instructions.push('You must call one of the provided tools in this turn.');
  else if (request.toolChoice && typeof request.toolChoice === 'object') instructions.push(`You must call the tool "${request.toolChoice.name}" in this turn.`);

  const allowed = aiModels();
  const model = request.model?.id && allowed.includes(request.model.id) ? request.model.id : allowed[0];
  const effort = (['low', 'medium', 'high'] as const).find((e) => e === request.model?.effort) ?? 'low';

  const params: Anthropic.Beta.MessageCreateParamsStreaming = {
    model,
    max_tokens: 16000,
    stream: true,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: instructions.filter(Boolean).join('\n\n') || undefined,
    messages,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: {
      effort,
      ...(request.responseFormat?.type === 'json' && {
        format: { type: 'json_schema', schema: cleanSchema(request.responseFormat.schema) as Json },
      }),
    },
    ...(request.tools?.length && request.toolChoice !== 'none'
      ? {
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: cleanSchema(t.parameters) as Anthropic.Beta.BetaTool.InputSchema,
          })),
        }
      : {}),
  };

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (frame: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      const emit = (event: AgAiEvent) => send({ event });
      try {
        const stream = claude().beta.messages.stream(params, { signal: req.signal });
        let msgId = 'msg';
        const blocks = new Map<number, { kind: 'text' | 'thinking' | 'tool'; id: string }>();
        for await (const ev of stream) {
          if (ev.type === 'message_start') msgId = ev.message.id;
          else if (ev.type === 'content_block_start') {
            const b = ev.content_block;
            const id = `${msgId}_${ev.index}`;
            if (b.type === 'text') {
              blocks.set(ev.index, { kind: 'text', id });
              emit({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' } as AgAiEvent);
            } else if (b.type === 'thinking') {
              blocks.set(ev.index, { kind: 'thinking', id });
              emit({ type: 'REASONING_MESSAGE_START', messageId: id, role: 'reasoning' } as AgAiEvent);
            } else if (b.type === 'tool_use') {
              blocks.set(ev.index, { kind: 'tool', id: b.id });
              emit({ type: 'TOOL_CALL_START', toolCallId: b.id, toolCallName: b.name } as AgAiEvent);
            }
          } else if (ev.type === 'content_block_delta') {
            const b = blocks.get(ev.index);
            if (!b) continue;
            if (ev.delta.type === 'text_delta') emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: b.id, delta: ev.delta.text } as AgAiEvent);
            else if (ev.delta.type === 'thinking_delta') emit({ type: 'REASONING_MESSAGE_CONTENT', messageId: b.id, delta: ev.delta.thinking } as AgAiEvent);
            else if (ev.delta.type === 'input_json_delta') emit({ type: 'TOOL_CALL_ARGS', toolCallId: b.id, delta: ev.delta.partial_json } as AgAiEvent);
          } else if (ev.type === 'content_block_stop') {
            const b = blocks.get(ev.index);
            if (b?.kind === 'text') emit({ type: 'TEXT_MESSAGE_END', messageId: b.id } as AgAiEvent);
            else if (b?.kind === 'thinking') emit({ type: 'REASONING_MESSAGE_END', messageId: b.id } as AgAiEvent);
            else if (b?.kind === 'tool') emit({ type: 'TOOL_CALL_END', toolCallId: b.id } as AgAiEvent);
          }
        }

        const final = await stream.finalMessage();
        const output: AgAiOutputItem[] = [];
        final.content.forEach((b, i) => {
          const id = `${final.id}_${i}`;
          if (b.type === 'text') output.push({ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: b.text, annotations: [] }] });
          else if (b.type === 'thinking' && b.thinking) output.push({ id, kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: b.thinking }] });
          else if (b.type === 'tool_use') output.push({ id: b.id, kind: 'output', type: 'function_call', callId: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}), status: 'completed' });
        });
        const response: AgLlmResponse = {
          id: final.id,
          createdAt: Math.floor(Date.now() / 1000),
          model: final.model,
          output,
          status: final.stop_reason === 'max_tokens' ? 'incomplete' : 'completed',
          ...(final.stop_reason === 'max_tokens' && { incompleteDetails: { reason: 'max_output_tokens' as const } }),
          ...(final.stop_reason === 'refusal' && { error: { code: 'refusal', message: 'Claude declined this request.' } }),
          usage: {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            totalTokens: final.usage.input_tokens + final.usage.output_tokens,
            cachedInputTokens: final.usage.cache_read_input_tokens ?? undefined,
          },
        };
        send({ response });
      } catch (err) {
        send({ error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } });
}
