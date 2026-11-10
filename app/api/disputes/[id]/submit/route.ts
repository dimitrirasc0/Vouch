// "Approve & submit": the merchant's explicit approval; sends the recommended action to PayPal.
import { submitRecommendation } from '@/lib/submit';

export async function POST(req: Request, ctx: RouteContext<'/api/disputes/[id]/submit'>) {
  const { id } = await ctx.params;
  const { note, offerAmount } = (await req.json().catch(() => ({}))) as { note?: string; offerAmount?: number };
  try {
    const result = await submitRecommendation(id, { note, offerAmount });
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
