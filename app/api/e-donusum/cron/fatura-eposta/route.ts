import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { bekleyenGelenBildirimler, gelenKutulariniTara } from "@/lib/fatura-eposta/gelen.server"
import { bekleyenGidenEpostalar } from "@/lib/fatura-eposta/giden.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * FATURA E-POSTASI TARAMASI — zamanlanmış uç (kural: lib/fatura-eposta/).
 *
 * Sırayla:
 *   1. gelen kutuları   → Mysoft'tan son 72 saatin gelen e-faturalarını çeker
 *   2. gelen bildirim   → yeni her fatura için hesap kurucusuna ayrı mail
 *   3. giden tarama     → belge GİB'e gittiği an gönderilemeyen / hata alan otomatik mailler
 *
 * Bütçe süreye göre: her adım `deadline`ı aşarsa kalanı bir sonraki koşuma bırakır
 * (sonuçta `kalan`). Sık çağrılabilir — kilit SATIR düzeyindedir (sahiplenme), iki
 * koşum aynı faturayı iki kez göndermez; günlük çift-koşum kilidine (cron_runs) bu
 * yüzden gerek yok.
 *
 * Kimlik: `CRON_SECRET` / `BILLING_CRON_SECRET` (lib/billing/cron-auth.ts). Vercel Cron
 * GET ile çağırır; dış zamanlayıcı da aynı başlıkla POST edebilir.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const basla = Date.now()
  const deadline = basla + 50_000
  const sonuc: Record<string, unknown> = {}
  const hatalar: string[] = []

  const adim = async (ad: string, fn: () => Promise<unknown>) => {
    try {
      sonuc[ad] = await fn()
    } catch (error: any) {
      const message = error?.message || String(error)
      console.error(`[fatura-eposta] ${ad} adımı çöktü:`, error)
      sonuc[ad] = { error: message }
      hatalar.push(ad)
    }
  }

  await adim("gelenKutulari", () => gelenKutulariniTara({ deadline: deadline - 20_000 }))
  await adim("gelenBildirim", () => bekleyenGelenBildirimler({ deadline: deadline - 8_000 }))
  await adim("gidenTarama", () => bekleyenGidenEpostalar({ deadline }))

  return NextResponse.json(
    { ok: hatalar.length === 0, sureMs: Date.now() - basla, hatalar, ...sonuc },
    { status: hatalar.length ? 500 : 200 },
  )
}

export const GET = handle
export const POST = handle
