// Creates the PayPal AUTHORIZE order for a draft mandate; the JS SDK button calls this.
import { createMandateOrder, getMandate } from '@/lib/mandates';

export async function POST(_req: Request, ctx: RouteContext<'/api/mandates/[id]/order'>) {
  const { id } = await ctx.params;
  const m = await getMandate(id);
  if (!m) return Response.json({ error: 'Mandate not found' }, { status: 404 });
  if (m.status !== 'DRAFT') return Response.json({ error: `Mandate is already ${m.status}` }, { status: 409 });
  try {
    return Response.json({ id: await createMandateOrder(m) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
