/**
 * Kart kararı ucu — "sipariş oluştur"a bastı, "yok say" dedi, erteledi.
 *
 * Yazdığı tek şey günlüktür: kart hiçbir kayıt DEĞİŞTİRMEZ, sipariş açmaz,
 * mesaj göndermez. Aksiyon butonu kullanıcıyı ilgili ekrana götürür, işi orada
 * kullanıcı yapar. Bu ayrım bilinçli — kartın yanılma ihtimali varken kendi
 * başına yazması, yanlış kartı geri alınamaz hâle getirirdi.
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { kararKaydet } from "@/lib/otomasyon/gunluk"

export const dynamic = "force-dynamic"

const govdeSemasi = z.object({
  companyId: z.string().optional(),
  kod: z.string().min(1).max(32),
  ozneId: z.string().min(1).max(64),
  karar: z.enum(["ACTED", "DISMISSED", "SNOOZED"]),
  aksiyon: z.string().max(64).optional().nullable(),
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ayristirma = govdeSemasi.safeParse(await request.json())
  if (!ayristirma.success) {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 })
  }
  const govde = ayristirma.data

  const companyId = await resolveCompanyId(govde.companyId || undefined)
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  // Kararı kaydetmek de firmanın verisine dokunmaktır: erişim burada da sınanır.
  await ensureCompanyAccess(companyId)

  const yazildi = await kararKaydet({
    companyId,
    userId: user.id ?? null,
    kod: govde.kod,
    ozneId: govde.ozneId,
    karar: govde.karar,
    aksiyon: govde.aksiyon ?? null,
  })

  // Gösterim satırı yoksa karar da yazılmaz; istemci yine de kartı kapatabilsin
  // diye bu bir hata değil — sonucu bildirip geçiyoruz.
  return NextResponse.json({ ok: true, yazildi })
})
