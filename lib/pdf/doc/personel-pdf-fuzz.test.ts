/** Personel belgeleri (bordro, izin, zimmet) — kayma avı. */
import { describe, expect, it } from "vitest"
import {
  buildAssetFormPdf,
  buildLeaveFormPdf,
  buildPayslipPdf,
  type PdfCompany,
  type PdfEmployee,
} from "@/lib/pdf/personel-pdf"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { fuzzAmount, fuzzField, rng, token, words } from "@/lib/pdf/doc/fuzz"

const company = (rand: () => number): PdfCompany => ({
  name: fuzzField(rand),
  taxNumber: token(rand, 10),
  address: fuzzField(rand, 280),
  city: fuzzField(rand, 40),
  phone: token(rand, 11),
})

const employee = (rand: () => number): PdfEmployee => ({
  firstName: fuzzField(rand, 60),
  lastName: fuzzField(rand, 60),
  nationalId: token(rand, 11),
  position: fuzzField(rand, 60),
  department: fuzzField(rand, 60),
  iban: token(rand, 34),
})

describe("Personel belgeleri — kayma avı", () => {
  it("bordro: 30 rastgele belge temiz", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed)
      const violations = checkPdf(
        await buildPayslipPdf({
          company: company(rand),
          employee: employee(rand),
          periodYear: 2026,
          periodMonth: 1 + Math.floor(rand() * 12),
          grossSalary: fuzzAmount(rand),
          bonus: fuzzAmount(rand),
          advance: fuzzAmount(rand),
          sgkDeduction: fuzzAmount(rand),
          taxDeduction: fuzzAmount(rand),
          otherDeduction: fuzzAmount(rand),
          netSalary: fuzzAmount(rand),
          status: rand() < 0.5 ? "PAID" : "PENDING",
          paymentDate: rand() < 0.5 ? new Date("2026-02-05").toISOString() : null,
        }),
      )
      if (violations.length) failures.push(`bordro tohum ${seed}: ${violations[0].message}`)
    }
    expect(failures, failures.join("\n")).toHaveLength(0)
  }, 180_000)

  it("izin formu: 30 rastgele belge temiz", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed + 100)
      const violations = checkPdf(
        await buildLeaveFormPdf({
          company: company(rand),
          employee: employee(rand),
          type: ["ANNUAL", "EXCUSE", "SICK", "UNPAID", "BILINMEYEN"][Math.floor(rand() * 5)],
          startDate: new Date("2026-03-01").toISOString(),
          endDate: new Date("2026-03-10").toISOString(),
          days: Math.floor(rand() * 30),
          reason: fuzzField(rand, 300),
          status: ["APPROVED", "REJECTED", "PENDING"][Math.floor(rand() * 3)],
        }),
      )
      if (violations.length) failures.push(`izin tohum ${seed}: ${violations[0].message}`)
    }
    expect(failures, failures.join("\n")).toHaveLength(0)
  }, 180_000)

  it("zimmet formu: 30 rastgele belge temiz", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed + 200)
      const violations = checkPdf(
        await buildAssetFormPdf({
          company: company(rand),
          employee: employee(rand),
          assetName: fuzzField(rand, 160),
          category: fuzzField(rand, 60),
          serialNo: token(rand, 30),
          quantity: Math.floor(rand() * 100),
          assignedDate: new Date("2026-01-15").toISOString(),
          returnDate: rand() < 0.5 ? new Date("2026-06-15").toISOString() : null,
          status: rand() < 0.5 ? "RETURNED" : "ASSIGNED",
          notes: fuzzField(rand, 300),
        }),
      )
      if (violations.length) failures.push(`zimmet tohum ${seed}: ${violations[0].message}`)
    }
    expect(failures, failures.join("\n")).toHaveLength(0)
  }, 180_000)

  it("firma unvanı KARAKTER KARAKTER uzarken bordroda kaymaz", async () => {
    const rand = rng(9)
    const emp = employee(rand)
    const failures: string[] = []
    for (let len = 1; len <= 160; len += 4) {
      const violations = checkPdf(
        await buildPayslipPdf({
          company: { ...company(rand), name: words(rand, len) },
          employee: emp,
          periodYear: 2026,
          periodMonth: 3,
          grossSalary: 125000.5,
          bonus: 5000,
          advance: 1000,
          sgkDeduction: 18750.75,
          taxDeduction: 22500.25,
          otherDeduction: 0,
          netSalary: 86749.5,
          status: "PAID",
          paymentDate: new Date("2026-04-05").toISOString(),
        }),
      )
      if (violations.length) {
        failures.push(`unvan @ ${len} karakter: ${violations[0].message}`)
        break
      }
    }
    expect(failures, failures.join("\n")).toHaveLength(0)
  }, 180_000)
})
