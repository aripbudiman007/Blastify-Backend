/**
 * Watermark Blastify untuk plan gratis.
 * Ditambahkan ke SEMUA pesan keluar bertipe teks/caption dari plan ber-watermark,
 * di semua jalur pengiriman: send/bulk (worker), broadcast, auto-reply,
 * reply quote inbox, dan integrasi webhook.
 */
export const WATERMARK_TEXT =
  '\n\n_⚡ Dikirim via Blastify (Free Plan) — blastify.id. Upgrade untuk hapus pesan ini._';

// Data-driven dari kolom PlanLimit.hasWatermark — di-refresh saat startup
// dan setiap admin mengubah plan. Fallback awal: FREE.
let watermarkPlans = new Set<string>(['FREE']);

export async function refreshWatermarkPlans(): Promise<void> {
  try {
    const { prisma } = await import('../prisma/client');
    const rows = await prisma.planLimit.findMany({
      where: { hasWatermark: true },
      select: { plan: true },
    });
    // Hanya timpa fallback bila tabel PlanLimit sudah ter-seed
    if ((await prisma.planLimit.count()) > 0) {
      watermarkPlans = new Set(rows.map((r) => r.plan as string));
    }
  } catch {
    // tabel belum ada / DB down — pertahankan set terakhir
  }
}

export function applyFreeWatermark(text: string, plan?: string | null): string {
  if (plan && watermarkPlans.has(plan)) {
    return text + WATERMARK_TEXT;
  }
  return text;
}
