import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import {
  MUHASEBE_MODULU,
  defterBaglami,
  fisUretilirMi,
  kilitliMi,
  type DefterBaglami,
  type MuhasebeAyari,
} from "@/lib/muhasebe/defter.server"
import { KAYNAK_TIPLERI, type KaynakFisi, type KaynakTipi } from "@/lib/muhasebe/kaynaklar.server"
import {
  parmakIzi,
  satirAnahtari,
  satirlariCoz,
  type CozulmusSatir,
  type PlanKaydi,
} from "@/lib/muhasebe/hesap-cozumu"
import { altHesaplariHazirla, planHaritasi } from "@/lib/muhasebe/hesap-plani.server"
import type { AltHesapRef, HazirFis, HesapEslesmeleri } from "@/lib/muhasebe/fis"

/**
 * SENKRON — kaynak kayıt ile fişi aynı tutan TEK fonksiyon (plan §2.3).
 *
 *   kaynak fişe girer, fiş yok              → TASLAK açılır
 *   taslak var, kaynağın izi değişti        → satırlar yeniden üretilir (elle seçilen hesap korunur)
 *   taslak var, kaynak silindi / fişe girmez → taslak silinir
 *   ONAYLI fiş, iz değişti ya da kaynak gitti → fişe DOKUNULMAZ, "belge değişti" işaretlenir
 *   ONAYLI fiş, iz eskisine döndü           → işaret kalkar
 *
 * İki tetik aynı fonksiyona gelir: belgeyi yazan yol (`muhasebeyeBildir`, tek kayıt)
 * ve mutabakat (Fişler açılırken / kurulumda — başlangıç tarihinden bugüne hepsi).
 * Bir yazma yolu bildirmeyi unutsa da fiş eksik kalmaz; sapma mutabakatta sayılır.
 *
 * Kaynağın tarihi başlangıçtan önceyse fişe girmez (açılış fişindedir). Kilitli
 * döneme (kapanmış yıl) YENİ fiş açılmaz; kayıt "kilitli döneme düşen" diye sayılır.
 */

export type Kaynak = { tip: KaynakTipi; id: string }

type MevcutFis = {
  id: string
  sourceType: string
  sourceId: string | null
  status: string
  sourceHash: string | null
  sourceChangedAt: Date | null
  date: Date
}

type Eylem =
  | { tur: "ac"; kaynak: KaynakFisi; fis: HazirFis; iz: string }
  | { tur: "yenile"; kaynak: KaynakFisi; fis: HazirFis; iz: string; mevcut: MevcutFis }
  | { tur: "sil"; mevcut: MevcutFis }
  | { tur: "isaretle"; mevcut: MevcutFis }
  | { tur: "isaret-kaldir"; mevcut: MevcutFis }

export type SenkronOzeti = {
  acilan: number
  yenilenen: number
  silinen: number
  isaretlenen: number
  /** Uygulanmayı bekleyen eylem (limit doldu) — istemci döngüsü buna bakar. */
  kalan: number
  /** Kuru girilmemiş dövizli belge — fiş kurulamadı. */
  kurYok: Array<{ tip: KaynakTipi; id: string; sebep: string }>
  /** Kilitli (kapanmış) döneme düşen, fişi açılamayan kayıtlar. */
  kilitli: Array<{ tip: KaynakTipi; id: string }>
}

const anahtar = (tip: string, id: string | null) => `${tip}:${id ?? ""}`

/** Öğrenilmiş eşleşmeler (yalnız aktif hesaplara). */
export async function ogrenilenEslesmeler(defterId: string): Promise<HesapEslesmeleri> {
  const kurallar = await prisma.accountMappingRule.findMany({
    where: { companyId: defterId, account: { isActive: true } },
    select: { key: true, account: { select: { code: true } } },
  })
  return { ogrenilen: Object.fromEntries(kurallar.map((k) => [k.key, k.account.code])), cariHesaplari: {} }
}

/**
 * Belgeyi yazan yolların çağırdığı kapı. ASLA FIRLATMAZ: fiş yazımı belgenin
 * yazımını düşürmez — hata loglanır, mutabakat sonradan yakalar. Modül kapalıysa
 * ya da kurulum yapılmadıysa hiçbir şey yapmaz.
 */
