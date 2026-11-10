// AG Studio LLM adapter for Claude. Runs in the browser: it posts AG Studio's request to this app's
// /api/ai/claude route (which holds the Anthropic key and talks to Claude) and replays the SSE
// stream of AG Studio events that route sends back. The route also sends the final response.
import type { AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from 'ag-studio';

type Frame = { event: AgAiEvent } | { response: AgLlmResponse } | { error: string };

function runRequest(endpoint: string, request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
  let resolveComplete!: (r: AgLlmResponse) => void;
  let rejectComplete!: (e: Error) => void;
  const complete = new Promise<AgLlmResponse>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  void complete.catch(() => {});

  async function* events(): AsyncIterableIterator<AgAiEvent> {
    let response: AgLlmResponse | undefined;
    let error: Error | undefined;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`Assistant request failed: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          const frame = JSON.parse(chunk.slice(6)) as Frame;
          if ('event' in frame) yield frame.event;
          else if ('response' in frame) response = frame.response;
          else error = new Error(frame.error);
        }
      }
    } catch (err) {
      error ??= err instanceof Error ? err : new Error(String(err));
    }
    if (error) rejectComplete(error);
    else if (response) resolveComplete(response);
    else rejectComplete(new Error('Stream ended without a final response.'));
  }

  const iterator = events();
  return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
}

export function claudeAdapter({ endpoint = '/api/ai/claude' }: { endpoint?: string } = {}): AgLlmAdapter {
  return { executeTurn: (request, options) => runRequest(endpoint, request, options?.signal) };
}
