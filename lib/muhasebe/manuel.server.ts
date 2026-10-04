import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { kilitliMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { acilisFarki } from "@/lib/muhasebe/acilis"
import { ACILIS_KAYNAGI } from "@/lib/muhasebe/acilis.server"
import { fisNumaratoru } from "@/lib/muhasebe/senkron.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"
import { cozulmusEminMi, type HesapKaynagiDb } from "@/lib/muhasebe/hesap-cozumu"
import { r2, type SatirRolu } from "@/lib/muhasebe/fis"

/**
 * ELLE FİŞ — belgesi olmayan kayıtlar (amortisman, sermaye, stok devri, düzeltme)
 * ve açılış fişinin farkını dağıtan satırlar.
 *
 * Elle fiş de taslak doğar ve aynı onay kurallarından geçer. Kaydederken fiş
 * DENGELİ olmalı; hesapsız satır taslakta kalabilir (onay ister).
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

export type ElleSatir = { side: "DEBIT" | "CREDIT"; amount: number; accountId: string | null; description?: string | null }

export function elleSatirlariAyikla(ham: unknown): ElleSatir[] {
  if (!Array.isArray(ham)) throw new FisHatasi("Satırlar liste olmalı.")
  return ham.map((s, i) => {
    const r = (s ?? {}) as Record<string, unknown>
    const side = r.side === "DEBIT" || r.side === "CREDIT" ? r.side : null
    if (!side) throw new FisHatasi(`${i + 1}. satır: borç/alacak seçilmedi.`)
    const amount = r2(Number(r.amount))
    if (!(amount > 0)) throw new FisHatasi(`${i + 1}. satır: tutar sıfırdan büyük olmalı.`)
    const accountId = typeof r.accountId === "string" && r.accountId ? r.accountId : null
    const description = typeof r.description === "string" ? r.description.slice(0, 500) : null
    return { side, amount, accountId, description }
  })
}

async function hesaplariDogrula(defterId: string, satirlar: ElleSatir[]) {
  const ids = [...new Set(satirlar.map((s) => s.accountId).filter(Boolean) as string[])]
  if (ids.length === 0) return
  const hesaplar = await prisma.accountPlan.findMany({
    where: { id: { in: ids }, companyId: defterId },
    select: { id: true, code: true, isActive: true, _count: { select: { children: true } } },
  })
  const map = new Map(hesaplar.map((h) => [h.id, h]))
  for (const id of ids) {
    const h = map.get(id)
    if (!h) throw new FisHatasi("Hesap bu firmanın planında yok.")
    if (!h.isActive) throw new FisHatasi(`${h.code} hesabı pasif.`)
    if (h._count.children > 0) throw new FisHatasi(`${h.code} alt hesabı olan bir hesap — alt hesaplardan birini seçin.`)
  }
}

const borcAlacak = (satirlar: Array<{ side: string; amount: number }>) => ({
  borc: r2(satirlar.filter((s) => s.side === "DEBIT").reduce((a, s) => a + s.amount, 0)),
  alacak: r2(satirlar.filter((s) => s.side === "CREDIT").reduce((a, s) => a + s.amount, 0)),
})

/** Elle fiş aç ya da (taslaksa) güncelle. */
export async function elleFisKaydet(
  ctx: Ctx,
  girdi: { fisId?: string | null; tarih: Date; aciklama: string; satirlar: ElleSatir[] },
  kullaniciId: string,
): Promise<{ id: string }> {
  if (girdi.tarih.getTime() < ctx.ayar.startDate.getTime()) {
    throw new FisHatasi("Fiş tarihi muhasebe başlangıç tarihinden önce olamaz (öncesi açılış fişindedir).")
  }
  if (kilitliMi(ctx.ayar, girdi.tarih)) throw new FisHatasi("Tarih kapanmış (kilitli) dönemde.")
  if (girdi.satirlar.length < 2) throw new FisHatasi("Fişte en az iki satır olmalı.")
  const { borc, alacak } = borcAlacak(girdi.satirlar)
  if (borc !== alacak) throw new FisHatasi(`Fiş dengesiz: borç ${borc.toFixed(2)} ≠ alacak ${alacak.toFixed(2)}.`)
  await hesaplariDogrula(ctx.defterId, girdi.satirlar)

  const satirVerisi = girdi.satirlar.map((s, i) => ({
    companyId: ctx.defterId,
    order: i,
    side: s.side,
    amount: new Prisma.Decimal(s.amount.toFixed(2)),
    accountId: s.accountId,
    suggestedCode: "",
    role: "MANUEL",
    accountSource: s.accountId ? "USER" : "NONE",
    learnKeys: [],
    description: s.description ?? null,
  }))
  const emin = girdi.satirlar.every((s) => s.accountId)
  const aciklama = girdi.aciklama.trim().slice(0, 500) || "Mahsup fişi"

  if (girdi.fisId) {
    const mevcut = await prisma.journalVoucher.findFirst({
      where: { id: girdi.fisId, companyId: ctx.defterId },
      select: { id: true, status: true, sourceType: true, date: true },
    })
    if (!mevcut) throw new FisHatasi("Fiş bulunamadı", 404)
    if (mevcut.sourceType !== "MANUAL") throw new FisHatasi("Yalnız elle açılmış fiş düzenlenebilir.")
    if (mevcut.status !== "DRAFT") throw new FisHatasi("Onaylı fiş düzenlenemez; önce geri alın.")
    if (kilitliMi(ctx.ayar, mevcut.date)) throw new FisHatasi("Fişin tarihi kapanmış (kilitli) dönemde.")
    await prisma.$transaction([
      prisma.journalVoucherLine.deleteMany({ where: { voucherId: mevcut.id } }),
      prisma.journalVoucher.update({
        where: { id: mevcut.id },
        data: { date: girdi.tarih, description: aciklama, isConfident: emin },
      }),
      prisma.journalVoucherLine.createMany({ data: satirVerisi.map((s) => ({ ...s, voucherId: mevcut.id })) }),
    ])
    return { id: mevcut.id }
  }

  const numara = fisNumaratoru(ctx.defterId)
  for (let deneme = 0; deneme < 4; deneme++) {
    try {
      const yeni = await prisma.journalVoucher.create({
        data: {
          companyId: ctx.defterId,
          voucherNo: await numara.sonraki(girdi.tarih),
          date: girdi.tarih,
          description: aciklama,
          status: "DRAFT",
          sourceType: "MANUAL",
          sourceId: null,
          sourceCompanyId: ctx.defterId,
          kind: "MAHSUP",
          isConfident: emin,
          createdBy: kullaniciId,
          lines: { create: satirVerisi },
        },
        select: { id: true },
      })
      return yeni
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await numara.tazele(girdi.tarih)
        continue
      }
      throw e
    }
  }
  throw new FisHatasi("Fiş numarası alınamadı, tekrar deneyin.", 409)
}

