import { describe, expect, it } from "vitest"
import {
  ARCHIVE_AFTER_DAYS,
  AccountArchivedError,
  accountArchivedFrom,
  archiveDueAt,
  shouldArchive,
} from "@/lib/billing/archive"
import { isArchiveExportPath } from "@/lib/module-access"

const NOW = new Date("2026-08-27T12:00:00.000Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe("archiveDueAt", () => {
  it("kilit anından 30 gün sonra", () => {
    const due = archiveDueAt(new Date("2026-08-01T00:00:00.000Z"))
    expect(due?.toISOString().slice(0, 10)).toBe("2026-08-31")
  })

  it("kilitlenmemiş hesapta sayaç işlemez", () => {
    expect(archiveDueAt(null)).toBeNull()
  })
})

describe("shouldArchive", () => {
  it("EXPIRED + süre dolmuş → arşivlenir", () => {
    expect(
      shouldArchive({ status: "EXPIRED", lockedAt: daysAgo(ARCHIVE_AFTER_DAYS + 1) }, NOW),
    ).toBe(true)
  })

  it("EXPIRED ama süre dolmamış → arşivlenmez", () => {
    expect(shouldArchive({ status: "EXPIRED", lockedAt: daysAgo(3) }, NOW)).toBe(false)
  })

  it("bugün kilitlenen hesap bugün arşivlenmez", () => {
    // Cron'da arşiv adımı reconcile'dan SONRA koşuyor; aynı gecede kilitlenen bir
    // hesabın sayacı bugün başlar, bugün dolmaz.
    expect(shouldArchive({ status: "EXPIRED", lockedAt: NOW }, NOW)).toBe(false)
  })

  it("EXPIRED olmayan hiçbir durum arşivlenmez", () => {
    for (const status of ["ACTIVE", "PAST_DUE", "CANCELLED", "TRIAL"]) {
      expect(shouldArchive({ status, lockedAt: daysAgo(90) }, NOW)).toBe(false)
    }
  })

  it("lockedAt yoksa arşivlenmez", () => {
    // Damga yoksa erişimin ne zaman kapandığı bilinmiyor demektir; tahminle
    // arşivlemek müşteriyi haksız yere salt-okunura düşürürdü.
    expect(shouldArchive({ status: "EXPIRED", lockedAt: null }, NOW)).toBe(false)
  })
})

describe("accountArchivedFrom", () => {
  it("kendi hatasını tanır", () => {
    expect(accountArchivedFrom(new AccountArchivedError())).toBeInstanceOf(AccountArchivedError)
  })

  it("mesaj biçiminden de tanır (sınıf kimliği kaybolduğunda)", () => {
    // Next katmanları ayrı derlediği için `instanceof` her zaman tutmaz; mesaj
    // ikinci kanaldır (lib/module-access.ts ile aynı gerekçe).
    expect(accountArchivedFrom(new Error("Access denied: account archived"))).not.toBeNull()
  })

  it("ilgisiz hatayı tanımaz", () => {
    expect(accountArchivedFrom(new Error("Access denied: read-only role"))).toBeNull()
    expect(accountArchivedFrom(null)).toBeNull()
  })

  it("mesajı 'Access denied' ile BAŞLAR — helper'a geçmemiş uçlar da reddetsin", () => {
    expect(new AccountArchivedError().message.startsWith("Access denied")).toBe(true)
  })
})

describe("isArchiveExportPath — arşiv istisnası DAR olmalı", () => {
  it("dışa aktarma GET'ine izin verir", () => {
    expect(isArchiveExportPath("/api/export/cari", "GET")).toBe(true)
    expect(isArchiveExportPath("/api/export", "GET")).toBe(true)
  })

  it("yazma metotlarına izin VERMEZ", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isArchiveExportPath("/api/export/cari", m)).toBe(false)
    }
  })

  it("dışa aktarma dışındaki uçlara sızmaz", () => {
    // İstisnanın tüm güvenliği bu sınırda: arşivdeki hesap verisini indirebilir,
    // ama kapalı modülün uçlarını kullanamaz.
    expect(isArchiveExportPath("/api/import/products", "GET")).toBe(false)
    expect(isArchiveExportPath("/api/cari/customers", "GET")).toBe(false)
    expect(isArchiveExportPath("/api/exportish", "GET")).toBe(false)
  })
})