export async function muhasebeyeBildir(companyId: string | null | undefined, kaynaklar: Kaynak[]): Promise<void> {
  if (!companyId || kaynaklar.length === 0) return
  try {
    // Ucuz ön kapı: modülü kapalı firmada (çoğunluk) tek sorguyla dön — bu çağrı her
    // belge yazımında çalışıyor.
    const c = await prisma.company.findUnique({
      where: { id: companyId },
      select: { parentCompanyId: true, disabledModules: true, parentCompany: { select: { disabledModules: true } } },
    })
    const kapali = (c?.parentCompanyId ? c.parentCompany?.disabledModules : c?.disabledModules) ?? [MUHASEBE_MODULU]
    if (kapali.includes(MUHASEBE_MODULU)) return
    const ctx = await defterBaglami(companyId)
    if (!fisUretilirMi(ctx)) return
    await senkronla(ctx, { kaynaklar })
  } catch (e) {
    console.error("[muhasebe] fiş senkronu başarısız (mutabakat yakalayacak):", kaynaklar, e)
  }
}

export async function senkronla(
  ctx: DefterBaglami & { ayar: MuhasebeAyari },
  opts: {
    /** Yalnız bu kaynaklar; verilmezse mutabakat (başlangıçtan bugüne hepsi). */
    kaynaklar?: Kaynak[]
    /** Mutabakatta tek seferde uygulanacak en çok eylem (istemci döngüsü sayfalar). */
    limit?: number
    /** Yalnız say, yazma. */
    kuru?: boolean
  } = {},
): Promise<SenkronOzeti> {
  const ozet: SenkronOzeti = { acilan: 0, yenilenen: 0, silinen: 0, isaretlenen: 0, kalan: 0, kurYok: [], kilitli: [] }
  const eslesme = await ogrenilenEslesmeler(ctx.defterId)
  const yukCtx = { sirketIds: ctx.sirketIds, baslangic: ctx.ayar.startDate, eslesme }

  // ── Kaynakları oku ────────────────────────────────────────────────────────
  const istenen = new Map<string, Kaynak>()
  const kaynakFisleri: KaynakFisi[] = []
  const tipler = Object.keys(KAYNAK_TIPLERI) as KaynakTipi[]
  if (opts.kaynaklar) {
    for (const k of opts.kaynaklar) istenen.set(anahtar(k.tip, k.id), k)
    const kaynaklar = opts.kaynaklar
    const parcalar = await Promise.all(
      tipler.map((tip) => {
        const ids = kaynaklar.filter((k) => k.tip === tip).map((k) => k.id)
        return ids.length ? KAYNAK_TIPLERI[tip].yukle(yukCtx, { ids }) : []
      }),
    )
    for (const p of parcalar) kaynakFisleri.push(...p)
  } else {
    // Türler birbirinden bağımsız: paralel okunur (sırayla 11 tur gecikme ekran açılışını bekletiyordu).
    const parcalar = await Promise.all(tipler.map((tip) => KAYNAK_TIPLERI[tip].yukle(yukCtx, {})))
    for (const p of parcalar) kaynakFisleri.push(...p)
  }
  // Başka defterin kaydı (id elle verildiyse) işlenmez.
  const sirketSet = new Set(ctx.sirketIds)
  const istenenFis = new Map<string, KaynakFisi>()
  for (const k of kaynakFisleri) if (sirketSet.has(k.sirketId)) istenenFis.set(anahtar(k.tip, k.id), k)

  // ── Mevcut fişler ─────────────────────────────────────────────────────────
  const mevcutlar = await prisma.journalVoucher.findMany({
    where: opts.kaynaklar
      ? {
          companyId: ctx.defterId,
          OR: opts.kaynaklar.map((k) => ({ sourceType: k.tip, sourceId: k.id })),
        }
      : { companyId: ctx.defterId, sourceType: { in: tipler } },
    select: { id: true, sourceType: true, sourceId: true, status: true, sourceHash: true, sourceChangedAt: true, date: true },
  })
  const mevcutMap = new Map(mevcutlar.map((m) => [anahtar(m.sourceType, m.sourceId), m]))

  // ── Eylemler ──────────────────────────────────────────────────────────────
  const eylemler: Eylem[] = []
  const kaynagiGitti = (m: MevcutFis) => {
    if (m.status === "POSTED") {
      if (!m.sourceChangedAt) eylemler.push({ tur: "isaretle", mevcut: m })
    } else if (kilitliMi(ctx.ayar, m.date)) {
      // Kilitli dönemde taslak kalmamalı (kapanış onları ister); yine de silinmez.
    } else {
      eylemler.push({ tur: "sil", mevcut: m })
    }
  }

  for (const [k, kf] of istenenFis) {
    const m = mevcutMap.get(k)
    const fis = kf.fis
    if (fis.durum === "kur-yok") ozet.kurYok.push({ tip: kf.tip, id: kf.id, sebep: fis.sebep })
    // Sınır HAM tarihle (açılış fişinin kaynaklarıyla aynı eksen) — bkz. kaynaklar.server.ts.
    // Satırsız fiş (0 TL'lik belge: ikram, tam iskonto) deftere girmez: onaylanamaz
    // ("Fişte satır yok") ve taslak sayıldığı için yıl sonu kapanışını kilitlerdi.
    const girer =
      fis.durum === "hazir" &&
      fis.satirlar.length > 0 &&
      (kf.giris ?? fis.tarih).getTime() >= ctx.ayar.startDate.getTime()
    if (!girer) {
      if (m) kaynagiGitti(m)
      continue
    }
    const iz = parmakIzi(fis)
    if (!m) {
      if (kilitliMi(ctx.ayar, fis.tarih)) {
        ozet.kilitli.push({ tip: kf.tip, id: kf.id })
        continue
      }
      eylemler.push({ tur: "ac", kaynak: kf, fis, iz })
      continue
    }
    if (m.status === "POSTED") {
      if (m.sourceHash === iz) {
        if (m.sourceChangedAt) eylemler.push({ tur: "isaret-kaldir", mevcut: m })
      } else if (!m.sourceChangedAt) {
        eylemler.push({ tur: "isaretle", mevcut: m })
      }
      continue
    }
    if (m.sourceHash !== iz) {
      if (kilitliMi(ctx.ayar, fis.tarih) || kilitliMi(ctx.ayar, m.date)) {
        ozet.kilitli.push({ tip: kf.tip, id: kf.id })
        continue
      }
      eylemler.push({ tur: "yenile", kaynak: kf, fis, iz, mevcut: m })
    }
  }
  // Kaynağı artık yok (silindi, tarihi başlangıçtan geriye çekildi ya da başka firmaya geçti).
  for (const [k, m] of mevcutMap) {
    if (istenenFis.has(k)) continue
    if (opts.kaynaklar && !istenen.has(k)) continue
    kaynagiGitti(m)
  }

  const uygulanacak = opts.limit != null ? eylemler.slice(0, opts.limit) : eylemler
  ozet.kalan = eylemler.length - uygulanacak.length
  if (opts.kuru) {
    for (const e of eylemler) sayac(ozet, e)
    ozet.kalan = eylemler.length
    return ozet
  }
  if (uygulanacak.length === 0) return ozet

  // ── Hesap çözümü için ortak bağlam ───────────────────────────────────────
  const yazilacak = uygulanacak.filter((e): e is Extract<Eylem, { fis: HazirFis }> => "fis" in e)
  const refs: AltHesapRef[] = []
  for (const e of yazilacak) for (const s of e.fis.satirlar) if (s.alt) refs.push(s.alt)
  const alt = refs.length ? await altHesaplariHazirla(ctx.defterId, refs) : new Map<string, PlanKaydi>()
  const plan = yazilacak.length ? await planHaritasi(ctx.defterId) : new Map<string, PlanKaydi>()
  const elleSecilen = await elleSecilenHesaplar(
    yazilacak.filter((e): e is Extract<Eylem, { tur: "yenile" }> => e.tur === "yenile").map((e) => e.mevcut.id),
    plan,
  )
  const numara = fisNumaratoru(ctx.defterId)

  // Açılacak fişler TOPLU yazılır (parça başına tek transaction); fiş başına ayrı
  // create uzak veritabanında saniyeler sürüyordu (200 fiş ≈ 5 dk). Parça çakışırsa
  // (eşzamanlı senkron) tek tek yola düşülür.
  const acilacak = uygulanacak.filter((e): e is Extract<Eylem, { tur: "ac" }> => e.tur === "ac")
  for (let i = 0; i < acilacak.length; i += FIS_PARCASI) {
    const parca = acilacak.slice(i, i + FIS_PARCASI)
    const hazir = parca.map((e) => ({ e, ...satirlariCoz(e.fis.satirlar, { plan, alt }) }))
    if (await fisleriTopluAc(ctx.defterId, hazir, numara)) {
      ozet.acilan += parca.length
      continue
    }
    for (const { e, satirlar, emin } of hazir) {
      try {
        await fisAc(ctx.defterId, e.kaynak, e.fis, e.iz, satirlar, emin, numara)
        sayac(ozet, e)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
        throw err
      }
    }
  }

  // Silme ve işaretler tek sorguda (koşullar tek tek yoldakiyle aynı).
  const idler = (tur: Eylem["tur"]) =>
    uygulanacak.filter((e) => e.tur === tur).map((e) => (e as Extract<Eylem, { mevcut: MevcutFis }>).mevcut.id)
  const silinecek = idler("sil")
  if (silinecek.length) {
    await prisma.journalVoucher.deleteMany({ where: { id: { in: silinecek }, status: "DRAFT" } })
    ozet.silinen += silinecek.length
  }
  const isaretlenecek = idler("isaretle")
  if (isaretlenecek.length) {
    await prisma.journalVoucher.updateMany({
      where: { id: { in: isaretlenecek }, status: "POSTED", sourceChangedAt: null },
      data: { sourceChangedAt: new Date() },
    })
    ozet.isaretlenen += isaretlenecek.length
  }
  const kaldirilacak = idler("isaret-kaldir")
  if (kaldirilacak.length) {
    await prisma.journalVoucher.updateMany({ where: { id: { in: kaldirilacak } }, data: { sourceChangedAt: null } })
    ozet.isaretlenen += kaldirilacak.length
  }

  // Yenilenecek fişler de parça başına tek transaction (fiş başına 5 tur yerine 4).
  // Kural değişikliğinden sonra bütün fişlerin izi değişir; tek tek yol dakikalar sürerdi.
  const yenilenecek = uygulanacak.filter((e): e is Extract<Eylem, { tur: "yenile" }> => e.tur === "yenile")
  for (let i = 0; i < yenilenecek.length; i += FIS_PARCASI) {
    const parca = yenilenecek.slice(i, i + FIS_PARCASI).map((e) => ({
      e,
      ...satirlariCoz(e.fis.satirlar, { plan, alt, kullanici: elleSecilen.get(e.mevcut.id) }),
    }))
    await fisleriTopluYenile(ctx.defterId, parca)
    ozet.yenilenen += parca.length
  }
  return ozet
}

