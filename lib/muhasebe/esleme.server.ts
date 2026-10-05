import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { DefterBaglami, MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { TAHMIN_ROLLERI } from "@/lib/muhasebe/fis"
import {
  anahtarTuru,
  eslemeAnahtari,
  eslemeBekliyorMu,
  eslemeGruplari,
  grupEtiketi,
  type BekleyenSatir,
  type EslemeGrubu,
} from "@/lib/muhasebe/esleme"
import { kilitliYaz, taslaklariKilitle } from "@/lib/muhasebe/kilit.server"
import { FisHatasi, isaretleriTazele } from "@/lib/muhasebe/onay.server"

/**
 * TOPLU EŞLEME — okuma ve yazma. Kural (gruplama, etiket) saf modülde: `esleme.ts`.
 *
 * Kapsam: açık dönemdeki TASLAK fişlerin eşleme bekleyen satırları (hesapsız ya da tahmin
 * olan varsayılan). Kilitli döneme yazılmaz. Yazma `kilit.server.ts` kuralıyla: fiş kilit
 * altında yeniden "taslak mı" diye sorulur, satır da "hâlâ bekliyor mu" diye — arada elle
 * seçilmiş ya da onaylanmış hiçbir şey ezilmez.
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

/** Açık dönemin ilk günü (kilitliMi ile aynı sınır: lockedUntil'in ertesi günü). */
const acikDonemSarti = (ayar: MuhasebeAyari): Prisma.JournalVoucherWhereInput =>
  ayar.lockedUntil ? { date: { gte: new Date(ayar.lockedUntil.getTime() + 86_400_000) } } : {}

async function bekleyenSatirlar(ctx: Ctx): Promise<BekleyenSatir[]> {
  const rows = await prisma.journalVoucherLine.findMany({
    where: {
      companyId: ctx.defterId,
      voucher: { status: "DRAFT", ...acikDonemSarti(ctx.ayar) },
      OR: [{ accountId: null }, { accountSource: "DEFAULT", role: { in: [...TAHMIN_ROLLERI] } }],
    },
    select: {
      id: true,
      voucherId: true,
      role: true,
      side: true,
      amount: true,
      learnKeys: true,
      suggestedCode: true,
      description: true,
      accountId: true,
      accountSource: true,
    },
  })
  return rows.map((r) => ({ ...r, amount: Number(r.amount) })).filter(eslemeBekliyorMu)
}

export type EslemeGrubuGorunumu = EslemeGrubu & {
  etiket: string
  tahminHesap: { id: string; kod: string; ad: string } | null
}

export async function eslemeListesi(ctx: Ctx): Promise<{ gruplar: EslemeGrubuGorunumu[]; fisSayisi: number; satirSayisi: number }> {
  const satirlar = await bekleyenSatirlar(ctx)
  const gruplar = eslemeGruplari(satirlar)

  const tedarikciIds = new Set<string>()
  const urunIds = new Set<string>()
  for (const g of gruplar) {
    for (const a of g.ogrenmeAnahtarlari) {
      const t = anahtarTuru(a)
      if (t?.tur === "tedarikci-kdv") tedarikciIds.add(t.tedarikciId)
      if (t?.tur === "urun") urunIds.add(t.urunId)
    }
  }
  const tahminIds = [...new Set(gruplar.map((g) => g.tahminHesapId).filter((id): id is string => !!id))]
  const [tedarikciler, urunler, hesaplar] = await Promise.all([
    tedarikciIds.size
      ? prisma.supplier.findMany({ where: { id: { in: [...tedarikciIds] } }, select: { id: true, name: true } })
      : [],
    urunIds.size ? prisma.product.findMany({ where: { id: { in: [...urunIds] } }, select: { id: true, name: true } }) : [],
    tahminIds.length
      ? prisma.accountPlan.findMany({ where: { id: { in: tahminIds }, companyId: ctx.defterId }, select: { id: true, code: true, name: true } })
      : [],
  ])
  const adlar = {
    tedarikci: new Map(tedarikciler.map((t) => [t.id, t.name])),
    urun: new Map(urunler.map((u) => [u.id, u.name])),
  }
  const hesapMap = new Map(hesaplar.map((h) => [h.id, { id: h.id, kod: h.code, ad: h.name }]))
  return {
    gruplar: gruplar.map((g) => ({
      ...g,
      etiket: grupEtiketi(g, adlar),
      tahminHesap: g.tahminHesapId ? hesapMap.get(g.tahminHesapId) ?? null : null,
    })),
    fisSayisi: new Set(satirlar.map((s) => s.voucherId)).size,
    satirSayisi: satirlar.length,
  }
}

const FIS_PARCASI = 500

/**
 * Seçilen gruplara hesabı yazar: grubun bekleyen satırları elle seçilmiş (USER) olur.
 * Kural YAZILMAZ — öğrenme onayda (esleme.ts başlığı). Döner: eşlenen satır ve fiş sayısı,
 * bu işlemden sonra "emin" olan fişler (istemci onlara toplu onay önerir).
 */
export async function eslemeUygula(
  ctx: Ctx,
  atamalar: Array<{ anahtar: string; accountId: string }>,
): Promise<{ satir: number; fis: number; eminFisler: string[] }> {
  const hesapByAnahtar = new Map<string, string>()
  for (const a of atamalar) if (a.anahtar && a.accountId) hesapByAnahtar.set(a.anahtar, a.accountId)
  if (hesapByAnahtar.size === 0) throw new FisHatasi("Hesap seçilmiş grup yok.")

  const hesapIds = [...new Set(hesapByAnahtar.values())]
  const hesaplar = await prisma.accountPlan.findMany({
    where: { id: { in: hesapIds }, companyId: ctx.defterId },
    select: { id: true, code: true, isActive: true, _count: { select: { children: true } } },
  })
  const hesapMap = new Map(hesaplar.map((h) => [h.id, h]))
  for (const id of hesapIds) {
    const h = hesapMap.get(id)
    if (!h) throw new FisHatasi("Hesap bu firmanın planında yok.")
    if (!h.isActive) throw new FisHatasi(`${h.code} hesabı pasif.`)
    if (h._count.children > 0) throw new FisHatasi(`${h.code} alt hesabı olan bir hesap — alt hesaplardan birini seçin.`)
  }

  // Grubun satırları YENİDEN okunur (ekran açıldıktan sonra gelen belgeler de aynı gruba düşer).
  const yazilacak = (await bekleyenSatirlar(ctx))
    .map((s) => ({ s, accountId: hesapByAnahtar.get(eslemeAnahtari(s)) }))
    .filter((x): x is { s: BekleyenSatir; accountId: string } => !!x.accountId)
  const fisBasina = new Map<string, Array<{ id: string; accountId: string }>>()
  for (const { s, accountId } of yazilacak) {
    fisBasina.set(s.voucherId, [...(fisBasina.get(s.voucherId) ?? []), { id: s.id, accountId }])
  }

  let satir = 0
  const etkilenen = new Set<string>()
  const fisIds = [...fisBasina.keys()]
  for (let i = 0; i < fisIds.length; i += FIS_PARCASI) {
    const parca = fisIds.slice(i, i + FIS_PARCASI)
    await kilitliYaz(async (tx) => {
      const taslak = await taslaklariKilitle(tx, ctx.defterId, parca)
      const degerler = parca
        .filter((id) => taslak.has(id))
        .flatMap((id) => fisBasina.get(id)!)
        .map((d) => Prisma.sql`(${d.id}, ${d.accountId})`)
      if (degerler.length === 0) return
      // Satır hâlâ bekliyor mu YAZMA anında sorulur: bu arada elle seçilen (USER) ya da
      // öğrenilen (LEARNED) hesap ezilmez.
      const yazilan = await tx.$queryRaw<Array<{ voucherId: string }>>`
        UPDATE journal_voucher_lines AS l SET "accountId" = v.aid, "accountSource" = 'USER'
        FROM (VALUES ${Prisma.join(degerler)}) AS v(id, aid)
        WHERE l.id = v.id AND l."companyId" = ${ctx.defterId} AND l."accountSource" IN ('NONE', 'DEFAULT')
        RETURNING l."voucherId"
      `
      satir += yazilan.length
      for (const r of yazilan) etkilenen.add(r.voucherId)
    })
  }
  await isaretleriTazele([...etkilenen])
  const eminler = etkilenen.size
    ? await prisma.journalVoucher.findMany({
        where: { id: { in: [...etkilenen] }, status: "DRAFT", isConfident: true },
        select: { id: true },
      })
    : []
  return { satir, fis: etkilenen.size, eminFisler: eminler.map((f) => f.id) }
}
