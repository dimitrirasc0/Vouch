// Called by the JS SDK button's onApprove: authorizes the approved order and activates the mandate.
import { authorizeMandate, getMandate } from '@/lib/mandates';

export async function POST(req: Request, ctx: RouteContext<'/api/mandates/[id]/authorize'>) {
  const { id } = await ctx.params;
  const { orderID } = (await req.json()) as { orderID?: string };
  const m = await getMandate(id);
  if (!m) return Response.json({ error: 'Mandate not found' }, { status: 404 });
  if (!orderID) return Response.json({ error: 'orderID required' }, { status: 400 });
  if (m.status === 'AUTHORIZED') return Response.json({ mandate: m });
  try {
    return Response.json({ mandate: await authorizeMandate(m, orderID) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
