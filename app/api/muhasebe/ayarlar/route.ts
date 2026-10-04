import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { gunParam, jsonGovde, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { muhasebeKur } from "@/lib/muhasebe/kurulum.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Muhasebe ayarları — kurulum durumu, başlangıç tarihi, açılış fişi, dönem kilidi.
 *
 * GET ?companyId=   → durum (kurulu mu, sayılar, açılış fişi)
 * PUT { companyId, startDate } → kurulum / başlangıç tarihi değişikliği
 *     (plan yazılır, kasa/banka alt hesapları ve açılış fişi kurulur; geçmiş
 *     belgelerin fişleri istemcinin mutabakat döngüsüyle üretilir)
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const { ctx, companyId } = await muhasebeGirisi(new URL(request.url).searchParams.get("companyId"))
  const [sahip, hesapSayisi, durumlar, acilis] = await Promise.all([
    prisma.company.findUnique({ where: { id: ctx.defterId }, select: { id: true, name: true, branchName: true } }),
    prisma.accountPlan.count({ where: { companyId: ctx.defterId } }),
    prisma.journalVoucher.groupBy({
      by: ["status"],
      where: { companyId: ctx.defterId },
      _count: { _all: true },
    }),
    ctx.ayar?.openingVoucherId
      ? prisma.journalVoucher.findUnique({
          where: { id: ctx.ayar.openingVoucherId },
          select: { id: true, status: true, voucherNo: true, isConfident: true, sourceChangedAt: true },
        })
      : null,
  ])
  const say = (s: string) => durumlar.find((d) => d.status === s)?._count._all ?? 0
  return NextResponse.json({
    defter: { id: ctx.defterId, ad: sahip?.name ?? "", sube: companyId !== ctx.defterId, sirketSayisi: ctx.sirketIds.length },
    modulAcik: ctx.modulAcik,
    kurulu: Boolean(ctx.ayar?.planInstalledAt),
    ayar: ctx.ayar
      ? {
          baslangic: ctx.ayar.startDate.toISOString().slice(0, 10),
          kilitliSonGun: ctx.ayar.lockedUntil?.toISOString().slice(0, 10) ?? null,
          planKurulum: ctx.ayar.planInstalledAt?.toISOString() ?? null,
        }
      : null,
    hesapSayisi,
    fisler: { taslak: say("DRAFT"), onayli: say("POSTED") },
    acilis: acilis
      ? { id: acilis.id, no: acilis.voucherNo, durum: acilis.status, emin: acilis.isConfident, degisti: acilis.sourceChangedAt != null }
      : null,
  })
})

export const PUT = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { companyId, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const baslangic = gunParam(body.startDate, "Başlangıç tarihi")
  if (!baslangic) throw new FisHatasi("Başlangıç tarihi seçin.")
  const ctx = await muhasebeKur(companyId, baslangic, kullaniciId)
  return NextResponse.json({ ok: true, baslangic: ctx.ayar.startDate.toISOString().slice(0, 10) })
})
