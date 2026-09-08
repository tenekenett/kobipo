/**
 * İÇE AKTARIM — CANLI VERİTABANINA KARŞI, İSTEĞE BAĞLI takım.
 *
 * ── Neden ayrı bir takım ────────────────────────────────────────────────────
 * `vitest.config.mts` kapsamı bilinçli olarak dar (yalnız saf fonksiyonlar).
 * Bu dosya onu delmiyor: kendi yapılandırmasıyla (`vitest.canli.config.mts`) ve
 * kendi komutuyla (`npm run test:canli`) koşar, `npm test` onu HİÇ görmez.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Eşleştirmenin yarısı SQL'in içinde ve saf testle görülemez:
 *   • aday havuzu `mode: "insensitive"` ile çekiliyor — düz eşitliğe dönerse
 *     "ELMA" satırı "Elma" ürününü bulamaz ve aynı ürün ikinci kez açılır;
 *     saf teste adaylar HAZIR geldiği için bu kayıp orada görünmez.
 *   • güncellemenin gerçekten kısmi olduğu (dosyada olmayan sütunun kartta
 *     durduğu) ancak yazılan satır geri okunarak doğrulanabilir.
 *   • "önizleme açıkken yazılmıyor" ölçüsünün tek kanıtı veritabanının
 *     değişmemiş olmasıdır — bu bir kez yanlıştı: `dryRun` yalnız fatura
 *     dallarında okunuyordu, ekran "kayıt atılmaz" derken ürün yazılıyordu.
 *
 * Test, ucun (`app/api/import/route.ts`) çağırdığı fonksiyonların TA KENDİSİNİ
 * çağırır (`lib/import/apply.ts`); doğrulanan yol üretimde koşan yoldur.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * GERÇEK veritabanına yazar. Önlemler:
 *   1. Her fixture `OTO-TEST` ön ekiyle açılır — adı, barkodu ve kodu birden.
 *      Barkod/kod da izli olmalı: eşleştirme bu alanlara da baktığı için gerçek
 *      bir barkodla çakışan fixture GERÇEK ürünü güncellerdi.
 *   2. `beforeAll` önce artık kalmış kayıtları siler (önceki koşu çökmüş olabilir).
 *   3. `afterAll` her durumda siler; testler patlasa da fixture kalmaz.
 * Hedef firma `OTOMASYON_CANLI_FIRMA` ile seçilir (varsayılan: `reypo`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"
import {
  customerHeaderAliases,
  normalizeHeader,
  productHeaderAliases,
  readCell,
  supplierHeaderAliases,
  type ImportGetter,
} from "./rows"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()

const IZ = "OTO-TEST"
const FIRMA_SLUG = process.env.OTOMASYON_CANLI_FIRMA || "reypo"

let companyId = ""
/**
 * `lib/import/apply` DİNAMİK yükleniyor: statik içe aktarma modül gövdesinden
 * önce koşar ve `lib/db/prisma` DATABASE_URL'i daha okunmadan arardı.
 */
let uygula: typeof import("./apply")

/** Dosyadan gelmiş bir satırı taklit eder: Türkçe başlıklar → `get(anahtar)`. */
function satir(alanlar: Record<string, string>, aliases: Record<string, string[]>): ImportGetter {
  const headers = Object.keys(alanlar).map((baslik) => normalizeHeader(baslik))
  const row = Object.values(alanlar)
  return (key: string) => readCell(headers, row, aliases, key)
}

const urunSatiri = (alanlar: Record<string, string>) => satir(alanlar, productHeaderAliases)

const EKLE = { updateExisting: false, updateStock: false, dryRun: false }
const GUNCELLE = { updateExisting: true, updateStock: false, dryRun: false }
const GUNCELLE_STOK = { updateExisting: true, updateStock: true, dryRun: false }
const ONIZLEME = { updateExisting: true, updateStock: false, dryRun: true }

async function temizle() {
  if (!companyId) return
  const izli = { startsWith: IZ }
  await prisma.product.deleteMany({
    where: { companyId, OR: [{ name: izli }, { barcode: izli }, { code: izli }] },
  })
  await prisma.customer.deleteMany({ where: { companyId, name: izli } })
  await prisma.supplier.deleteMany({ where: { companyId, name: izli } })
}

