import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { geceMutabakati } from "@/lib/muhasebe/gece-mutabakati.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Muhasebe gece mutabakatı — zamanlanmış uç (lib/muhasebe/gece-mutabakati.server.ts).
 * Tetik: GitHub Actions, günde bir (.github/workflows/muhasebe-mutabakat.yml).
 * Kimlik: `CRON_SECRET` (lib/billing/cron-auth.ts), GET ya da POST. Yanıt yalnız sayı taşır.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const basla = Date.now()
  const sonuc = await geceMutabakati({ deadline: basla + 50_000 })
  return NextResponse.json({ ok: sonuc.hata === 0, sureMs: Date.now() - basla, ...sonuc }, { status: sonuc.hata ? 500 : 200 })
}

export const GET = handle
export const POST = handle
