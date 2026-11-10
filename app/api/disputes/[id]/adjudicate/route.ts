// Sandbox-only "Simulate PayPal decision" button.
import { adjudicate } from '@/lib/submit';

export async function POST(req: Request, ctx: RouteContext<'/api/disputes/[id]/adjudicate'>) {
  const { id } = await ctx.params;
  const { outcome } = (await req.json().catch(() => ({}))) as { outcome?: 'SELLER_FAVOR' | 'BUYER_FAVOR' };
  const result = await adjudicate(id, outcome ?? 'SELLER_FAVOR');
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