function sayac(ozet: SenkronOzeti, e: Eylem) {
  if (e.tur === "ac") ozet.acilan++
  else if (e.tur === "yenile") ozet.yenilenen++
  else if (e.tur === "sil") ozet.silinen++
  else ozet.isaretlenen++
}

/** Taslakta elle seçilmiş (USER) hesaplar — yeniden üretimde korunur. */
async function elleSecilenHesaplar(
  fisIds: string[],
  plan: Map<string, PlanKaydi>,
): Promise<Map<string, Map<string, PlanKaydi>>> {
  const sonuc = new Map<string, Map<string, PlanKaydi>>()
  if (fisIds.length === 0) return sonuc
  const satirlar = await prisma.journalVoucherLine.findMany({
    where: { voucherId: { in: fisIds }, accountSource: "USER", accountId: { not: null } },
    select: {
      voucherId: true,
      role: true,
      side: true,
      description: true,
      learnKeys: true,
      account: { select: { code: true } },
    },
  })
  for (const s of satirlar) {
    const h = s.account ? plan.get(s.account.code) : undefined
    if (!h) continue
    const harita = sonuc.get(s.voucherId) ?? new Map<string, PlanKaydi>()
    harita.set(
      satirAnahtari({
        rol: s.role as never,
        taraf: s.side === "DEBIT" ? "B" : "A",
        aciklama: s.description ?? "",
        anahtarlar: s.learnKeys,
      }),
      h,
    )
    sonuc.set(s.voucherId, harita)
  }
  return sonuc
}

