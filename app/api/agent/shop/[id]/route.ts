// Runs the shopping agent for an approved mandate. `overstep: true` is the labelled demo switch.
import { runShopper } from '@/lib/agent/shopper';

export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<'/api/agent/shop/[id]'>) {
  const { id } = await ctx.params;
  const { overstep } = (await req.json().catch(() => ({}))) as { overstep?: boolean };
  try {
    return Response.json(await runShopper(id, { overstep: overstep === true }));
  } catch (err) {
    console.error('[shopper]', (err as Error).message);
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
