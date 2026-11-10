// Preview of the evidence PDF that "Approve & submit" attaches.
import { evidencePdf, latestRecommendation } from '@/lib/submit';

export async function GET(_req: Request, ctx: RouteContext<'/api/disputes/[id]/evidence'>) {
  const { id } = await ctx.params;
  const rec = await latestRecommendation(id);
  if (!rec) return new Response('No recommendation yet', { status: 404 });
  const pdf = await evidencePdf(rec, rec.draft ?? '');
  if (!pdf) return new Response('No mandate-backed purchase for this dispute', { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="vouch_mandate_record_${id}.pdf"` },
  });
}