/** Fixture'ı adından okur; testler kartın SON halini veritabanından doğrular. */
async function urunuOku(name: string) {
  const urun = await prisma.product.findFirst({ where: { companyId, name } })
  if (!urun) throw new Error(`Ürün bulunamadı: ${name}`)
  return urun
}

const izliUrunSayisi = () =>
  prisma.product.count({ where: { companyId, name: { startsWith: IZ } } })

beforeAll(async () => {
  const firma = await prisma.company.findFirst({
    where: { slug: FIRMA_SLUG },
    select: { id: true },
  })
  if (!firma) throw new Error(`Hedef firma bulunamadı: ${FIRMA_SLUG}`)
  companyId = firma.id
  await temizle()
  uygula = await import("./apply")
})

afterAll(async () => {
  await temizle()
  await prisma.$disconnect()
})

describe("ürün — aynı listeyi ikinci kez yükleme", () => {
  const AD = `${IZ} Kahve`

  /** Kullanıcının ilk yüklediği liste: tam dosya. */
  const ilkListe = () =>
    urunSatiri({
      Kod: `${IZ}-KOD-1`,
      Ad: AD,
      Barkod: `${IZ}-BARKOD-1`,
      Birim: "KG",
      "Stok Miktarı": "10",
      "Alış Fiyatı": "100",
      "Satış Fiyatı": "150",
      "KDV Oranı": "10",
    })

  beforeAll(async () => {
    expect(await uygula.applyProductRow(companyId, ilkListe(), EKLE)).toBe("created")
  })

  it("güncelleme KAPALIYKEN çift kayıt hatası verir ve fiyata dokunmaz", async () => {
    const fiyatiDegisenListe = urunSatiri({ Ad: AD, "Satış Fiyatı": "180" })

    await expect(uygula.applyProductRow(companyId, fiyatiDegisenListe, EKLE)).rejects.toThrow(
      /Çift ürün bulundu/,
    )

    const urun = await urunuOku(AD)
    expect(Number(urun.salePrice)).toBe(150)
    expect(await izliUrunSayisi()).toBe(1)
  })

  it("güncelleme AÇIKKEN fiyatı yazar, dosyada olmayan sütunlara dokunmaz", async () => {
    const sadeceFiyat = urunSatiri({ Ad: AD, "Satış Fiyatı": "199,90" })

    expect(await uygula.applyProductRow(companyId, sadeceFiyat, GUNCELLE)).toBe("updated")

    const urun = await urunuOku(AD)
    expect(Number(urun.salePrice)).toBe(199.9)
    // Dosyada olmayan sütunlar kartta duruyor — güncelleme kısmi.
    expect(urun.barcode).toBe(`${IZ}-BARKOD-1`)
    expect(urun.unit).toBe("KG")
    expect(Number(urun.purchasePrice)).toBe(100)
    expect(Number(urun.vatRate)).toBe(10)
    expect(await izliUrunSayisi()).toBe(1)
  })

  it("stok miktarı istenmedikçe geri sarılmaz", async () => {
    const eskiStokluListe = urunSatiri({ Ad: AD, "Stok Miktarı": "1", "Satış Fiyatı": "199,90" })

    await uygula.applyProductRow(companyId, eskiStokluListe, GUNCELLE)
    expect(Number((await urunuOku(AD)).stockQuantity)).toBe(10)

    await uygula.applyProductRow(companyId, eskiStokluListe, GUNCELLE_STOK)
    expect(Number((await urunuOku(AD)).stockQuantity)).toBe(1)
  })

  it("büyük/küçük harf farkı aynı üründür ve kartın adını BOZMAZ", async () => {
    const bagiranListe = urunSatiri({
      Ad: AD.toLocaleUpperCase("tr-TR"),
      "Satış Fiyatı": "175",
    })

    expect(await uygula.applyProductRow(companyId, bagiranListe, GUNCELLE)).toBe("updated")

    // Ad eşleştirme anahtarıdır; dosyanın yazımı kartın üzerine geçseydi
    // ürünleri büyük harfle yazan bir liste bütün kartları yeniden adlandırırdı.
    const urun = await urunuOku(AD)
    expect(urun.name).toBe(AD)
    expect(Number(urun.salePrice)).toBe(175)
    expect(await izliUrunSayisi()).toBe(1)
  })

  it("dışa aktarımın başlıklarıyla gelen dosya tanınır", async () => {
    // `lib/export/datasets/products.ts` bu başlıkları yazar; içe aktarım
    // bunları tanımasaydı satır "name is required" ile düşerdi.
    const disaAktarilmisListe = urunSatiri({
      Kod: `${IZ}-KOD-1`,
      "Ürün Adı": AD,
      Barkod: `${IZ}-BARKOD-1`,
      Stok: "999",
      KDV: "20",
      "Satış Fiyatı": "210",
    })

    expect(await uygula.applyProductRow(companyId, disaAktarilmisListe, GUNCELLE)).toBe("updated")

    const urun = await urunuOku(AD)
    expect(Number(urun.salePrice)).toBe(210)
    expect(Number(urun.vatRate)).toBe(20)
    // "Stok" sütunu okundu ama güncellemeye girmedi.
    expect(Number(urun.stockQuantity)).toBe(1)
  })

  it("önizlemede karar verilir ama veritabanına yazılmaz", async () => {
    const oncekiFiyat = Number((await urunuOku(AD)).salePrice)

    const mevcut = urunSatiri({ Ad: AD, "Satış Fiyatı": "555" })
    expect(await uygula.applyProductRow(companyId, mevcut, ONIZLEME)).toBe("updated")
    expect(Number((await urunuOku(AD)).salePrice)).toBe(oncekiFiyat)

    const yeni = urunSatiri({ Ad: `${IZ} Hiç Açılmayacak`, "Satış Fiyatı": "10" })
    expect(await uygula.applyProductRow(companyId, yeni, ONIZLEME)).toBe("created")
    expect(
      await prisma.product.count({ where: { companyId, name: `${IZ} Hiç Açılmayacak` } }),
    ).toBe(0)
  })
})

