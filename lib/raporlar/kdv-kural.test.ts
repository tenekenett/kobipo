// KDV'ye giren belge kuralı — karar 2026-09-30 (bkz. kdv-kural.ts başlığı).
//
// Matris kuralın tamamıdır: satış/alış ailesi × belge türü × durum. SQL
// karşılığı (`kdvyeGirerSql`) aynı kuralı sorguya gömer; bu dosya ikisinin
// aynı metni söylediğini de kaba bir biçimde denetler.

import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import {
  belgedekiTutarSql,
  faturaAltiCarpanSql,
  kalemGekapSql,
  kdvyeGirerMi,
  kdvyeGirerSql,
  kdvKurSql,
} from "./kdv-kural"

const belge = (type: string, invoiceType: string, status: string, returnKind: string | null = null) => ({
  type,
  invoiceType,
  status,
  returnKind,
})

describe("KDV'ye giren belge", () => {
  it("e-Fatura ve e-Arşiv satış yalnız GİB'e gönderildiyse girer", () => {
    expect(kdvyeGirerMi(belge("SALES", "E_INVOICE", "SENT"))).toBe(true)
    expect(kdvyeGirerMi(belge("SALES", "E_ARCHIVE", "SENT"))).toBe(true)
    expect(kdvyeGirerMi(belge("SALES", "E_INVOICE", "DRAFT"))).toBe(false)
    expect(kdvyeGirerMi(belge("SALES", "E_ARCHIVE", "DRAFT"))).toBe(false)
    // Mysoft taslağı GİB'e gitmemiştir.
    expect(kdvyeGirerMi(belge("SALES", "E_ARCHIVE", "GIB_DRAFT"))).toBe(false)
  })

  it("matbu satış faturası ve fiş kaydedildiği an girer — onaylanmamış olsa da", () => {
    expect(kdvyeGirerMi(belge("SALES", "MANUAL", "DRAFT"))).toBe(true)
    expect(kdvyeGirerMi(belge("SALES", "MANUAL", "SENT"))).toBe(true)
  })

  it("alışta kayıtlı her belge girer (ekranda 'Kayıtlı', içeride DRAFT)", () => {
    expect(kdvyeGirerMi(belge("PURCHASE", "MANUAL", "DRAFT"))).toBe(true)
    expect(kdvyeGirerMi(belge("PURCHASE", "E_ARCHIVE", "DRAFT"))).toBe(true)
    expect(kdvyeGirerMi(belge("PURCHASE", "E_INVOICE", "SENT"))).toBe(true)
  })

  it("iptal ve faturaya dönüşmüş fiş hiçbir tarafta girmez", () => {
    for (const status of ["CANCELLED", "CONVERTED"]) {
      expect(kdvyeGirerMi(belge("SALES", "MANUAL", status))).toBe(false)
      expect(kdvyeGirerMi(belge("SALES", "E_INVOICE", status))).toBe(false)
      expect(kdvyeGirerMi(belge("PURCHASE", "MANUAL", status))).toBe(false)
    }
  })

  it("iade kendi ailesinin kuralına tabidir; yönü boş eski iade satış iadesidir", () => {
    expect(kdvyeGirerMi(belge("RETURN", "E_INVOICE", "DRAFT", "SALES"))).toBe(false)
    expect(kdvyeGirerMi(belge("RETURN", "E_INVOICE", "SENT", null))).toBe(true)
    expect(kdvyeGirerMi(belge("RETURN", "MANUAL", "DRAFT", null))).toBe(true)
    // Alış iadesini tedarikçiye BİZ düzenleriz: e-belge ancak GİB'e gidince kesilir,
    // Manuel olan kaydedildiği an. (Alış faturası gibi "her zaman" sayılmaz.)
    expect(kdvyeGirerMi(belge("RETURN", "E_INVOICE", "DRAFT", "PURCHASE"))).toBe(false)
    expect(kdvyeGirerMi(belge("RETURN", "E_INVOICE", "SENT", "PURCHASE"))).toBe(true)
    expect(kdvyeGirerMi(belge("RETURN", "MANUAL", "DRAFT", "PURCHASE"))).toBe(true)
  })
})

