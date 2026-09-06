/**
 * Otomasyon kartları ucu — LLM'e HİÇ UĞRAMAZ.
 *
 * `app/api/asistan/sinyaller/route.ts` ile aynı gerekçe: panoya basılan rakamlar
 * buradan çıktığı gibi ekrana gidiyor. Modelden geçirilseydi her açılış para
 * harcar, gecikme eklerdi ve en kötüsü kullanıcının en çok güvendiği rakamlar
 * tahmin edilebilir olurdu.
 *
 * Uç üç işi sırayla yapar: kartları üret → susturulmuşları süz → EKRANA GİRENLERİ
 * günlüğe yaz. Sıra önemli: susturulmuş kart gösterilmediği için günlüğe de
 * yazılmaz, yoksa "gösterildi ama umursanmadı" sayısı şişerdi.
 *
 * Aynı gerekçe gösterim bütçesi için de geçerli: kartların tamamı döner (istemci
 * "+N konu daha var" diyebilsin) ama günlüğe yalnız ilk `GOSTERILECEK` tanesi
 * yazılır — gerisi kullanıcının gözüne HİÇ girmedi.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, pagePermissionsOf } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { kartlariUret } from "@/lib/otomasyon/kartlar"
import { GOSTERILECEK } from "@/lib/otomasyon/tipler"
import { aktifSusturmalar, gosterimleriYaz, susturmaAnahtari } from "@/lib/otomasyon/gunluk"

export const dynamic = "force-dynamic"
// Stok hızı sorgusu büyük firmada birkaç saniye sürüyor; kart sayısı arttıkça
// bu iş cron'a taşınacak (bkz. docs/otomasyonlar/KATALOG.md, Faz 0).
export const maxDuration = 30

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId") || undefined)
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  const uyelik = await ensureCompanyAccess(companyId)

  const sonuc = await kartlariUret({
    companyId,
    izinler: pagePermissionsOf(uyelik),
    kapaliModuller: uyelik.disabledModules ?? [],
  })

  const susturulmus = await aktifSusturmalar(companyId)
  const kartlar = sonuc.kartlar.filter(
    (k) => !susturulmus.has(susturmaAnahtari(k.kod, k.ozneId))
  )

  // Yalnız ekrana girenler günlüğe yazılır; kalanlar "+N konu daha" satırında
  // sayı olarak duyuruluyor, gösterilmiş sayılmazlar.
  await gosterimleriYaz(companyId, user.id ?? null, kartlar.slice(0, GOSTERILECEK))

  return NextResponse.json({
    kartlar,
    kapaliAlanlar: sonuc.kapaliAlanlar,
    hatalar: sonuc.hatalar,
  })
})