describe("ürün — eşleştirme sırası ada göredir", () => {
  const AD = `${IZ} Çay`
  const YENI_AD = `${IZ} Çay (Bergamotlu)`

  beforeAll(async () => {
    await uygula.applyProductRow(
      companyId,
      urunSatiri({ Ad: AD, Barkod: `${IZ}-BARKOD-2`, "Satış Fiyatı": "50" }),
      EKLE,
    )
  })

  it("ad değişmişse barkoddan bulur — yeni ürün açmaz, adı günceller", async () => {
    const adiDuzeltilmisListe = urunSatiri({
      Ad: YENI_AD,
      Barkod: `${IZ}-BARKOD-2`,
      "Satış Fiyatı": "60",
    })

    expect(await uygula.applyProductRow(companyId, adiDuzeltilmisListe, GUNCELLE)).toBe("updated")

    const urun = await urunuOku(YENI_AD)
    expect(Number(urun.salePrice)).toBe(60)
    expect(await prisma.product.count({ where: { companyId, name: AD } })).toBe(0)
  })

  it("ad bir ürünü, barkod BAŞKA ürünü tutuyorsa satır reddedilir", async () => {
    await uygula.applyProductRow(
      companyId,
      urunSatiri({ Ad: `${IZ} Şeker`, Barkod: `${IZ}-BARKOD-3`, "Satış Fiyatı": "20" }),
      EKLE,
    )

    const karisikSatir = urunSatiri({
      Ad: `${IZ} Şeker`,
      Barkod: `${IZ}-BARKOD-2`,
      "Satış Fiyatı": "999",
    })

    await expect(uygula.applyProductRow(companyId, karisikSatir, GUNCELLE)).rejects.toThrow(
      /birden fazla kayıtla eşleşti/,
    )

    // İkisi de olduğu gibi duruyor: belirsiz satır hiçbirine yazmaz.
    expect(Number((await urunuOku(`${IZ} Şeker`)).salePrice)).toBe(20)
    expect(Number((await urunuOku(YENI_AD)).salePrice)).toBe(60)
  })
})

