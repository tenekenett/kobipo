import { describe, expect, it } from "vitest"
import { resolvePageTitle } from "@/lib/dashboard/page-titles"
import { navHrefsForPath } from "@/lib/page-access"
import {
  findSalesPurchaseSection,
  reportBasePath,
  salesPurchaseSections,
  sectionPath,
} from "./satis-alis-sections"

/**
 * Satış/alış raporunun bölümleri. Bu liste hem özet ekranın kartlarını hem alt
 * sayfaları hem Excel sayfa adlarını besliyor; sessizce bozulursa kart linki
 * "bölüm bulunamadı" ekranına gider ya da dosyanın sekme adı ekrandan ayrışır.
 */

const KINDS = ["SALES", "PURCHASE"] as const

describe("bölüm listesi", () => {
  it("her iki tarafta dört bölüm ve aynı anahtarlar vardır", () => {
    for (const kind of KINDS) {
      expect(salesPurchaseSections(kind).map((s) => s.key)).toEqual([
        "aylik",
        "cariler",
        "faturalar",
        "kalemler",
      ])
    }
  })

  it("slug'lar tarafın içinde tekildir", () => {
    for (const kind of KINDS) {
      const slugs = salesPurchaseSections(kind).map((s) => s.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })

  it("cari bölümü tarafa göre adlanır", () => {
    expect(findSalesPurchaseSection("SALES", "musteriler")?.sheetName).toBe("Müşteriler")
    expect(findSalesPurchaseSection("PURCHASE", "tedarikciler")?.sheetName).toBe("Tedarikçiler")
    // Karşı tarafın slug'ı burada geçerli DEĞİL: /raporlar/satis/tedarikciler yok.
    expect(findSalesPurchaseSection("SALES", "tedarikciler")).toBeNull()
    expect(findSalesPurchaseSection("PURCHASE", "musteriler")).toBeNull()
  })

  it("bilinmeyen ve boş slug null döner (sayfa 'bölüm bulunamadı' basar)", () => {
    expect(findSalesPurchaseSection("SALES", "yok")).toBeNull()
    expect(findSalesPurchaseSection("SALES", "")).toBeNull()
    expect(findSalesPurchaseSection("SALES", null)).toBeNull()
  })

  it("kalemler dışındaki bölümler fatura kalemi istemez", () => {
    // `needsLines` uçtaki `includeLines` demek: gereksiz açılırsa her bölüm
    // sayfası kalem sorgusunu da çalıştırır ve özet ekranlar yavaşlar.
    for (const kind of KINDS) {
      for (const section of salesPurchaseSections(kind)) {
        expect(section.needsLines, section.key).toBe(section.key === "kalemler")
      }
    }
  })
})

describe("bölüm yolları", () => {
  it("alt sayfa raporun ALTINDA yaşar", () => {
    expect(reportBasePath("SALES")).toBe("/raporlar/satis")
    expect(reportBasePath("PURCHASE")).toBe("/raporlar/alis")
    for (const kind of KINDS) {
      for (const section of salesPurchaseSections(kind)) {
        expect(sectionPath(kind, section).startsWith(`${reportBasePath(kind)}/`)).toBe(true)
      }
    }
  })

  it("sayfa kapısını üst rapor sayfasından devralır", () => {
    // Ayrı nav kaydı YOK: `navHrefsForPath` en uzun ön eki eşleştirdiği için
    // izin/rol matrisi güncellenmeden alt sayfalar korunur. Bu kırılırsa alt
    // sayfalar sahipsiz kalır, yani kapıya hiç tabi olmaz.
    for (const kind of KINDS) {
      for (const section of salesPurchaseSections(kind)) {
        expect(navHrefsForPath(sectionPath(kind, section))).toEqual([reportBasePath(kind)])
      }
    }
  })

  it("her bölümün kendi sekme başlığı tanımlıdır", () => {
    // Tanımlı değilse başlık son segmentten üretilir ("Kalemler") ve hangi
    // raporda olduğun sekmeden anlaşılmaz.
    for (const kind of KINDS) {
      for (const section of salesPurchaseSections(kind)) {
        const title = resolvePageTitle(sectionPath(kind, section))
        expect(title, section.slug).toContain(kind === "SALES" ? "Satış" : "Alış")
      }
    }
  })
})
