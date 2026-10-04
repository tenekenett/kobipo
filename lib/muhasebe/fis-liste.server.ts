import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { trFoldAnyLike, trLikePattern } from "@/lib/db/tr-search"
import { TAHMIN_ROLLERI, type SatirRolu } from "@/lib/muhasebe/fis"

/**
 * FİŞ LİSTESİ — "Fişler" ekranının sekmeleri (plan §2.6):
 *
 *   emin      taslak + motor emin   → toplu onay
 *   gozden    taslak + emin değil   → hesapsız ya da tahminli satır var
 *   degisti   onaylı + kaynak sonradan değişti → yeniden üret / gözden geçir
 *   onayli    onaylı (deftere işlenmiş)
 *   tum       hepsi
 */

export const FIS_SEKMELERI = ["emin", "gozden", "degisti", "onayli", "tum"] as const
export type FisSekmesi = (typeof FIS_SEKMELERI)[number]

export function fisSekmesiMi(v: unknown): v is FisSekmesi {
  return typeof v === "string" && (FIS_SEKMELERI as readonly string[]).includes(v)
}

function sekmeKosulu(sekme: FisSekmesi): Prisma.JournalVoucherWhereInput {
  switch (sekme) {
    case "emin":
      return { status: "DRAFT", isConfident: true }
    case "gozden":
      return { status: "DRAFT", isConfident: false }
    case "degisti":
      return { status: "POSTED", sourceChangedAt: { not: null } }
    case "onayli":
      return { status: "POSTED" }
    case "tum":
      return {}
  }
}

export type FisListeSuzgeci = {
  sekme: FisSekmesi
  bas?: Date | null
  bit?: Date | null
  kaynakTipi?: string | null
  arama?: string | null
}

async function aramaIdleri(defterId: string, arama: string | null | undefined): Promise<string[] | null> {
  const desen = trLikePattern(arama)
  if (!desen) return null
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT v.id FROM journal_vouchers v
    WHERE v."companyId" = ${defterId}
      AND (${trFoldAnyLike(["v.description", 'v."voucherNo"'], desen)})
    LIMIT 5000
  `
  return rows.map((r) => r.id)
}

export async function fisListesi(
  defterId: string,
  s: FisListeSuzgeci,
  sayfa: { atla: number; al: number },
) {
  const ids = await aramaIdleri(defterId, s.arama)
  const ortak: Prisma.JournalVoucherWhereInput = {
    companyId: defterId,
    ...(s.bas || s.bit ? { date: { ...(s.bas ? { gte: s.bas } : {}), ...(s.bit ? { lte: s.bit } : {}) } } : {}),
    ...(s.kaynakTipi ? { sourceType: s.kaynakTipi } : {}),
    ...(ids ? { id: { in: ids } } : {}),
  }
  const where = { ...ortak, ...sekmeKosulu(s.sekme) }

  const [fisler, toplam, sayilar] = await Promise.all([
    prisma.journalVoucher.findMany({
      where,
      orderBy: [{ date: "desc" }, { voucherNo: "desc" }],
      skip: sayfa.atla,
      take: sayfa.al,
      select: {
        id: true,
        voucherNo: true,
        date: true,
        description: true,
        kind: true,
        status: true,
        isConfident: true,
        sourceType: true,
        sourceId: true,
        sourceCompanyId: true,
        sourceChangedAt: true,
        approvedAt: true,
        lines: { select: { side: true, amount: true, accountId: true, accountSource: true, role: true } },
      },
    }),
    prisma.journalVoucher.count({ where }),
    Promise.all(
      (["emin", "gozden", "degisti", "onayli"] as const).map((k) =>
        prisma.journalVoucher.count({ where: { ...ortak, ...sekmeKosulu(k) } }),
      ),
    ),
  ])

  const subeIds = [...new Set(fisler.map((f) => f.sourceCompanyId).filter((id): id is string => !!id && id !== defterId))]
  const subeler = subeIds.length
    ? await prisma.company.findMany({ where: { id: { in: subeIds } }, select: { id: true, name: true, branchName: true } })
    : []
  const subeAdi = new Map(subeler.map((c) => [c.id, c.branchName || c.name]))

  return {
    toplam,
    sayilar: { emin: sayilar[0], gozden: sayilar[1], degisti: sayilar[2], onayli: sayilar[3] },
    fisler: fisler.map((f) => ({
      id: f.id,
      voucherNo: f.voucherNo,
      tarih: f.date.toISOString().slice(0, 10),
      aciklama: f.description,
      tur: f.kind,
      durum: f.status,
      emin: f.isConfident,
      kaynakTipi: f.sourceType,
      kaynakId: f.sourceId,
      sube: f.sourceCompanyId && f.sourceCompanyId !== defterId ? subeAdi.get(f.sourceCompanyId) ?? null : null,
      degisti: f.sourceChangedAt != null,
      onayTarihi: f.approvedAt?.toISOString() ?? null,
      tutar: Math.round(f.lines.filter((l) => l.side === "DEBIT").reduce((a, l) => a + Number(l.amount), 0) * 100) / 100,
      hesapsiz: f.lines.filter((l) => !l.accountId).length,
      tahmin: f.lines.filter((l) => l.accountId && l.accountSource === "DEFAULT" && TAHMIN_ROLLERI.has(l.role as SatirRolu)).length,
    })),
  }
}

/** Sekme içinde sıradaki/önceki fiş — odak görünümünde "onayla ve sıradakine geç". */
export async function komsuFisler(
  defterId: string,
  fisId: string,
  sekme: FisSekmesi,
): Promise<{ onceki: string | null; sonraki: string | null; sira: number; toplam: number }> {
  const ids = await prisma.journalVoucher.findMany({
    where: { companyId: defterId, ...sekmeKosulu(sekme) },
    orderBy: [{ date: "desc" }, { voucherNo: "desc" }],
    select: { id: true },
    take: 5000,
  })
  const i = ids.findIndex((x) => x.id === fisId)
  if (i < 0) return { onceki: null, sonraki: ids[0]?.id ?? null, sira: 0, toplam: ids.length }
  return {
    onceki: ids[i - 1]?.id ?? null,
    sonraki: ids[i + 1]?.id ?? null,
    sira: i + 1,
    toplam: ids.length,
  }
}