describe("SQL karşılığı", () => {
  const metin = (s: { strings: readonly string[] }) => s.strings.join("?").replace(/\s+/g, " ")

  it("aynı dört durumu ve üç belge türü ayrımını içerir", () => {
    const sql = metin(kdvyeGirerSql("i"))
    expect(sql).toContain("NOT IN ('CANCELLED', 'CONVERTED')")
    expect(sql).toContain(`"invoiceType" = 'MANUAL'`)
    expect(sql).toContain("status = 'SENT'")
    expect(sql).toContain("type = 'PURCHASE'")
    // Alınan belge yalnız ALIŞ FATURASI: ayrım ailede değil, belge tipinde.
    expect(sql).toContain("i.type = 'PURCHASE' OR i.\"invoiceType\" = 'MANUAL' OR i.status = 'SENT'")
  })

  it("dövizde kuru sıfır ya da boş olan belge NULL çarpan alır (toplama girmez, sayılır)", () => {
    expect(metin(kdvKurSql("i"))).toContain(`NULLIF(i."exchangeRate", 0)`)
  })

  it("tablo takma adı yalnız sabit tanımlayıcı olabilir", () => {
    expect(() => kdvyeGirerSql("i; DROP TABLE invoices")).toThrow()
    expect(() => faturaAltiCarpanSql("i; DROP TABLE invoices")).toThrow()
    expect(() => kalemGekapSql("ii; --")).toThrow()
  })
})

// Fatura altı iskonto/ilave: katsayının SAYISAL doğruluğu canlıda ölçülür
// (kdv-kural.canli.test.ts — başlık KDV'si ↔ kalemin belgedeki KDV'si). Burada
// yalnız SQL'in document-totals ile aynı kırpma kurallarını söylediği denetlenir.
describe("fatura altı katsayısı (SQL)", () => {
  const metin = (s: { strings: readonly string[] }) => s.strings.join("?").replace(/\s+/g, " ")
  const sql = metin(faturaAltiCarpanSql("i"))

  it("iskontosuz ve ilavesiz belge ölçeklenmez", () => {
    expect(sql).toMatch(/^\(CASE WHEN .* <= 0 AND .* <= 0 THEN 1 ELSE/)
  })

  it("ara toplam satır iskontosu düşülmüş brüttür; iskonto ara toplamla sınırlıdır", () => {
    expect(sql).toContain(`fa_kalem.quantity * fa_kalem."unitPrice"`)
    expect(sql).toContain(`GREATEST(0, LEAST(COALESCE(fa_kalem."discountAmount", 0)`)
    expect(sql).toContain("LEAST(GREATEST(")
    // Ara toplam sıfır/eksi → katsayı yok → 1 (document-totals da dağıtmaz).
    expect(sql).toContain("WHEN fa_toplam.ara > 0")
    expect(sql).toContain("), 1) END)")
  })

  it("maktu GEKAP ve ondan doğan KDV/tevkifat katsayıdan muaftır", () => {
    const g = kalemGekapSql("ii")
    expect(metin(g.gekap)).toBe(`COALESCE(ii."gekapAmount", 0)`)
    expect(metin(g.kdv)).toContain(`COALESCE(ii."vatRate", 0) / 100`)
    expect(metin(g.tevkifat)).toContain(`COALESCE(ii."withholdingRate", 0) / 100`)
    // (tutar − sabit) × f + sabit
    const t = metin(belgedekiTutarSql(Prisma.sql`A`, Prisma.sql`B`, Prisma.sql`F`))
    expect(t).toBe("(((A) - (B)) * F + (B))")
  })
})
