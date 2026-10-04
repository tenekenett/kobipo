import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { kilitliMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { cozulmusEminMi, type HesapKaynagiDb, type PlanKaydi } from "@/lib/muhasebe/hesap-cozumu"
import { planHaritasi } from "@/lib/muhasebe/hesap-plani.server"
import { senkronla, type Kaynak } from "@/lib/muhasebe/senkron.server"
import { ALT_ROLLERI, VARSAYILANSIZ_ROLLER, r2, type SatirRolu } from "@/lib/muhasebe/fis"
import { kaynakTipiMi } from "@/lib/muhasebe/kaynaklar.server"

/**
 * ONAY — taslak fişin deftere işlenmesi ve onaydan doğan ÖĞRENME (plan §2.5).
 *
 * Onay kuralları (uç da, toplu onay da buradan geçer):
 *   - fiş TASLAK, tarihi kilitli dönemde değil
 *   - her satırda hesap var; hesap AKTİF ve YAPRAK (altı olmayan)
 *   - borç = alacak (kuruşu kuruşuna)
 *
 * Öğrenme YALNIZ ONAYDA olur — taslakta yanlış tıklama öğretmesin. Satırda elle
 * seçilmiş (USER) hesap, satırın öğrenme anahtarlarına bağlanır; öğrenilmiş hesap
 * aynen onaylandıysa eşleşme TEYİT edilir (`hits++`). Öğrenilenler diğer taslaklara
 * hemen yayılır (`taslaklariYenidenCoz`): aynı tedarikçinin öbür faturası "emin"e geçer.
 */

export class FisHatasi extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

const SATIR_SECIMI = {
  id: true,
  side: true,
  amount: true,
  accountId: true,
  accountSource: true,
  learnKeys: true,
  role: true,
  account: { select: { id: true, code: true, isActive: true, _count: { select: { children: true } } } },
} as const

async function fisOku(ctx: Ctx, fisId: string) {
  const fis = await prisma.journalVoucher.findFirst({
    where: { id: fisId, companyId: ctx.defterId },
    select: {
      id: true,
      status: true,
      date: true,
      sourceType: true,
      sourceId: true,
      sourceChangedAt: true,
      lines: { select: SATIR_SECIMI, orderBy: { order: "asc" } },
    },
  })
  if (!fis) throw new FisHatasi("Fiş bulunamadı", 404)
  return fis
}

/** Onaya engel olan ilk sorun; yoksa null. Saf (veri verilir). */
export function onayEngeli(fis: {
  status: string
  kilitli: boolean
  lines: Array<{
    side: string
    amount: unknown
    account: { code: string; isActive: boolean; _count: { children: number } } | null
  }>
}): string | null {
  if (fis.status !== "DRAFT") return "Fiş zaten onaylı."
  if (fis.kilitli) return "Fişin tarihi kapanmış (kilitli) dönemde."
  if (fis.lines.length === 0) return "Fişte satır yok."
  const hesapsiz = fis.lines.filter((l) => !l.account).length
  if (hesapsiz) return `${hesapsiz} satırda hesap seçilmedi.`
  const pasif = fis.lines.find((l) => l.account && !l.account.isActive)
  if (pasif) return `${pasif.account!.code} hesabı pasif.`
  const ana = fis.lines.find((l) => l.account && l.account._count.children > 0)
  if (ana) return `${ana.account!.code} alt hesabı olan bir hesap — alt hesaplardan birini seçin.`
  const borc = r2(fis.lines.filter((l) => l.side === "DEBIT").reduce((a, l) => a + Number(l.amount), 0))
  const alacak = r2(fis.lines.filter((l) => l.side === "CREDIT").reduce((a, l) => a + Number(l.amount), 0))
  if (borc !== alacak) return `Fiş dengesiz: borç ${borc.toFixed(2)} ≠ alacak ${alacak.toFixed(2)}.`
  return null
}

export async function fisOnayla(
  ctx: Ctx,
  fisId: string,
  kullaniciId: string,
): Promise<{ ogrenilen: string[] }> {
  const fis = await fisOku(ctx, fisId)
  const engel = onayEngeli({ ...fis, kilitli: kilitliMi(ctx.ayar, fis.date) })
  if (engel) throw new FisHatasi(engel)

  const guncellendi = await prisma.journalVoucher.updateMany({
    where: { id: fisId, status: "DRAFT" },
    data: { status: "POSTED", approvedAt: new Date(), approvedBy: kullaniciId, isConfident: true },
  })
  if (guncellendi.count === 0) throw new FisHatasi("Fiş başka bir oturumda onaylandı.", 409)

  return { ogrenilen: await onaydanOgren(ctx.defterId, fis.lines, kullaniciId) }
}

/** Onaylanan satırlardan öğren. Döner: değişen/teyit edilen anahtarlar. */
async function onaydanOgren(
  defterId: string,
  satirlar: Array<{ accountId: string | null; accountSource: string; learnKeys: string[] }>,
  kullaniciId: string,
): Promise<string[]> {
  const degisen: string[] = []
  for (const s of satirlar) {
    if (!s.accountId || s.learnKeys.length === 0) continue
    if (s.accountSource === "USER") {
      for (const key of s.learnKeys) {
        const mevcut = await prisma.accountMappingRule.findUnique({
          where: { companyId_key: { companyId: defterId, key } },
          select: { accountId: true },
        })
        if (mevcut?.accountId === s.accountId) {
          await prisma.accountMappingRule.update({
            where: { companyId_key: { companyId: defterId, key } },
            data: { hits: { increment: 1 }, updatedBy: kullaniciId },
          })
        } else {
          await prisma.accountMappingRule.upsert({
            where: { companyId_key: { companyId: defterId, key } },
            create: { companyId: defterId, key, accountId: s.accountId, updatedBy: kullaniciId },
            update: { accountId: s.accountId, hits: 1, updatedBy: kullaniciId },
          })
          degisen.push(key)
        }
      }
    } else if (s.accountSource === "LEARNED") {
      await prisma.accountMappingRule.updateMany({
        where: { companyId: defterId, key: { in: s.learnKeys }, accountId: s.accountId },
        data: { hits: { increment: 1 } },
      })
    }
  }
  return degisen
}

/** Toplu onay — yalnız "emin" taslaklar. Engellenen fiş atlanır ve sayılır. */
export async function topluOnayla(
  ctx: Ctx,
  fisIds: string[],
  kullaniciId: string,
): Promise<{ onaylanan: number; atlanan: Array<{ id: string; sebep: string }> }> {
  const adaylar = await prisma.journalVoucher.findMany({
    where: { id: { in: fisIds }, companyId: ctx.defterId, status: "DRAFT", isConfident: true },
    select: { id: true },
  })
  const adaySet = new Set(adaylar.map((a) => a.id))
  const atlanan: Array<{ id: string; sebep: string }> = fisIds
    .filter((id) => !adaySet.has(id))
    .map((id) => ({ id, sebep: "Emin değil ya da taslak değil" }))
  // Toplu: adaylar satırlarıyla TEK okumada, onay tek UPDATE'te, öğrenme gruplanarak.
  // Fiş başına fisOnayla (4+ sorgu) 300 fişte dakikalar sürüyordu. Kural aynı: onayEngeli.
  const fisler = await prisma.journalVoucher.findMany({
    where: { id: { in: [...adaySet] }, companyId: ctx.defterId },
    select: { id: true, status: true, date: true, lines: { select: SATIR_SECIMI } },
  })
  const onaylanacak: typeof fisler = []
  for (const f of fisler) {
    const engel = onayEngeli({ ...f, kilitli: kilitliMi(ctx.ayar, f.date) })
    if (engel) atlanan.push({ id: f.id, sebep: engel })
    else onaylanacak.push(f)
  }
  if (onaylanacak.length === 0) return { onaylanan: 0, atlanan }
  const { count: onaylanan } = await prisma.journalVoucher.updateMany({
    where: { id: { in: onaylanacak.map((f) => f.id) }, status: "DRAFT" },
    data: { status: "POSTED", approvedAt: new Date(), approvedBy: kullaniciId, isConfident: true },
  })

  const satirlar = onaylanacak.flatMap((f) => f.lines)
  // Elle seçilmiş (USER) satırlar seyrek: tek tek öğrenilir (kural yazımı fisOnayla ile aynı).
  const ogrenilen = await onaydanOgren(
    ctx.defterId,
    satirlar.filter((s) => s.accountSource === "USER"),
    kullaniciId,
  )
  // Öğrenilmiş hesabı aynen onaylanan satırlar: (anahtar, hesap) başına tek artırım.
  const teyit = new Map<string, { key: string; accountId: string; n: number }>()
  for (const s of satirlar) {
    if (s.accountSource !== "LEARNED" || !s.accountId) continue
    for (const key of s.learnKeys) {
      const k = `${key}\u0000${s.accountId}`
      const t = teyit.get(k) ?? { key, accountId: s.accountId, n: 0 }
      t.n++
      teyit.set(k, t)
    }
  }
  for (const t of teyit.values()) {
    await prisma.accountMappingRule.updateMany({
      where: { companyId: ctx.defterId, key: t.key, accountId: t.accountId },
      data: { hits: { increment: t.n } },
    })
  }
  const ogrenildi = ogrenilen.length > 0
  if (ogrenildi) await taslaklariYenidenCoz(ctx.defterId)
  return { onaylanan, atlanan }
}

/** Onaylı fişi taslağa döndür (yalnız açık dönemde). */
export async function fisGeriAl(ctx: Ctx, fisId: string): Promise<void> {
  const fis = await fisOku(ctx, fisId)
  if (fis.status !== "POSTED") throw new FisHatasi("Fiş taslak durumda.")
  if (kilitliMi(ctx.ayar, fis.date)) throw new FisHatasi("Fişin tarihi kapanmış (kilitli) dönemde.")
  await prisma.journalVoucher.update({
    where: { id: fisId },
    data: { status: "DRAFT", approvedAt: null, approvedBy: null },
  })
  await isaretiTazele(fisId)
}

/** Taslağın güveni satırlardan yeniden hesaplanır. */
async function isaretiTazele(fisId: string) {
  await isaretleriTazele([fisId])
}

/** Fişlerin "emin" işaretini satırlarından yeniden kurar — tek okuma, en çok iki yazma. */
async function isaretleriTazele(fisIds: string[]) {
  if (fisIds.length === 0) return
  const satirlar = await prisma.journalVoucherLine.findMany({
    where: { voucherId: { in: fisIds } },
    select: { voucherId: true, accountId: true, accountSource: true, role: true },
  })
  const fisBasina = new Map<string, typeof satirlar>()
  for (const s of satirlar) fisBasina.set(s.voucherId, [...(fisBasina.get(s.voucherId) ?? []), s])
  const emin: string[] = []
  const degil: string[] = []
  for (const id of fisIds) {
    const ss = fisBasina.get(id) ?? []
    const ok =
      ss.length > 0 &&
      ss.every((s) =>
        cozulmusEminMi({ accountId: s.accountId, accountSource: s.accountSource as HesapKaynagiDb, rol: s.role as SatirRolu }),
      )
    ;(ok ? emin : degil).push(id)
  }
  if (emin.length) await prisma.journalVoucher.updateMany({ where: { id: { in: emin } }, data: { isConfident: true } })
  if (degil.length) await prisma.journalVoucher.updateMany({ where: { id: { in: degil } }, data: { isConfident: false } })
}

/**
 * "Belge değişti" — onaylı fişi kaynağın BUGÜNKÜ hâlinden yeniden üretir. Onaylı
 * fişteki hesaplar elle seçilmiş sayılır ve aynı satırda korunur; değişen satır
 * yeniden çözülür. Fiş taslağa döner, tekrar onay ister. Kaynak artık fişe girmiyorsa
 * (iptal/silindi) fiş silinir.
 */
export async function fisYenidenUret(ctx: Ctx, fisId: string): Promise<{ silindi: boolean }> {
  const fis = await fisOku(ctx, fisId)
  if (!fis.sourceId || !kaynakTipiMi(fis.sourceType)) {
    throw new FisHatasi("Bu fiş bir belgeden üretilmedi; yeniden üretilemez.")
  }
  if (kilitliMi(ctx.ayar, fis.date)) throw new FisHatasi("Fişin tarihi kapanmış (kilitli) dönemde.")
  await prisma.$transaction([
    prisma.journalVoucherLine.updateMany({
      where: { voucherId: fisId, accountId: { not: null }, accountSource: { in: ["LEARNED", "DEFAULT"] } },
      data: { accountSource: "USER" },
    }),
    prisma.journalVoucher.update({
      where: { id: fisId },
      // İz silinir ki senkron fişi "değişmiş taslak" olarak görüp yeniden kursun.
      data: { status: "DRAFT", approvedAt: null, approvedBy: null, sourceHash: null, sourceChangedAt: null },
    }),
  ])
  const kaynak: Kaynak = { tip: fis.sourceType, id: fis.sourceId }
  await senkronla(ctx, { kaynaklar: [kaynak] })
  const kaldi = await prisma.journalVoucher.findUnique({ where: { id: fisId }, select: { id: true } })
  return { silindi: !kaldi }
}

/**
 * Taslak satırlarının hesabını elle değiştir (USER). `accountId: null` seçimi kaldırır
 * (satır yeniden çözülür). Hesap firmanın planında, aktif ve yaprak olmalı.
 */
export async function satirHesaplariniDegistir(
  ctx: Ctx,
  fisId: string,
  degisiklikler: Array<{ satirId: string; accountId: string | null }>,
): Promise<void> {
  const fis = await fisOku(ctx, fisId)
  if (fis.status !== "DRAFT") throw new FisHatasi("Onaylı fişin hesabı değiştirilemez; önce geri alın.")
  if (kilitliMi(ctx.ayar, fis.date)) throw new FisHatasi("Fişin tarihi kapanmış (kilitli) dönemde.")
  const satirIds = new Set(fis.lines.map((l) => l.id))
  const hesapIds = degisiklikler.map((d) => d.accountId).filter(Boolean) as string[]
  const hesaplar = await prisma.accountPlan.findMany({
    where: { id: { in: hesapIds }, companyId: ctx.defterId },
    select: { id: true, code: true, isActive: true, _count: { select: { children: true } } },
  })
  const hesapMap = new Map(hesaplar.map((h) => [h.id, h]))
  for (const d of degisiklikler) {
    if (!satirIds.has(d.satirId)) throw new FisHatasi("Satır bu fişe ait değil.")
    if (d.accountId) {
      const h = hesapMap.get(d.accountId)
      if (!h) throw new FisHatasi("Hesap bu firmanın planında yok.")
      if (!h.isActive) throw new FisHatasi(`${h.code} hesabı pasif.`)
      if (h._count.children > 0) throw new FisHatasi(`${h.code} alt hesabı olan bir hesap — alt hesaplardan birini seçin.`)
    }
  }
  await prisma.$transaction(
    degisiklikler.map((d) =>
      prisma.journalVoucherLine.update({
        where: { id: d.satirId },
        data: d.accountId ? { accountId: d.accountId, accountSource: "USER" } : { accountId: null, accountSource: "NONE" },
      }),
    ),
  )
  if (degisiklikler.some((d) => !d.accountId)) await taslaklariYenidenCoz(ctx.defterId, [fisId])
  await isaretiTazele(fisId)
}

/**
 * Taslak satırlarını güncel kurallarla YENİDEN ÇÖZER: öğrenme ya da hesap planı
 * değişince (alt hesap açıldı, hesap pasife alındı) çağrılır. Elle seçilmiş (USER)
 * ve alt hesap (CARI) satırlarına dokunulmaz. Kural sırası `satirlariCoz` ile aynı:
 * öğrenilmiş → varsayılan (önerilen kod) → hesapsız.
 */
export async function taslaklariYenidenCoz(defterId: string, fisIds?: string[]): Promise<number> {
  const [plan, kurallar] = await Promise.all([
    planHaritasi(defterId),
    prisma.accountMappingRule.findMany({
      where: { companyId: defterId },
      select: { key: true, accountId: true },
    }),
  ])
  const planById = new Map<string, PlanKaydi>([...plan.values()].map((h) => [h.id, h]))
  const kuralMap = new Map(kurallar.map((k) => [k.key, k.accountId]))
  const uygun = (id: string | null | undefined) => {
    const h = id ? planById.get(id) : undefined
    return h && h.aktif && h.yaprak ? h : null
  }

  const satirlar = await prisma.journalVoucherLine.findMany({
    where: {
      companyId: defterId,
      accountSource: { in: ["LEARNED", "DEFAULT", "NONE"] },
      voucher: { status: "DRAFT", ...(fisIds ? { id: { in: fisIds } } : {}) },
    },
    select: { id: true, voucherId: true, accountId: true, accountSource: true, learnKeys: true, suggestedCode: true, role: true },
  })
  const degisen: Array<{ id: string; accountId: string | null; accountSource: HesapKaynagiDb }> = []
  for (const s of satirlar) {
    // Alt hesap satırı (cari/kasa/personel) kaydın kendi hesabına bağlıdır; ana koda düşmez.
    if (ALT_ROLLERI.has(s.role as SatirRolu)) continue
    let yeni: { accountId: string | null; accountSource: HesapKaynagiDb } = { accountId: null, accountSource: "NONE" }
    const ogrenilen = s.learnKeys.map((k) => uygun(kuralMap.get(k))).find(Boolean)
    if (ogrenilen) yeni = { accountId: ogrenilen.id, accountSource: "LEARNED" }
    else if (!VARSAYILANSIZ_ROLLER.has(s.role as SatirRolu)) {
      const v = uygun(plan.get(s.suggestedCode)?.id)
      if (v) yeni = { accountId: v.id, accountSource: "DEFAULT" }
    }
    if (yeni.accountId !== s.accountId || yeni.accountSource !== s.accountSource) degisen.push({ id: s.id, ...yeni })
  }
  // Tek UPDATE … FROM (VALUES …) — satır başına UPDATE uzak veritabanında dakikalar sürüyordu.
  for (let i = 0; i < degisen.length; i += 1000) {
    const degerler = degisen.slice(i, i + 1000).map((d) => Prisma.sql`(${d.id}, ${d.accountId}, ${d.accountSource})`)
    await prisma.$executeRaw`
      UPDATE journal_voucher_lines AS l SET "accountId" = v.aid, "accountSource" = v.src
      FROM (VALUES ${Prisma.join(degerler)}) AS v(id, aid, src)
      WHERE l.id = v.id
    `
  }
  const degisenIds = new Set(degisen.map((d) => d.id))
  const etkilenen = [...new Set(satirlar.filter((s) => degisenIds.has(s.id)).map((s) => s.voucherId))]
  await isaretleriTazele(etkilenen)
  return etkilenen.length
}

export function fisHatasiMi(e: unknown): e is FisHatasi {
  return e instanceof FisHatasi
}
