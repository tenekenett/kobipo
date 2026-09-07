import { describe, expect, it } from "vitest"
import { vadeTarihiTuret } from "./vade"

describe("fatura vadesini cari kartından türetme", () => {
  it("vade gününü fatura tarihine ekler", () => {
    expect(vadeTarihiTuret("2026-09-07", 30)).toBe("2026-10-07")
    expect(vadeTarihiTuret("2026-09-07", 45)).toBe("2026-10-22")
  })

  /** Ay ve yıl taşması `new Date`e bırakılıyor; elle mod alınsaydı yıl kaybolurdu. */
  it("ay ve yıl sınırını aşar", () => {
    expect(vadeTarihiTuret("2026-08-25", 30)).toBe("2026-09-24")
    expect(vadeTarihiTuret("2026-12-20", 30)).toBe("2027-01-19")
    // 2028 artık yıl: 29 Şubat gerçek bir gündür.
    expect(vadeTarihiTuret("2028-02-01", 28)).toBe("2028-02-29")
  })

  /**
   * "2026-09-07" doğrudan `new Date`e verilseydi UTC gece yarısı olarak
   * ayrıştırılır ve TSİ'de bir gün geriye kayabilirdi. Gün numarası korunmalı.
   */
  it("saat dilimi kaydırmaz — gün numarası aynen korunur", () => {
    expect(vadeTarihiTuret("2026-09-07", 1)).toBe("2026-09-08")
    expect(vadeTarihiTuret("2026-01-01", 1)).toBe("2026-01-02")
  })

  /**
   * Türetilemeyen her durumda null: yanlış vade boş vadeden KÖTÜDÜR, çünkü
   * alan e-Fatura gövdesine gidip müşteriye taahhüt olur.
   */
  it("vade günü yoksa ya da anlamsızsa türetmez", () => {
    expect(vadeTarihiTuret("2026-09-07", null)).toBeNull()
    expect(vadeTarihiTuret("2026-09-07", undefined)).toBeNull()
    expect(vadeTarihiTuret("2026-09-07", 0)).toBeNull()
    expect(vadeTarihiTuret("2026-09-07", -5)).toBeNull()
    expect(vadeTarihiTuret("2026-09-07", Number.NaN)).toBeNull()
  })

  it("fatura tarihi boş ya da bozuksa türetmez", () => {
    expect(vadeTarihiTuret("", 30)).toBeNull()
    expect(vadeTarihiTuret("07.09.2026", 30)).toBeNull()
    expect(vadeTarihiTuret("2026-13-01", 30)).toBeNull()
  })
})
