/**
 * SORGU KATMANI — CANLI VERİTABANINA KARŞI, İSTEĞE BAĞLI takım.
 *
 * ── Neden ayrı bir takım ────────────────────────────────────────────────────
 * `vitest.config.mts` kapsamı bilinçli olarak dar: yalnız saf fonksiyonlar,
 * veritabanı yok. O karar doğru ve bu dosya onu delmiyor — kendi yapılandırması
 * (`vitest.canli.config.mts`) ve kendi komutuyla (`npm run test:canli`) koşar,
 * `npm test` onu HİÇ görmez.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Kartların süzgeçlerinin bir kısmı SQL'in içinde ve saf testle görülemiyor:
 *   • ters-bakiye'nin MAHSUP süzgeci `ters_adet` sayacına dayanıyor; sayaç
 *     yanlış aileyi sayarsa saf test bunu göremez, çünkü ona sayaç HAZIR gelir.
 *   • donmeyen-musteri'nin "ikinci alış tarihi" alt sorgusu; bozulursa her
 *     müşteri "tek alım" görünür ve kart bütün müşteri listesini kayıp ilan eder.
 *   • yanit-bekleyen'in `BEKLEMEDE` tanımı ekranın sorgusundan geliyor
 *     (`buildIncomingWhereWithoutDate`); düz eşitliğe dönerse 36 satır 0'a düşer
 *     — bu hata bir kez yapılmış.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * Takım GERÇEK veritabanına yazar. Üç önlem var:
 *   1. Her kayıt `OTO-TEST` ön ekiyle açılır; temizlik bu ön ekten yapılır.
 *   2. `beforeAll` önce ARTIK kalmış kayıtları siler (önceki koşu çökmüş olabilir).
 *   3. `afterAll` her durumda siler; testler patlasa da fixture kalmaz.
 * Hedef firma `OTOMASYON_CANLI_FIRMA` ile seçilir (varsayılan: `reypo`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()

/** Bütün fixture'ların ortak imzası — temizlik bunun üzerinden yapılır. */
const IZ = "OTO-TEST"
const FIRMA_SLUG = process.env.OTOMASYON_CANLI_FIRMA || "reypo"

let companyId = ""
/**
 * Fixture hareketlerinin bağlanacağı kasa/banka hesabı.
 *
 * `Transaction.accountId` zorunlu. Var olan bir hesabı kullanmak yan etki
 * doğurmuyor: `FinancialAccount.balance` uygulamanın uçlarında güncelleniyor,
 * doğrudan yazılan hareket bakiyeye dokunmuyor. Hesap yoksa iz bırakan bir tane
 * açılır ve temizlikte silinir.
 */
let accountId = ""

/** Fixture'ları siler. Hem başta (artık kalmışsa) hem sonda çağrılır. */
async function temizle() {
  if (!companyId) return
  await prisma.invoice.deleteMany({ where: { companyId, invoiceNo: { startsWith: IZ } } })
  await prisma.transaction.deleteMany({ where: { companyId, description: { startsWith: IZ } } })
  await prisma.incomingInvoice.deleteMany({ where: { companyId, uuid: { startsWith: IZ } } })
  await prisma.customer.deleteMany({ where: { companyId, name: { startsWith: IZ } } })
  await prisma.financialAccount.deleteMany({ where: { companyId, name: { startsWith: IZ } } })
}

beforeAll(async () => {
  const firma = await prisma.company.findFirst({
    where: { slug: FIRMA_SLUG },
    select: { id: true, name: true },
  })
  if (!firma) throw new Error(`Hedef firma bulunamadı: ${FIRMA_SLUG}`)
  companyId = firma.id
  await temizle()

  const hesap = await prisma.financialAccount.findFirst({
    where: { companyId },
    select: { id: true },
  })
  accountId =
    hesap?.id ??
    (
      await prisma.financialAccount.create({
        data: { companyId, name: `${IZ} Kasa`, type: "CASH", currency: "TRY" },
        select: { id: true },
      })
    ).id
})

afterAll(async () => {
  await temizle()
  await prisma.$disconnect()
})

describe("ters bakiye — MAHSUP süzgeci SQL tarafında", () => {
  it("faturasız ters bakiye çıkar, ters yönde faturası olan ELENİR", async () => {
    const { tersBakiyeOzeti } = await import("./ters-bakiye")

    // 1) Temiz vaka: hiç faturası olmayan, ₺100.000 tahsilat girilmiş müşteri.
    const temiz = await prisma.customer.create({
      data: { companyId, name: `${IZ} Temiz`, slug: `oto-test-temiz-${Date.now()}` },
      select: { id: true },
    })
    await prisma.transaction.create({
      data: {
        companyId,
        accountId,
        customerId: temiz.id,
        type: "INCOME",
        amount: 100_000,
        date: new Date(),
        description: `${IZ} tahsilat`,
      },
    })

    // 2) Mahsuplu vaka: aynı tutarda tahsilat AMA cariye kayıtlı bir ALIŞ faturası.
    const mahsuplu = await prisma.customer.create({
      data: { companyId, name: `${IZ} Mahsuplu`, slug: `oto-test-mahsup-${Date.now()}` },
      select: { id: true },
    })
    await prisma.transaction.create({
      data: {
        companyId,
        accountId,
        customerId: mahsuplu.id,
        type: "INCOME",
        amount: 100_000,
        date: new Date(),
        description: `${IZ} tahsilat`,
      },
    })
    await prisma.invoice.create({
      data: {
        companyId,
        customerId: mahsuplu.id,
        invoiceNo: `${IZ}-ALIS-1`,
        slug: `oto-test-alis-${Date.now()}`,
        type: "PURCHASE",
        invoiceType: "MANUAL",
        status: "SENT",
        date: new Date(),
        totalAmount: 50_000,
        vatAmount: 0,
        netAmount: 50_000,
      },
    })

    const ozet = await tersBakiyeOzeti(companyId, "musteri")
    const adlar = (ozet?.ornekler ?? []).map((c) => c.ad)

    // Temiz vaka ₺100.000 ile listenin başında olmalı (gerçek kayıtların en
    // büyüğü ₺47.214) ve hiç faturası olmadığı SQL sayacından anlaşılmalı.
    expect(adlar[0]).toBe(`${IZ} Temiz`)
    expect(ozet?.ornekler[0].faturaAdet).toBe(0)
    expect(ozet?.faturasizAdet).toBeGreaterThan(0)

    // Mahsuplu vaka aynı tutarda olmasına rağmen listede HİÇ olmamalı.
    expect(adlar).not.toContain(`${IZ} Mahsuplu`)
  })
})