export function satirVerisi(defterId: string, s: CozulmusSatir, i: number) {
  return {
    companyId: defterId,
    order: i,
    side: s.taraf === "B" ? "DEBIT" : "CREDIT",
    amount: new Prisma.Decimal(s.tutar.toFixed(2)),
    accountId: s.accountId,
    suggestedCode: s.oneriKodu,
    role: s.rol,
    accountSource: s.accountSource,
    learnKeys: s.anahtarlar,
    description: s.aciklama,
  }
}

/**
 * Fiş numarası: "<yıl>/<6 hane>", defter içinde yıl başına sıralı (fişin AÇILDIĞI
 * sıra; yevmiye madde numarası basımda tarih sırasıyla verilir — plan §2.7).
 * Toplu senkronda yıl başına BİR KEZ okunur, bellekte ilerler; çakışmada yeniden okunur.
 */
export function fisNumaratoru(defterId: string) {
  const son = new Map<number, number>()
  const oku = async (yil: number) => {
    const rows = await prisma.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(split_part("voucherNo", '/', 2) AS INTEGER))::int AS max
      FROM journal_vouchers
      WHERE "companyId" = ${defterId} AND "voucherNo" ~ ${`^${yil}/[0-9]{1,9}$`}
    `
    son.set(yil, Number(rows[0]?.max ?? 0))
  }
  return {
    async sonraki(tarih: Date): Promise<string> {
      const yil = tarih.getUTCFullYear()
      if (!son.has(yil)) await oku(yil)
      const n = son.get(yil)! + 1
      son.set(yil, n)
      return `${yil}/${String(n).padStart(6, "0")}`
    },
    async tazele(tarih: Date) {
      await oku(tarih.getUTCFullYear())
    },
  }
}

export type FisNumaratoru = ReturnType<typeof fisNumaratoru>

async function fisAc(
  defterId: string,
  kaynak: KaynakFisi,
  fis: HazirFis,
  iz: string,
  satirlar: CozulmusSatir[],
  emin: boolean,
  numara: FisNumaratoru,
) {
  for (let deneme = 0; deneme < 4; deneme++) {
    const voucherNo = await numara.sonraki(fis.tarih)
    try {
      await prisma.journalVoucher.create({
        data: {
          companyId: defterId,
          voucherNo,
          date: fis.tarih,
          description: fis.aciklama,
          status: "DRAFT",
          sourceType: kaynak.tip,
          sourceId: kaynak.id,
          sourceHash: iz,
          sourceCompanyId: kaynak.sirketId,
          kind: fis.tur,
          isConfident: emin,
          lines: { create: satirlar.map((s, i) => satirVerisi(defterId, s, i)) },
        },
      })
      return
    } catch (err) {
      const hedef = (err as Prisma.PrismaClientKnownRequestError)?.meta?.target
      const noCakisti = Array.isArray(hedef) ? hedef.includes("voucherNo") : String(hedef ?? "").includes("voucherNo")
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && noCakisti) {
        await numara.tazele(fis.tarih)
        continue
      }
      throw err
    }
  }
  throw new Error("Fiş numarası alınamadı (4 deneme)")
}

const FIS_PARCASI = 100

/**
 * Bir parça fişi tek transaction'da açar: fişler `createManyAndReturn`, satırlar tek
 * `createMany`. Çakışmada (numara ya da aynı kaynağın fişi) hiçbiri yazılmaz, numaralar
 * tazelenir ve `false` döner — çağıran tek tek yola düşer.
 */
async function fisleriTopluAc(
  defterId: string,
  hazir: Array<{ e: Extract<Eylem, { tur: "ac" }>; satirlar: CozulmusSatir[]; emin: boolean }>,
  numara: FisNumaratoru,
): Promise<boolean> {
  const fisler: Prisma.JournalVoucherCreateManyInput[] = []
  for (const { e, emin } of hazir) {
    fisler.push({
      companyId: defterId,
      voucherNo: await numara.sonraki(e.fis.tarih),
      date: e.fis.tarih,
      description: e.fis.aciklama,
      status: "DRAFT" as const,
      sourceType: e.kaynak.tip,
      sourceId: e.kaynak.id,
      sourceHash: e.iz,
      sourceCompanyId: e.kaynak.sirketId,
      kind: e.fis.tur,
      isConfident: emin,
    })
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        const yazilan = await tx.journalVoucher.createManyAndReturn({
          data: fisler,
          select: { id: true, sourceType: true, sourceId: true },
        })
        const idByKaynak = new Map(yazilan.map((v) => [anahtar(v.sourceType, v.sourceId), v.id]))
        const satirlar = hazir.flatMap(({ e, satirlar }) => {
          const voucherId = idByKaynak.get(anahtar(e.kaynak.tip, e.kaynak.id))!
          return satirlar.map((s, i) => ({ ...satirVerisi(defterId, s, i), voucherId }))
        })
        await tx.journalVoucherLine.createMany({ data: satirlar })
      },
      { timeout: 60_000, maxWait: 10_000 },
    )
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      for (const yil of new Set(fisler.map((f) => new Date(f.date).getUTCFullYear()))) {
        await numara.tazele(new Date(Date.UTC(yil, 0, 1)))
      }
      return false
    }
    throw err
  }
}

async function fisleriTopluYenile(
  defterId: string,
  parca: Array<{ e: Extract<Eylem, { tur: "yenile" }>; satirlar: CozulmusSatir[]; emin: boolean }>,
) {
  const ids = parca.map((p) => p.e.mevcut.id)
  const basliklar = parca.map(
    ({ e, emin }) =>
      Prisma.sql`(${e.mevcut.id}, ${e.fis.tarih.toISOString()}, ${e.fis.aciklama ?? null}, ${e.fis.tur}, ${e.iz}, ${e.kaynak.sirketId}, ${emin})`,
  )
  const satirlar = parca.flatMap(({ e, satirlar }) =>
    satirlar.map((s, i) => ({ ...satirVerisi(defterId, s, i), voucherId: e.mevcut.id })),
  )
  await prisma.$transaction(
    async (tx) => {
      await tx.journalVoucherLine.deleteMany({ where: { voucherId: { in: ids } } })
      await tx.$executeRaw`
        UPDATE journal_vouchers AS j SET
          date = v.d::timestamp(3), description = v.ac, kind = v.k, "sourceHash" = v.h,
          "sourceCompanyId" = v.sc, "sourceChangedAt" = NULL, "isConfident" = v.e::boolean,
          "updatedAt" = now()
        FROM (VALUES ${Prisma.join(basliklar)}) AS v(id, d, ac, k, h, sc, e)
        WHERE j.id = v.id AND j."companyId" = ${defterId}
      `
      await tx.journalVoucherLine.createMany({ data: satirlar })
    },
    { timeout: 60_000, maxWait: 10_000 },
  )
}

/**
 * Çek/senet yazıldı: evrakın kendi fişi, cirosu ve tahsil/ödeme kasa hareketleri
 * (`CEK:<id>` / `SENET:<id>` referanslı). Silinen hareketin id'si çağıran tarafından
 * `ekHareketler` ile verilir (silindikten sonra referansla bulunamaz).
 */
export async function kiymetiBildir(
  companyId: string,
  tur: "CHECK" | "NOTE",
  id: string,
  ekHareketler: string[] = [],
): Promise<void> {
  try {
    const onek = tur === "CHECK" ? "CEK:" : "SENET:"
    const hareketler = await prisma.transaction.findMany({ where: { reference: `${onek}${id}` }, select: { id: true } })
    await muhasebeyeBildir(companyId, [
      { tip: tur, id },
      { tip: tur === "CHECK" ? "CHECK_ENDORSE" : "NOTE_ENDORSE", id },
      ...[...new Set([...hareketler.map((h) => h.id), ...ekHareketler])].map((h) => ({ tip: "TRANSACTION" as const, id: h })),
    ])
  } catch (e) {
    console.error("[muhasebe] evrak senkronu başarısız (mutabakat yakalayacak):", e)
  }
}

/** Silmeden ÖNCE: evraka bağlı kasa hareketlerinin id'leri (silinince referansla bulunamaz). */
export async function kiymetHareketleri(tur: "CHECK" | "NOTE", id: string): Promise<string[]> {
  const onek = tur === "CHECK" ? "CEK:" : "SENET:"
  return (await prisma.transaction.findMany({ where: { reference: `${onek}${id}` }, select: { id: true } })).map((h) => h.id)
}
