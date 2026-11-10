// Server-side configuration for the AG Studio AI assistant, which runs on Claude through
// app/api/ai/claude. The Anthropic key is read only on the server and never reaches the browser.

/** Claude models the assistant may use; the first is the default. */
export function aiModels(): string[] {
  return ['claude-opus-5-5'];
}

/** The assistant is shown only when an Anthropic key is configured. */
export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
