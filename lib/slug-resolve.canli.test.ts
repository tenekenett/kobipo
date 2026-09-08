/**
 * SLUG ÇÖZÜMÜ — CANLI VERİTABANINA KARŞI, İSTEĞE BAĞLI takım.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Slug yalnız FİRMA İÇİNDE benzersiz (`@@unique([companyId, slug])`): aynı cari
 * iki firmaya da kayıtlıysa iki satırın slug'ı aynıdır. Bu yüzden firmasız bir
 * `findFirst({ where: { slug } })` başka firmanın kaydını döndürebilir ve kural
 * SQL'in içinde olduğu için saf testle görülemez.
 *
 * 2026-09-08: cari kartını kaydetmek 500 veriyordu ("Sınıflandırma 2 kaydı
 * bulunamadı"). Sebep buydu — düzenleme formu firmayı gövdede yolluyor, uç ise
 * yalnız query'e bakıyordu; firma boş kalınca slug firma-kör çözülüyor ve
 * düzenleme BAŞKA firmanın carisine gidiyordu. Sınıflandırma kaydı o firmada
 * bulunmadığı için işlem geri alındı; kullanıcı hatayı gördü. Sınıflandırma
 * seçilmeseydi yazma sessizce yanlış firmaya işlerdi.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * GERÇEK veritabanına yazar; fixture'lar `OTO-TEST` ön ekli açılır ve hem başta
 * hem sonda silinir. İki AYRI firmada aynı adla cari açılır (slug'ı trigger
 * üretir), çünkü sınanan şey tam olarak bu çakışmadır.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()

const IZ = "OTO-TEST"
const AD = `${IZ} Çift Slug Cari`
const FIRMA_SLUG = process.env.OTOMASYON_CANLI_FIRMA || "reypo"

let birinciCompanyId = ""
let ikinciCompanyId = ""
let birinciId = ""
let ikinciId = ""
let ortakSlug = ""

/** `lib/slug-resolve` dinamik yüklenir: statik içe aktarma DATABASE_URL'den önce koşar. */
let cozumleyici: typeof import("./slug-resolve")

async function temizle() {
  await prisma.customer.deleteMany({ where: { name: { startsWith: IZ } } })
}

beforeAll(async () => {
  const birinci = await prisma.company.findFirst({
    where: { slug: FIRMA_SLUG },
    select: { id: true },
  })
  if (!birinci) throw new Error(`Hedef firma bulunamadı: ${FIRMA_SLUG}`)
  birinciCompanyId = birinci.id

  const ikinci = await prisma.company.findFirst({
    where: { id: { not: birinciCompanyId } },
    select: { id: true },
  })
  if (!ikinci) throw new Error("Çapraz firma sınaması için ikinci bir firma gerekli")
  ikinciCompanyId = ikinci.id

  await temizle()

  // Slug'ı trigger ADDAN üretir; aynı ad iki firmada AYNI slug'ı verir.
  const olustur = (companyId: string) =>
    prisma.customer.create({ data: { companyId, name: AD }, select: { id: true, slug: true } })

  const a = await olustur(birinciCompanyId)
  const b = await olustur(ikinciCompanyId)
  birinciId = a.id
  ikinciId = b.id
  ortakSlug = a.slug

  cozumleyici = await import("./slug-resolve")
})

afterAll(async () => {
  await temizle()
  await prisma.$disconnect()
})

describe("resolveSlugId — slug firma içinde benzersizdir", () => {
  it("kurulum: iki firmada aynı slug gerçekten oluşuyor", () => {
    expect(ortakSlug).not.toBe("")
    expect(birinciId).not.toBe(ikinciId)
  })

  it("firma verilince o firmanın kaydını döndürür", async () => {
    expect(await cozumleyici.resolveSlugId("customer", ortakSlug, birinciCompanyId)).toBe(birinciId)
    expect(await cozumleyici.resolveSlugId("customer", ortakSlug, ikinciCompanyId)).toBe(ikinciId)
  })

  it("firma verilmezse slug'ı ÇÖZMEZ — rastgele bir firmaya düşmez", async () => {
    // Fail-closed: segment olduğu gibi döner, çağıranın findUnique'i 404 verir.
    // Eski `resolveCariId` burada firma-kör arayıp iki kayıttan birini seçiyordu.
    const cozum = await cozumleyici.resolveSlugId("customer", ortakSlug, null)
    expect(cozum).toBe(ortakSlug)
    expect([birinciId, ikinciId]).not.toContain(cozum)
  })

  it("cuid segment firma olmadan da olduğu gibi döner (eski URL'ler)", async () => {
    expect(await cozumleyici.resolveSlugId("customer", birinciId, null)).toBe(birinciId)
  })

  it("yanlış firmada aranan slug çözülmez", async () => {
    const yabanci = await prisma.company.findFirst({
      where: { id: { notIn: [birinciCompanyId, ikinciCompanyId] } },
      select: { id: true },
    })
    if (!yabanci) return
    expect(await cozumleyici.resolveSlugId("customer", ortakSlug, yabanci.id)).toBe(ortakSlug)
  })
})
