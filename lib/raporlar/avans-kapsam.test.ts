// CARİ AVANSI süzgecinin NÖBETÇİSİ — hangi raporun saydığı, hangisinin saymadığı.
//
// Kural (lib/finans/nakit-hareket.ts): cariye bağlı ama faturaya bağlanmamış
// hareket bir AVANStır. KÂRI kuran raporlar bunu gelir/gider saymaz (faturası
// kesildiğinde ciro ikinci kez sayılırdı — denetim C1, canlıda 12 ayda
// 3.665.025 ₺ fazla gelir); NAKİT tarafı sayar, çünkü para gerçekten girdi.
//
// Ayrım tek satırlık bir `where` parçasıyla duruyor ve dört ayrı dosyada
// tekrarlanıyor (ikisi ham SQL). Elle listelenen bir kurala güvenilmez: burası
// dosyaları OKUYUP kararın yerinde olduğunu doğrular, yeni rapor eklendiğinde
// sınıflandırma ister.

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { CARI_ADVANCE_WHERE, NO_CARI_WHERE } from "@/lib/finans/nakit-hareket"

const ROOT = process.cwd()
const oku = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

/** Prisma tarafı: `...NO_CARI_WHERE` yayılmış mı. */
const PRISMA_SUZGECI = /\.\.\.NO_CARI_WHERE/
/** Ham SQL tarafı: iki alan da NULL koşuluna bağlanmış mı. */
const SQL_SUZGECI = /t\."customerId" IS NULL AND t\."supplierId" IS NULL/

/** Kârı kuran raporlar — avansı SAYMAZ. */
const KAR_RAPORLARI: Record<string, RegExp> = {
  "lib/raporlar/kar-zarar.ts": PRISMA_SUZGECI,
  "lib/raporlar/harcamalar.ts": PRISMA_SUZGECI,
  "lib/raporlar/gelir-gider.ts": SQL_SUZGECI,
  "lib/raporlar/finansal-ozet.ts": SQL_SUZGECI,
}

describe("cari avansı süzgeci", () => {
  it("iki `where` parçası tam tümleyendir", () => {
    expect(NO_CARI_WHERE).toEqual({ customerId: null, supplierId: null })
    expect(CARI_ADVANCE_WHERE).toEqual({ NOT: NO_CARI_WHERE })
  })

  it("düz anahtar taşır — `OR`/`AND` taşıyan parçaları ezmez", () => {
    // NOT_TRANSFER_OR_SETTLEMENT_WHERE `AND`, NOT_TRANSFER_WHERE `OR` taşıyor;
    // aynı `where` nesnesine yayıldıklarında çakışan anahtar olmamalı.
    expect(Object.keys(NO_CARI_WHERE).sort()).toEqual(["customerId", "supplierId"])
    expect(Object.keys(CARI_ADVANCE_WHERE)).toEqual(["NOT"])
  })

  it.each(Object.entries(KAR_RAPORLARI))("%s avansı gelir/gider saymaz", (dosya, desen) => {
    const kaynak = oku(dosya)
    expect(kaynak).toMatch(desen)
    // Faturasız sayımın YAPILDIĞI her sorguda taraf kararı verilmiş olmalı:
    // ya "cari yok" (gelir/gider) ya da tümleyeni "cari var" (avans toplamı).
    // Sayılar tutmazsa bir sorgu kararsız, yani süzgeçsiz kalmış demektir.
    const faturasizSayim = (kaynak.match(/invoicePayments: \{ none: \{\} \}/g) || []).length
    const sqlFaturasiz = (kaynak.match(/FROM "invoice_payments" p WHERE p\."transactionId" = t\.id/g) || []).length
    const suzgec = (kaynak.match(new RegExp(desen.source, "g")) || []).length
    const avansSorgusu = (kaynak.match(/\.\.\.CARI_ADVANCE_WHERE/g) || []).length
    expect(suzgec + avansSorgusu).toBe(faturasizSayim + sqlFaturasiz)
  })

  it("nakit akışı avansı SAYAR — para gerçekten girdi/çıktı", () => {
    const kaynak = oku("lib/raporlar/nakit-akisi.ts")
    expect(kaynak).toMatch(/invoicePayments: \{ none: \{\} \}/)
    expect(kaynak).not.toMatch(PRISMA_SUZGECI)
    expect(kaynak).not.toMatch(SQL_SUZGECI)
  })

  it("kâr/zarar avans toplamını AYRI döndürür — rakam ekrandan kaybolmaz", () => {
    const kaynak = oku("lib/raporlar/kar-zarar.ts")
    expect(kaynak).toMatch(/advances: \{ income: number; expense: number \}/)
    expect(kaynak).toMatch(/\.\.\.CARI_ADVANCE_WHERE/)
    // Toplamlara karışmamalı: net kâr yalnız gelir ve giderden kurulur.
    expect(kaynak).toMatch(/netProfit: grossProfit - otherExpenses/)
    expect(kaynak).not.toMatch(/netProfit:.*advances/)
  })
})
