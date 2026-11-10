// Renders the mandate evidence record as a PDF (PayPal accepts pdf/jpg/png/gif, <10MB).
import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type EvidenceRecord = {
  disputeId: string;
  generatedAt: string;
  buyerInstructions: string;
  rules: Record<string, unknown>;
  summary: string;
  fingerprint: string;
  paypalOrderId: string | null;
  paypalCustomId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  authorizationId: string | null;
  purchase: { item: string; amount: string; currency: string; captureId: string | null; boughtAt: string };
  tracking: { carrier: string | null; number: string | null };
  checks: { rule: string; pass: boolean; detail: string }[];
  integrity: { hashMatches: boolean; signatureMatches: boolean; paypalMatches: boolean | null };
  points: string[];
};

const NAVY = rgb(0, 0.11, 0.39);
const MUTED = rgb(0.33, 0.36, 0.41);
const GREEN = rgb(0, 0.53, 0.35);
const RED = rgb(0.77, 0.07, 0.18);

// Standard PDF fonts only cover WinAnsi; replace anything else so drawing never throws.
const safe = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).replace(/[^\x20-\x7E -ÿ]/g, (c) => ({ '—': '-', '–': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '≤': '<=', '≥': '>=', '•': '-' })[c] ?? '?');

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderEvidencePdf(r: EvidenceRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Vouch mandate evidence - ${r.disputeId}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const M = 50;
  const W = 612 - 2 * M;
  let page: PDFPage = doc.addPage([612, 792]);
  let y = 742;

  const ensure = (h: number) => {
    if (y - h < 50) {
      page = doc.addPage([612, 792]);
      y = 742;
    }
  };
  const text = (s: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const f = o.f ?? font;
    const size = o.size ?? 10;
    for (const line of wrap(s, f, size, W - (o.indent ?? 0))) {
      ensure(size + 4);
      page.drawText(line, { x: M + (o.indent ?? 0), y, size, font: f, color: o.color ?? rgb(0, 0.08, 0.21) });
      y -= size + 4;
    }
  };
  const heading = (s: string) => {
    y -= 8;
    ensure(30);
    text(s, { f: bold, size: 12, color: NAVY });
    y -= 2;
  };
  const row = (k: string, v: string, f: PDFFont = font) => {
    ensure(14);
    page.drawText(safe(k), { x: M, y, size: 9, font, color: MUTED });
    const lines = wrap(v, f, 9, W - 150);
    lines.forEach((line, i) => page.drawText(line, { x: M + 150, y: y - i * 13, size: 9, font: f }));
    y -= Math.max(1, lines.length) * 13;
  };

  text('Vouch - Mandate Evidence Record', { f: bold, size: 18, color: NAVY });
  text(`PayPal dispute ${r.disputeId}  -  generated ${r.generatedAt}`, { size: 9, color: MUTED });
  y -= 6;
  text(
    'This purchase was made by an AI shopping agent under a mandate the buyer approved in PayPal. The mandate fingerprint (SHA-256 of the rules) is stored on the PayPal order as custom_id, so PayPal\'s own record identifies exactly which rules the buyer approved.',
    { size: 10 },
  );

  heading('1. What the buyer asked for');
  text(`"${r.buyerInstructions}"`, { f: font, size: 10, indent: 10 });
  y -= 4;
  for (const [k, v] of Object.entries(r.rules)) row(k, String(v));
  row('Shown to buyer in PayPal', r.summary);

  heading('2. Buyer approval in PayPal');
  row('PayPal order', r.paypalOrderId ?? '-', mono);
  row('Authorization', r.authorizationId ?? '-', mono);
  row('Approved at', r.approvedAt ?? '-');
  row('Approved by', r.approvedBy ?? '-');
  row('Mandate fingerprint', r.fingerprint, mono);
  row('PayPal order custom_id', r.paypalCustomId ?? '-', mono);

  heading('3. Integrity checks');
  const mark = (ok: boolean | null) => (ok === null ? 'not checked' : ok ? 'PASS' : 'FAIL');
  row('Rules match fingerprint', mark(r.integrity.hashMatches));
  row('Vouch signature valid', mark(r.integrity.signatureMatches));
  row('PayPal custom_id matches', mark(r.integrity.paypalMatches));

  heading('4. The purchase');
  row('Item', r.purchase.item);
  row('Price', `${r.purchase.amount} ${r.purchase.currency}`);
  row('Capture / transaction', r.purchase.captureId ?? '-', mono);
  row('Bought at', r.purchase.boughtAt);
  row('Carrier / tracking', `${r.tracking.carrier ?? '-'}  ${r.tracking.number ?? ''}`, mono);

  heading('5. Purchase checked against the mandate');
  for (const c of r.checks) {
    ensure(14);
    page.drawText(c.pass ? 'PASS' : 'FAIL', { x: M, y, size: 9, font: bold, color: c.pass ? GREEN : RED });
    page.drawText(safe(`${c.rule}: ${c.detail}`), { x: M + 40, y, size: 9, font });
    y -= 13;
  }

  heading('6. Summary of evidence');
  for (const p of r.points) text(`- ${p}`, { size: 9, indent: 6 });

  return doc.save();
}
