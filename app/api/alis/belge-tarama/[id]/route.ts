/**
 * Tek tarama satırı.
 *
 *   GET   → kart için tam satır (sınıf + çıkarım + denetimler).
 *   PATCH → durum güncellemesi: reddet / hedefe bağla. KAYDETMEZ — kayıt her
 *           türün kendi ucundan yapılır; burası yalnız "i. belge şu kayda
 *           dönüştü" izini yazar ve tüm belgeler bağlanınca satırı SAVED yapar.
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { prisma } from "@/lib/db/prisma"
import { tumBelgelerKaydedildiMi, type TaramaHedefi } from "@/lib/belge-ocr/kayit"
import type { NormalBelge } from "@/lib/belge-ocr/sinif/normalize"

export const dynamic = "force-dynamic"

const HEDEF_TURLERI = new Set(["INVOICE", "WAYBILL", "PAYMENT", "CHECK", "PROMISSORY_NOTE"])

export const GET = withApiErrors(async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const row = await prisma.documentScan.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "Tarama bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(row.companyId)
  return NextResponse.json({ ...row, costUsd: row.costUsd == null ? null : Number(row.costUsd) })
})

export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const row = await prisma.documentScan.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "Tarama bulunamadı" }, { status: 404 })
  await ensureCompanyWrite(row.companyId)

  const body = await request.json().catch(() => ({}))
  const action = String(body?.action ?? "")

  if (action === "reddet") {
    if (row.status === "SAVED") return NextResponse.json({ error: "Kaydedilmiş tarama reddedilemez" }, { status: 400 })
    const g = await prisma.documentScan.update({ where: { id }, data: { status: "REJECTED" } })
    return NextResponse.json(g)
  }

  if (action === "hedef") {
    const index = Number(body?.index)
    const type = String(body?.type ?? "")
    const targetId = String(body?.id ?? "")
    if (!Number.isInteger(index) || index < 0 || !HEDEF_TURLERI.has(type) || !targetId) {
      return NextResponse.json({ error: "index, type ve id zorunlu" }, { status: 400 })
    }
    const sinif = Array.isArray(row.classification) ? (row.classification as unknown as NormalBelge[]) : []
    if (index >= sinif.length) return NextResponse.json({ error: "Belge indeksi geçersiz" }, { status: 400 })
    const mevcut = Array.isArray(row.targets) ? (row.targets as unknown as TaramaHedefi[]) : []
    // Aynı belge ikinci kez bağlanamaz: kart bir kez "kaydedildi" der, ikinci
    // kayıt mükerrer belge doğururdu.
    if (mevcut.some((t) => t.index === index)) {
      return NextResponse.json({ error: "Bu belge zaten bir kayda bağlı" }, { status: 409 })
    }
    const hedefler: TaramaHedefi[] = [
      ...mevcut,
      { index, type: type as TaramaHedefi["type"], id: targetId, no: body?.no ? String(body.no) : null, slug: body?.slug ? String(body.slug) : null, at: new Date().toISOString() },
    ]
    const tamam = tumBelgelerKaydedildiMi(sinif, hedefler)
    const g = await prisma.documentScan.update({
      where: { id },
      data: { targets: hedefler as unknown as Prisma.InputJsonValue, ...(tamam ? { status: "SAVED" } : {}) },
    })
    return NextResponse.json(g)
  }

  return NextResponse.json({ error: "action: reddet | hedef" }, { status: 400 })
})
