import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { TEKDUZEN_HESAP_PLANI } from "@/lib/muhasebe/tekduzen"
import type { AltHesapRef } from "@/lib/muhasebe/fis"
import type { PlanKaydi } from "@/lib/muhasebe/hesap-cozumu"
import {
  altAnahtar,
  altHesapAdi,
  altHesapAnaKodu,
  altHesapGrupAdi,
  grupKodu,
  hesapDuzeyi,
  hesapTuruKoddan,
  ortakAltKod,
  sonrakiAltKod,
  ustHesapKodu,
} from "@/lib/muhasebe/hesap-plani"

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Tekdüzen planını firmaya yazar — İDEMPOTENT. Aynı kodlu mevcut hesap korunur
 * (adı/durumu değiştirilmez), yalnız eksik olan açılır ve üst hesap bağı kurulur.
 * Canlıda planı elle kurmuş tek firma var (3 hesap); onların hesapları yerinde kalır.
 */
export async function planKur(defterId: string): Promise<{ eklenen: number }> {
  const mevcut = await prisma.accountPlan.findMany({
    where: { companyId: defterId },
    select: { id: true, code: true, parentId: true },
  })
  const kodlar = new Map(mevcut.map((h) => [h.code, h]))
  const eksik = TEKDUZEN_HESAP_PLANI.filter((h) => !kodlar.has(h.kod))
  if (eksik.length > 0) {
    await prisma.accountPlan.createMany({
      data: eksik.map((h) => ({
        companyId: defterId,
        code: h.kod,
        name: h.ad,
        type: h.tur,
        level: h.duzey,
      })),
      skipDuplicates: true,
    })
  }

  // Üst hesap bağları (eksik olanlar). Tek sorguda: kod → id haritasından.
  const tum = await prisma.accountPlan.findMany({
    where: { companyId: defterId },
    select: { id: true, code: true, parentId: true },
  })
  const idByKod = new Map(tum.map((h) => [h.code, h.id]))
  const bagla: Array<{ id: string; parentId: string }> = []
  for (const h of tum) {
    if (h.parentId) continue
    const ust = ustHesapKodu(h.code)
    const ustId = ust ? idByKod.get(ust) : undefined
    if (ustId) bagla.push({ id: h.id, parentId: ustId })
  }
  for (let i = 0; i < bagla.length; i += 200) {
    await prisma.$transaction(
      bagla.slice(i, i + 200).map((b) => prisma.accountPlan.update({ where: { id: b.id }, data: { parentId: b.parentId } })),
    )
  }
  return { eklenen: eksik.length }
}

/** Firmanın planı: koda göre, yaprak bilgisiyle (altı olmayan hesap). */
export async function planHaritasi(defterId: string, db: Db = prisma): Promise<Map<string, PlanKaydi>> {
  const hesaplar = await db.accountPlan.findMany({
    where: { companyId: defterId },
    select: { id: true, code: true, isActive: true, parentId: true },
  })
  const ebeveyn = new Set(hesaplar.map((h) => h.parentId).filter(Boolean) as string[])
  return new Map(
    hesaplar.map((h) => [h.code, { id: h.id, kod: h.code, aktif: h.isActive, yaprak: !ebeveyn.has(h.id) }]),
  )
}

const BAG_ALANI = {
  musteri: "customerId",
  tedarikci: "supplierId",
  personel: "employeeId",
  finans: "financialAccountId",
} as const

/** Kayıt adına VKN/TCKN eklemek için (yalnız cari). */
async function vergiNumaralari(refs: AltHesapRef[]): Promise<Map<string, string | null>> {
  const musteri = refs.filter((r) => r.tur === "musteri" && r.id).map((r) => r.id!)
  const tedarikci = refs.filter((r) => r.tur === "tedarikci" && r.id).map((r) => r.id!)
  const [m, t] = await Promise.all([
    musteri.length
      ? prisma.customer.findMany({ where: { id: { in: musteri } }, select: { id: true, taxNumber: true, name: true } })
      : [],
    tedarikci.length
      ? prisma.supplier.findMany({ where: { id: { in: tedarikci } }, select: { id: true, taxNumber: true, name: true } })
      : [],
  ])
  const out = new Map<string, string | null>()
  for (const r of m) out.set(`musteri:${r.id}`, r.taxNumber)
  for (const r of t) out.set(`tedarikci:${r.id}`, r.taxNumber)
  return out
}

/**
 * Kayıtların alt hesaplarını bulur, olmayanı AÇAR (120.01.0001 …). Döner:
 * `altAnahtar(ref)` → plan kaydı. Kayıt başına tek alt hesap: bağ kolonları
 * (`customerId`, `supplierId`, `employeeId`, `financialAccountId`) tekildir;
 * eşzamanlı iki senkron aynı cariyi açmaya kalkarsa ikincisi çakışmayı yakalayıp
 * mevcut satırı okur.
 */