/**
 * Açılış fişinin ELLE satırlarını kaydeder (farkı dağıtmak için: 153 stok, 255
 * demirbaş, 500 sermaye…). Otomatik satırlara dokunulmaz; fark satırı yeniden
 * hesaplanır, sıfırlanınca kalkar. Fark satırında elle seçilmiş hesap korunur.
 */
export async function acilisElleSatirlariKaydet(ctx: Ctx, fisId: string, satirlar: ElleSatir[]): Promise<void> {
  const fis = await prisma.journalVoucher.findFirst({
    where: { id: fisId, companyId: ctx.defterId, sourceType: ACILIS_KAYNAGI },
    select: {
      id: true,
      status: true,
      date: true,
      lines: {
        select: { id: true, role: true, side: true, amount: true, accountId: true, accountSource: true, order: true },
      },
    },
  })
  if (!fis) throw new FisHatasi("Açılış fişi bulunamadı", 404)
  if (fis.status !== "DRAFT") throw new FisHatasi("Onaylı açılış fişi düzenlenemez; önce geri alın.")
  if (kilitliMi(ctx.ayar, fis.date)) throw new FisHatasi("Fişin tarihi kapanmış (kilitli) dönemde.")
  await hesaplariDogrula(ctx.defterId, satirlar)

  const otomatik = fis.lines.filter((l) => l.role === "ACILIS")
  const eskiFark = fis.lines.find((l) => l.role === "ACILIS_FARK")
  const fark = acilisFarki([
    ...otomatik.map((l) => ({ taraf: l.side === "DEBIT" ? ("B" as const) : ("A" as const), tutar: Number(l.amount), rol: "ACILIS" as SatirRolu })),
    ...satirlar.map((s) => ({ taraf: s.side === "DEBIT" ? ("B" as const) : ("A" as const), tutar: s.amount, rol: "MANUEL" as SatirRolu })),
  ])
  const sonSira = Math.max(0, ...otomatik.map((l) => l.order)) + 1
  const elleVeri = satirlar.map((s, i) => ({
    voucherId: fis.id,
    companyId: ctx.defterId,
    order: sonSira + i,
    side: s.side,
    amount: new Prisma.Decimal(s.amount.toFixed(2)),
    accountId: s.accountId,
    suggestedCode: "",
    role: "MANUEL",
    accountSource: s.accountId ? "USER" : "NONE",
    learnKeys: [],
    description: s.description ?? null,
  }))
  const farkHesabi = eskiFark?.accountSource === "USER" ? eskiFark.accountId : null
  const farkVeri = fark
    ? [
        {
          voucherId: fis.id,
          companyId: ctx.defterId,
          order: sonSira + satirlar.length,
          side: fark.taraf === "B" ? "DEBIT" : "CREDIT",
          amount: new Prisma.Decimal(fark.tutar.toFixed(2)),
          accountId: farkHesabi,
          suggestedCode: fark.oneriKodu,
          role: "ACILIS_FARK",
          accountSource: farkHesabi ? "USER" : "NONE",
          learnKeys: [],
          description: fark.aciklama,
        },
      ]
    : []
  const tum = [
    ...otomatik.map((l) => ({ accountId: l.accountId, accountSource: l.accountSource, role: l.role })),
    ...elleVeri,
    ...farkVeri,
  ]
  const emin = tum.every((s) =>
    cozulmusEminMi({ accountId: s.accountId, accountSource: s.accountSource as HesapKaynagiDb, rol: s.role as SatirRolu }),
  )
  await prisma.$transaction([
    prisma.journalVoucherLine.deleteMany({ where: { voucherId: fis.id, role: { in: ["MANUEL", "ACILIS_FARK"] } } }),
    prisma.journalVoucherLine.createMany({ data: [...elleVeri, ...farkVeri] }),
    prisma.journalVoucher.update({ where: { id: fis.id }, data: { isConfident: emin } }),
  ])
}

/** Elle fişi sil (yalnız taslak ve elle açılmış). */
export async function elleFisSil(ctx: Ctx, fisId: string): Promise<void> {
  const fis = await prisma.journalVoucher.findFirst({
    where: { id: fisId, companyId: ctx.defterId },
    select: { id: true, status: true, sourceType: true, date: true },
  })
  if (!fis) throw new FisHatasi("Fiş bulunamadı", 404)
  if (fis.sourceType !== "MANUAL") throw new FisHatasi("Belgeden üretilen fiş silinmez; belge silinince kendiliğinden kalkar.")
  if (fis.status !== "DRAFT") throw new FisHatasi("Onaylı fiş silinemez; önce geri alın.")
  if (kilitliMi(ctx.ayar, fis.date)) throw new FisHatasi("Fişin tarihi kapanmış (kilitli) dönemde.")
  await prisma.journalVoucher.delete({ where: { id: fis.id } })
}