describe("fiyat hücresi — sessiz sıfır yok", () => {
  it("para birimi biçimli fiyat sütunu karta 0 yazmaz", async () => {
    // 2026-09-08'de 518 ürün tam bu yüzden 0 fiyatla açılmıştı: XLSX `raw: false`
    // ile okunuyor ve Excel'de para birimi biçimli sütun buraya böyle geliyor.
    const AD = `${IZ} Hidrolik Yağ`
    const liste = urunSatiri({
      Ad: AD,
      Barkod: `${IZ}-BARKOD-4`,
      "Alış Fiyatı": "2.094,70 ₺",
      "Satış Fiyatı": "2.500,00 TL",
      "KDV Oranı": "%20",
    })

    expect(await uygula.applyProductRow(companyId, liste, EKLE)).toBe("created")

    const urun = await urunuOku(AD)
    expect(Number(urun.purchasePrice)).toBe(2094.7)
    expect(Number(urun.salePrice)).toBe(2500)
    expect(Number(urun.vatRate)).toBe(20)
  })

  it("okunamayan fiyat satırı reddettirir; ürün hiç açılmaz", async () => {
    const AD = `${IZ} Bozuk Fiyat`
    const liste = urunSatiri({ Ad: AD, "Satış Fiyatı": "fiyat sorulacak" })

    await expect(uygula.applyProductRow(companyId, liste, EKLE)).rejects.toThrow(
      /"Satış Fiyatı" sütunu sayı değil/,
    )
    expect(await prisma.product.count({ where: { companyId, name: AD } })).toBe(0)
  })
})

describe("cari ve tedarikçi", () => {
  const TEDARIKCI = `${IZ} Tedarik Ltd.`
  const MUSTERI = `${IZ} Müşteri A.Ş.`

  it("aynı tedarikçi ikinci kez eklenemez", async () => {
    // VKN de izli: gerçekçi bir "1111111111" kullanıldığında hedef firmadaki
    // GERÇEK bir tedarikçiye denk geldi ve test onun üzerinden koşmaya çalıştı.
    // Alanda kısıt yok; fixture'ın her eşleştirme anahtarı iz taşımalı.
    const liste = satir(
      { Ad: TEDARIKCI, "Vergi No": `${IZ}-VKN-1`, Telefon: "0312 000 00 00" },
      supplierHeaderAliases,
    )

    expect(await uygula.applyCariRow(companyId, "suppliers", liste, EKLE)).toBe("created")
    await expect(uygula.applyCariRow(companyId, "suppliers", liste, EKLE)).rejects.toThrow(
      /Çift tedarikçi bulundu/,
    )

    expect(await prisma.supplier.count({ where: { companyId, name: TEDARIKCI } })).toBe(1)
  })

  it("müşteride güncelleme kısmidir ve açılış bakiyesine dokunmaz", async () => {
    const ilkListe = satir(
      {
        Ad: MUSTERI,
        "Vergi No": `${IZ}-VKN-2`,
        Adres: "Örnek Mah. No:1",
        "Açılış Bakiyesi": "15.000,00",
        "Bakiye Türü": "Alacak",
      },
      customerHeaderAliases,
    )
    expect(await uygula.applyCariRow(companyId, "customers", ilkListe, EKLE)).toBe("created")

    const sadeceTelefon = satir({ Ad: MUSTERI, Telefon: "0212 999 99 99" }, customerHeaderAliases)
    expect(await uygula.applyCariRow(companyId, "customers", sadeceTelefon, GUNCELLE)).toBe(
      "updated",
    )

    const cari = await prisma.customer.findFirst({ where: { companyId, name: MUSTERI } })
    expect(cari?.phone).toBe("0212 999 99 99")
    expect(cari?.address).toBe("Örnek Mah. No:1")
    // Bakiye satırda yoktu: tutar da tür de olduğu gibi kalmalı.
    expect(Number(cari?.openingBalanceAmount)).toBe(15000)
    expect(cari?.openingBalanceType).toBe("CREDIT")
  })
})
