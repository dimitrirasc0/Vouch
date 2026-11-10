// Runs the dispute agent for one dispute and stores its recommendation (no money moves here).
import { runDisputeAgent } from '@/lib/agent/dispute';

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<'/api/agent/dispute/[id]'>) {
  const { id } = await ctx.params;
  try {
    return Response.json(await runDisputeAgent(id));
  } catch (err) {
    console.error('[dispute-agent]', err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