export async function altHesaplariHazirla(
  defterId: string,
  refs: AltHesapRef[],
): Promise<Map<string, PlanKaydi>> {
  const tekil = new Map<string, AltHesapRef>()
  for (const r of refs) tekil.set(altAnahtar(r), r)
  const sonuc = new Map<string, PlanKaydi>()
  if (tekil.size === 0) return sonuc

  const bul = async () => {
    const ors: Prisma.AccountPlanWhereInput[] = []
    const ortakKodlar: string[] = []
    for (const r of tekil.values()) {
      if (r.id) ors.push({ [BAG_ALANI[r.tur]]: r.id })
      else ortakKodlar.push(ortakAltKod(altHesapAnaKodu(r)))
    }
    if (ortakKodlar.length) ors.push({ code: { in: ortakKodlar } })
    const bulunan = await prisma.accountPlan.findMany({
      where: { companyId: defterId, OR: ors },
      select: {
        id: true,
        code: true,
        isActive: true,
        customerId: true,
        supplierId: true,
        employeeId: true,
        financialAccountId: true,
        _count: { select: { children: true } },
      },
    })
    for (const h of bulunan) {
      const kayit: PlanKaydi = { id: h.id, kod: h.code, aktif: h.isActive, yaprak: h._count.children === 0 }
      if (h.customerId) sonuc.set(`musteri:${h.customerId}`, kayit)
      else if (h.supplierId) sonuc.set(`tedarikci:${h.supplierId}`, kayit)
      else if (h.employeeId) sonuc.set(`personel:${h.employeeId}`, kayit)
      else if (h.financialAccountId) sonuc.set(`finans:${h.financialAccountId}`, kayit)
      else {
        for (const r of tekil.values()) {
          if (!r.id && ortakAltKod(altHesapAnaKodu(r)) === h.code) sonuc.set(altAnahtar(r), kayit)
        }
      }
    }
  }
  await bul()

  const eksik = [...tekil.entries()].filter(([k]) => !sonuc.has(k)).map(([, r]) => r)
  if (eksik.length === 0) return sonuc

  const vkn = await vergiNumaralari(eksik)
  // Grup hesapları (120.01) ve ana hesap id'leri.
  const anaKodlar = [...new Set(eksik.map(altHesapAnaKodu))]
  for (const ana of anaKodlar) {
    const anaHesap = await prisma.accountPlan.findUnique({
      where: { companyId_code: { companyId: defterId, code: ana } },
      select: { id: true },
    })
    if (!anaHesap) continue // plan kurulmamış: satır hesapsız kalır
    const ornek = eksik.find((r) => altHesapAnaKodu(r) === ana)!
    await prisma.accountPlan.upsert({
      where: { companyId_code: { companyId: defterId, code: grupKodu(ana) } },
      create: {
        companyId: defterId,
        code: grupKodu(ana),
        name: altHesapGrupAdi(ornek),
        type: hesapTuruKoddan(ana),
        level: hesapDuzeyi(grupKodu(ana)),
        parentId: anaHesap.id,
      },
      update: {},
    })
  }

  // Kod sırası grup başına BİR KEZ okunur, bellekte ilerletilir; çakışmada yeniden okunur.
  const kodSirasi = new Map<string, Set<string>>()
  const kodlariOku = async (ana: string) => {
    const kardes = await prisma.accountPlan.findMany({
      where: { companyId: defterId, code: { startsWith: `${grupKodu(ana)}.` } },
      select: { code: true },
    })
    kodSirasi.set(ana, new Set(kardes.map((k) => k.code)))
  }
  const grupIds = new Map<string, string>()

  for (const r of eksik) {
    const ana = altHesapAnaKodu(r)
    if (!grupIds.has(ana)) {
      const grup = await prisma.accountPlan.findUnique({
        where: { companyId_code: { companyId: defterId, code: grupKodu(ana) } },
        select: { id: true },
      })
      if (!grup) continue
      grupIds.set(ana, grup.id)
    }
    const grupId = grupIds.get(ana)!
    const ad = altHesapAdi(r.ad, r.id ? vkn.get(altAnahtar(r)) : null)
    for (let deneme = 0; deneme < 4; deneme++) {
      if (!kodSirasi.has(ana)) await kodlariOku(ana)
      const kodlar = kodSirasi.get(ana)!
      const kod = r.id ? sonrakiAltKod(ana, kodlar) : ortakAltKod(ana)
      try {
        const h = await prisma.accountPlan.create({
          data: {
            companyId: defterId,
            code: kod,
            name: ad,
            type: hesapTuruKoddan(ana),
            level: hesapDuzeyi(kod),
            parentId: grupId,
            ...(r.id ? { [BAG_ALANI[r.tur]]: r.id } : {}),
          },
          select: { id: true, code: true, isActive: true },
        })
        kodlar.add(h.code)
        sonuc.set(altAnahtar(r), { id: h.id, kod: h.code, aktif: h.isActive, yaprak: true })
        break
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          // Kod ya da bağ çakıştı (eşzamanlı senkron): mevcut satırı oku, yoksa yeni numara dene.
          await bul()
          if (sonuc.has(altAnahtar(r))) break
          kodSirasi.delete(ana)
          continue
        }
        throw e
      }
    }
  }
  return sonuc
}
