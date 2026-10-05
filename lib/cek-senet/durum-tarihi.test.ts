import { describe, expect, it } from "vitest"
import { durumTarihi, durumTarihiGirdisi } from "./durum-tarihi"

const simdi = new Date("2026-10-05T10:00:00Z")
const eski = new Date("2026-09-20T13:45:00Z")

describe("durumTarihi", () => {
  it("portföydeki evrakın durum tarihi yok", () => {
    expect(durumTarihi({ eskiDurum: "CİRO_EDİLDİ", yeniDurum: "PORTFÖYDE", eskiTarih: eski, istekTarihi: null, simdi })).toBeNull()
  })
  it("durum değişince istekteki gün, yoksa şimdi", () => {
    const istek = new Date("2026-10-01")
    expect(durumTarihi({ eskiDurum: "PORTFÖYDE", yeniDurum: "CİRO_EDİLDİ", eskiTarih: null, istekTarihi: istek, simdi })).toBe(istek)
    expect(durumTarihi({ eskiDurum: "PORTFÖYDE", yeniDurum: "CİRO_EDİLDİ", eskiTarih: null, istekTarihi: null, simdi })).toBe(simdi)
    // Yeni kayıt (eski durum yok) da "değişti" sayılır.
    expect(durumTarihi({ eskiDurum: null, yeniDurum: "TAHSİL_EDİLDİ", eskiTarih: null, istekTarihi: null, simdi })).toBe(simdi)
  })
  it("durum aynı: aynı gün yeniden gönderilirse eski tarih korunur, farklı gün düzeltir", () => {
    const ayniGun = new Date("2026-09-20") // formdaki "YYYY-MM-DD" (UTC gece yarısı)
    expect(durumTarihi({ eskiDurum: "CİRO_EDİLDİ", yeniDurum: "CİRO_EDİLDİ", eskiTarih: eski, istekTarihi: ayniGun, simdi })).toBe(eski)
    const baskaGun = new Date("2026-09-18")
    expect(durumTarihi({ eskiDurum: "CİRO_EDİLDİ", yeniDurum: "CİRO_EDİLDİ", eskiTarih: eski, istekTarihi: baskaGun, simdi })).toBe(baskaGun)
    expect(durumTarihi({ eskiDurum: "CİRO_EDİLDİ", yeniDurum: "CİRO_EDİLDİ", eskiTarih: eski, istekTarihi: null, simdi })).toBe(eski)
  })
  it("durum aynı ama eski kayıtta tarih yok: şimdi", () => {
    expect(durumTarihi({ eskiDurum: "İADE_EDİLDİ", yeniDurum: "İADE_EDİLDİ", eskiTarih: null, istekTarihi: null, simdi })).toBe(simdi)
  })
})

describe("durumTarihiGirdisi", () => {
  it("boş → null, gün → Date, bozuk → hata", () => {
    expect(durumTarihiGirdisi("")).toBeNull()
    expect(durumTarihiGirdisi(undefined)).toBeNull()
    expect(durumTarihiGirdisi("2026-10-01")?.toISOString()).toBe("2026-10-01T00:00:00.000Z")
    expect(() => durumTarihiGirdisi("31.10.2026x")).toThrow()
  })
})
