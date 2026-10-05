import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { kilitliMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { acilisFarki, acilisFisi } from "@/lib/muhasebe/acilis"
import { ACILIS_KAYNAGI, acilisGirdisi, acilisSenkronla } from "@/lib/muhasebe/acilis.server"
import { fisNumaratoru } from "@/lib/muhasebe/senkron.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"
import { kilitliYaz, taslaklariKilitle } from "@/lib/muhasebe/kilit.server"
import { cozulmusEminMi, parmakIzi, type HesapKaynagiDb } from "@/lib/muhasebe/hesap-cozumu"
import { r2, type SatirRolu } from "@/lib/muhasebe/fis"

/**
 * ELLE FİŞ — belgesi olmayan kayıtlar (amortisman, sermaye, stok devri, düzeltme)
 * ve açılış fişinin farkını dağıtan satırlar.
 *
 * Elle fiş de taslak doğar ve aynı onay kurallarından geçer. Kaydederken fiş
 * DENGELİ olmalı; hesapsız satır taslakta kalabilir (onay ister).
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

/** Okuma ile kilit arasında fiş onaylandı ya da silindi. */
const taslakDegil = () => new FisHatasi("Fiş bu sırada onaylandı ya da silindi; sayfayı yenileyin.", 409)

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
    await kilitliYaz(async (tx) => {
      if ((await taslaklariKilitle(tx, ctx.defterId, [mevcut.id])).size === 0) throw taslakDegil()
      await tx.journalVoucherLine.deleteMany({ where: { voucherId: mevcut.id } })
      await tx.journalVoucher.update({
        where: { id: mevcut.id },
        data: { date: girdi.tarih, description: aciklama, isConfident: emin },
      })
      await tx.journalVoucherLine.createMany({ data: satirVerisi.map((s) => ({ ...s, voucherId: mevcut.id })) })
    })
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

type OtomatikAcilisSatiri = { side: string; amount: unknown; accountId: string | null; accountSource: string; role: string; order: number }

/**
 * Açılış fişinin elle satırları + yeniden hesaplanan fark satırı (fiş kimliği eklenmemiş)
 * ve fişin "emin" kararı. Fark satırında elle seçilmiş hesap (`farkHesabi`) korunur.
 * `bos`: otomatik, elle ve fark satırı hiç yok — fiş deftere girmez (satırsız taslak
 * onaylanamaz ve yıl sonu kapanışını kilitlerdi).
 */
function acilisElleVerisi(defterId: string, otomatik: OtomatikAcilisSatiri[], satirlar: ElleSatir[], farkHesabi: string | null) {
  const fark = acilisFarki([
    ...otomatik.map((l) => ({ taraf: l.side === "DEBIT" ? ("B" as const) : ("A" as const), tutar: Number(l.amount), rol: "ACILIS" as SatirRolu })),
    ...satirlar.map((s) => ({ taraf: s.side === "DEBIT" ? ("B" as const) : ("A" as const), tutar: s.amount, rol: "MANUEL" as SatirRolu })),
  ])
  const sonSira = Math.max(0, ...otomatik.map((l) => l.order)) + 1
  const elleVeri = satirlar.map((s, i) => ({
    companyId: defterId,
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
  const farkVeri = fark
    ? [
        {
          companyId: defterId,
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
  const emin =
    tum.length > 0 &&
    tum.every((s) =>
      cozulmusEminMi({ accountId: s.accountId, accountSource: s.accountSource as HesapKaynagiDb, rol: s.role as SatirRolu }),
    )
  return { veri: [...elleVeri, ...farkVeri], emin, bos: tum.length === 0 }
}

/**
 * Açılış fişinin ELLE satırlarını kaydeder (farkı dağıtmak için: 153 stok, 255
 * demirbaş, 500 sermaye…). Otomatik satırlara dokunulmaz; fark satırı yeniden
 * hesaplanır, sıfırlanınca kalkar. Fark satırında elle seçilmiş hesap korunur.
 * Otomatik satırı olmayan fişin son elle satırı da silinirse fiş KALKAR (`silindi`).
 */
export async function acilisElleSatirlariKaydet(
  ctx: Ctx,
  fisId: string,
  satirlar: ElleSatir[],
): Promise<{ silindi: boolean }> {
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
  const farkHesabi = eskiFark?.accountSource === "USER" ? eskiFark.accountId : null
  const { veri, emin, bos } = acilisElleVerisi(ctx.defterId, otomatik, satirlar, farkHesabi)
  // Kilit altında (kilit.server.ts): bu arada onaylanan açılış fişinin satırı değişmez.
  return kilitliYaz(async (tx) => {
    if ((await taslaklariKilitle(tx, ctx.defterId, [fis.id])).size === 0) throw taslakDegil()
    if (bos) {
      await tx.journalVoucher.delete({ where: { id: fis.id } })
      await tx.accountingSettings.update({ where: { companyId: ctx.defterId }, data: { openingVoucherId: null } })
      return { silindi: true }
    }
    await tx.journalVoucherLine.deleteMany({ where: { voucherId: fis.id, role: { in: ["MANUEL", "ACILIS_FARK"] } } })
    await tx.journalVoucherLine.createMany({ data: veri.map((s) => ({ ...s, voucherId: fis.id })) })
    await tx.journalVoucher.update({ where: { id: fis.id }, data: { isConfident: emin } })
    return { silindi: false }
  })
}

/**
 * Açılış fişini ELLE satırlarla açar. Başlangıçta Kobipo'da bakiye yoksa açılış fişi
 * kendiliğinden doğmaz (satırsız taslak onaylanamaz ve yıl sonu kapanışını kilitlerdi);
 * Kobipo'da tutulmayan açılış kalemleri (sermaye, demirbaş, kredi…) için fiş burada,
 * satırlarıyla BİRLİKTE açılır — boş başlık yazılmaz, araya giren mutabakat silmesin.
 *
 * Fiş zaten varsa açılmaz (409): boş formdan gelen satırlar mevcut elle satırların
 * yerine yazılmasın; düzenleme fişin kendisinde (`acilisElleSatirlariKaydet`).
 */
export async function acilisFisiniElleAc(ctx: Ctx, satirlar: ElleSatir[]): Promise<{ id: string }> {
  if (satirlar.length === 0) throw new FisHatasi("En az bir satır girin.")
  const varolan = await prisma.journalVoucher.findFirst({
    where: { companyId: ctx.defterId, sourceType: ACILIS_KAYNAGI, sourceId: ctx.defterId },
    select: { id: true },
  })
  if (varolan) throw new FisHatasi("Açılış fişi zaten var; satırları fişin kendisinde düzenleyin.", 409)

  const otomatik = acilisFisi(await acilisGirdisi(ctx))
  if (otomatik.satirlar.length > 0) {
    // Başlangıçta bakiye var ama fiş henüz kurulmamış (mutabakat koşmadı): önce o kurulur,
    // elle satırlar üstüne yazılır.
    const { fisId } = await acilisSenkronla(ctx)
    if (!fisId) throw new FisHatasi("Açılış fişi kurulamadı; sayfayı yenileyip tekrar deneyin.", 409)
    await acilisElleSatirlariKaydet(ctx, fisId, satirlar)
    return { id: fisId }
  }
  if (kilitliMi(ctx.ayar, otomatik.tarih)) throw new FisHatasi("Başlangıç tarihi kapanmış (kilitli) dönemde.")
  await hesaplariDogrula(ctx.defterId, satirlar)

  const { veri, emin } = acilisElleVerisi(ctx.defterId, [], satirlar, null)
  const numara = fisNumaratoru(ctx.defterId)
  for (let deneme = 0; deneme < 4; deneme++) {
    try {
      const yeni = await prisma.journalVoucher.create({
        data: {
          companyId: ctx.defterId,
          voucherNo: await numara.sonraki(otomatik.tarih),
          date: otomatik.tarih,
          description: otomatik.aciklama,
          status: "DRAFT",
          sourceType: ACILIS_KAYNAGI,
          sourceId: ctx.defterId,
          // Otomatik kısmın izi: sonraki açılış senkronu fişi "değişmemiş" görür ve dokunmaz.
          sourceHash: parmakIzi(otomatik),
          sourceCompanyId: ctx.defterId,
          kind: "ACILIS",
          isConfident: emin,
          lines: { create: veri },
        },
        select: { id: true },
      })
      await prisma.accountingSettings.update({ where: { companyId: ctx.defterId }, data: { openingVoucherId: yeni.id } })
      return yeni
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const hedef = e.meta?.target
        const noCakisti = Array.isArray(hedef) ? hedef.includes("voucherNo") : String(hedef ?? "").includes("voucherNo")
        if (!noCakisti) throw new FisHatasi("Açılış fişi bu sırada başka bir oturumda açıldı; sayfayı yenileyin.", 409)
        await numara.tazele(otomatik.tarih)
        continue
      }
      throw e
    }
  }
  throw new FisHatasi("Fiş numarası alınamadı, tekrar deneyin.", 409)
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
  // Koşullu tek cümle: okumadan bu yana onaylandıysa silinmez (kilit.server.ts).
  const { count } = await prisma.journalVoucher.deleteMany({ where: { id: fis.id, status: "DRAFT" } })
  if (count === 0) throw taslakDegil()
}