describe("dönmeyen müşteri — İKİNCİ ALIŞ alt sorgusu", () => {
  it("tek alımlı müşteri aday olur, ikinci alışı olan olmaz", async () => {
    const { donmeyenMusteriOzeti } = await import("./donmeyen-musteri")

    const oncesi = await donmeyenMusteriOzeti(companyId)
    const oncekiAdet = oncesi?.adet ?? 0

    const yuzGunOnce = new Date(Date.now() - 100 * 86_400_000)
    const doksanGunOnce = new Date(Date.now() - 90 * 86_400_000)

    const tekAlim = await prisma.customer.create({
      data: { companyId, name: `${IZ} Tek Alım`, slug: `oto-test-tek-${Date.now()}` },
      select: { id: true },
    })
    await prisma.invoice.create({
      data: {
        companyId,
        customerId: tekAlim.id,
        invoiceNo: `${IZ}-SAT-1`,
        slug: `oto-test-sat1-${Date.now()}`,
        type: "SALES",
        invoiceType: "MANUAL",
        status: "SENT",
        date: yuzGunOnce,
        totalAmount: 59_000,
        vatAmount: 9_000,
        netAmount: 50_000,
      },
    })

    const ikiAlim = await prisma.customer.create({
      data: { companyId, name: `${IZ} İki Alım`, slug: `oto-test-iki-${Date.now()}` },
      select: { id: true },
    })
    for (const [i, tarih] of [yuzGunOnce, doksanGunOnce].entries()) {
      await prisma.invoice.create({
        data: {
          companyId,
          customerId: ikiAlim.id,
          invoiceNo: `${IZ}-SAT-${i + 2}`,
          slug: `oto-test-sat${i + 2}-${Date.now()}`,
          type: "SALES",
          invoiceType: "MANUAL",
          status: "SENT",
          date: tarih,
          totalAmount: 59_000,
          vatAmount: 9_000,
          netAmount: 50_000,
        },
      })
    }

    const sonrasi = await donmeyenMusteriOzeti(companyId)
    const adlar = (sonrasi?.ornekler ?? []).map((m) => m.ad)

    // Yalnız TEK alımlı müşteri eklendi: sayı bir arttı, iki alımlı listede yok.
    expect(sonrasi?.adet).toBe(oncekiAdet + 1)
    expect(adlar).toContain(`${IZ} Tek Alım`)
    expect(adlar).not.toContain(`${IZ} İki Alım`)
  })
})

describe("yanıt bekleyen fatura — BEKLEMEDE tanımı ekranın sorgusundan", () => {
  it("terminal olmayan durum sayılır, KABUL sayılmaz", async () => {
    const { yanitBekleyenOzeti } = await import("./yanit-bekleyen-fatura")

    const oncesi = await yanitBekleyenOzeti(companyId)
    const oncekiAdet = oncesi?.adet ?? 0

    const ortak = {
      companyId,
      docDate: new Date(),
      senderName: `${IZ} Gönderici`,
      senderTaxNumber: "1111111111",
      profile: "TICARIFATURA",
      currencyCode: "TRY",
      payableAmount: 1_000,
      vatAmount: 180,
      raw: {},
    }

    await prisma.incomingInvoice.create({
      data: { ...ortak, uuid: `${IZ}-bekleyen-${Date.now()}`, invoiceNo: `${IZ}-B1`, status: "YANIT_BEKLENIYOR" },
    })
    await prisma.incomingInvoice.create({
      data: { ...ortak, uuid: `${IZ}-kabul-${Date.now()}`, invoiceNo: `${IZ}-K1`, status: "KABUL" },
    })

    const sonrasi = await yanitBekleyenOzeti(companyId)

    // Yalnız bekleyen sayıldı; KABUL terminal durumdur.
    expect(sonrasi?.adet).toBe(oncekiAdet + 1)
    // Bugün gelen belge süresi işleyen tek kayıt: listenin başında olmalı.
    expect(sonrasi?.ornekler[0].no).toBe(`${IZ}-B1`)
    expect(sonrasi?.ornekler[0].kalanGun).toBe(8)
  })
})
