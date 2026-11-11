// Natural-language mandate -> validated rules (lib/mandate-parse) -> stored DRAFT mandate.
import { createMandate } from '@/lib/mandates';
import { MandateParseError, parseMandate } from '@/lib/mandate-parse';

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  try {
    const { rules, usage } = await parseMandate(text ?? '');
    const mandate = await createMandate(text!.trim(), rules);
    return Response.json({ mandate, usage });
  } catch (err) {
    if (err instanceof MandateParseError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
