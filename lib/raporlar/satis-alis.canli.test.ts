/**
 * SATIŞ / ALIŞ RAPORU — KALEM SAYFASI ↔ FATURA SAYFASI, CANLI VERİTABANINA KARŞI.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * "Detaylı Faturalar" ve "Alınan/Satılan Ürünler" kalemden, "Faturalar" belgenin
 * kayıtlı toplamından kurulur. Kalem fatura altı iskonto/ilaveyi DÜŞMEDEN
 * saklar; rapor onu belgedeki karşılığına çevirir (`fatura-alti.ts`). Çeviri
 * bozulursa ürün cirosu belgeden sapar ve ekran farkı "uyuşmayan belge" diye
 * yanlış etiketler (2026-10-02'ye kadar öyleydi).
 *
 * Ölçü: her firma × tür için belge belge eşleşme — kayıtlı toplamı kalemlerinin
 * belgedeki toplamını tutmayan belge YOK; iki sayfanın farkı yalnız belge
 * yuvarlaması + satır başı kuruş.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * SALT OKUR: rapor fonksiyonu ve tek bir firma listesi sorgusu.
 */

import { afterAll, describe, expect, it } from "vitest"
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { computeSalesPurchaseReport } from "./satis-alis"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())

describe("satış/alış raporu — kalem toplamı ↔ fatura toplamı", () => {
  it("kalemleriyle uyuşmayan belge yok; fark yalnız yuvarlama ve kuruş", async () => {
    const firmalar = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT DISTINCT c.id, c.name FROM invoices i JOIN companies c ON c.id = i."companyId"
    `
    expect(firmalar.length).toBeGreaterThan(0)

    const sapan: string[] = []
    for (const f of firmalar) {
      for (const type of ["SALES", "PURCHASE"] as const) {
        const r = await computeSalesPurchaseReport({ companyId: f.id, type, includeLines: true })
        const kurus = r.totalAmount - r.linesTotal - r.roundingTotal - r.mismatch.amount
        // Kuruş tavanı: belge başına 1 kuruş, en az 10 kuruş.
        if (r.mismatch.count > 0 || Math.abs(kurus) > Math.max(0.1, r.count * 0.01)) {
          sapan.push(
            `${f.name} ${type}: uyuşmayan ${r.mismatch.count} belge (${r.mismatch.amount.toFixed(2)}), kuruş ${kurus.toFixed(2)}`,
          )
        }
      }
    }
    expect(sapan).toEqual([])
  }, 180_000)
})
