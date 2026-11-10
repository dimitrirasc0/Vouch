// Code-only purchase under a mandate (the shopping agent will call the same function as a tool).
import { addTracking, MandateViolation, purchase } from '@/lib/purchases';

export async function POST(req: Request, ctx: RouteContext<'/api/mandates/[id]/purchase'>) {
  const { id } = await ctx.params;
  const { itemId, overstep } = (await req.json()) as { itemId?: string; overstep?: boolean };
  if (!itemId) return Response.json({ error: 'itemId required' }, { status: 400 });
  try {
    const result = await purchase(id, itemId, { overstep: overstep === true });
    const tracked = await addTracking(result.purchase.id).catch((err: Error) => ({ trackingError: err.message }));
    return Response.json({ ...result, tracked });
  } catch (err) {
    if (err instanceof MandateViolation) return Response.json({ error: err.message, check: err.check }, { status: 422 });
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
