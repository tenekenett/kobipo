/**
 * Uyarı sinyalleri ucu — LLM'e HİÇ UĞRAMAZ.
 *
 * Panelin uyarı kartları bu uçtan besleniyor ve rakamlar buradan çıktığı gibi
 * ekrana basılıyor. Modelden geçirilseydi (ör. "kartları da sen yaz" deseydik)
 * her açılış para harcar, gecikme eklerdi ve en kötüsü: kullanıcının en çok
 * güvendiği rakamlar tahmin edilebilir olurdu.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, pagePermissionsOf } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { asistanAcikMi } from "@/lib/asistan/erisim"
import { sinyalleriHesapla } from "@/lib/asistan/sinyaller"
import { karsilamaCumlesi } from "@/lib/asistan/prompt"

export const dynamic = "force-dynamic"
// Sinyaller paralel koşuyor ama yaşlandırma büyük firmada birkaç saniye sürüyor.
export const maxDuration = 30

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId") || undefined)
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  const uyelik = await ensureCompanyAccess(companyId)

  const firma = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, slug: true, name: true, branchName: true },
  })
  if (!asistanAcikMi(firma)) {
    return NextResponse.json({ error: "Asistan bu firma için açık değil" }, { status: 403 })
  }

  const sonuc = await sinyalleriHesapla({
    companyId,
    izinler: pagePermissionsOf(uyelik),
    kapaliModuller: uyelik.disabledModules ?? [],
  })

  return NextResponse.json({
    ...sonuc,
    karsilama: karsilamaCumlesi(sonuc.sinyaller),
  })
})
