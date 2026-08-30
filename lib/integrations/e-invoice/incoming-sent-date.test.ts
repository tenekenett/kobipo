import { describe, expect, it } from "vitest"
import {
  SENT_DATE_KEYS,
  extractSentDate,
  extractSentDateString,
  normalizeSentDateText,
} from "./incoming-sent-date"

/**
 * Gönderilme tarihi artık `incoming_invoices."sentDate"` kolonunda: yalnız ekranda
 * gösterilmiyor, tarih aralığı bu eksende SORGULANIYOR. Bu yüzden çıkarma kuralının
 * (aday sıra + geçersiz değer davranışı) sabit kalması önemli — migrasyondaki geri
 * doldurma aynı sırayı kullanıyor.
 */
describe("extractSentDate", () => {
  it("aday anahtarları öncelik sırasıyla dener", () => {
    expect(SENT_DATE_KEYS[0]).toBe("envelopeDate")
    const raw = {
      envelopeDate: "2026-05-10T08:30:00",
      sendDate: "2026-05-01T00:00:00",
      createDate: "2026-04-01T00:00:00",
    }
    expect(extractSentDateString(raw)).toBe("2026-05-10T08:30:00")
    // İlk anahtar yoksa sıradaki kullanılır.
    expect(extractSentDateString({ sendDate: "2026-05-01T00:00:00" })).toBe(
      "2026-05-01T00:00:00",
    )
    expect(extractSentDateString({ createDateUtc: "2026-03-03T10:00:00" })).toBe(
      "2026-03-03T10:00:00",
    )
  })

  it("alan yoksa, boşsa veya raw nesne değilse null döner", () => {
    expect(extractSentDate({})).toBeNull()
    expect(extractSentDate({ envelopeDate: "   " })).toBeNull()
    expect(extractSentDate({ envelopeDate: null })).toBeNull()
    expect(extractSentDate(null)).toBeNull()
    expect(extractSentDate("2026-05-10")).toBeNull()
  })

  it("çözülemeyen metinde null döner — geçersiz Date kolona yazılmaz", () => {
    expect(extractSentDate({ envelopeDate: "tarih yok" })).toBeNull()
    expect(extractSentDate({ envelopeDate: "00.00.0000" })).toBeNull()
  })

  it("saat dilimi taşıyan değeri anına göre çözer", () => {
    const withOffset = extractSentDate({ envelopeDate: "2026-05-01T00:00:00+03:00" })
    expect(withOffset?.toISOString()).toBe("2026-04-30T21:00:00.000Z")
    const utc = extractSentDate({ envelopeDate: "2026-05-01T00:00:00Z" })
    expect(utc?.toISOString()).toBe("2026-05-01T00:00:00.000Z")
  })

  /**
   * Regresyon: Mysoft `createDate`i offset'siz ve TÜRKİYE YERELİ gönderiyor
   * ("2026-08-28 14:52:03"). Bunu UTC saymak değeri 3 saat ileri kaydırıyor —
   * 14:52'de gönderilen fatura ekranda 17:52 görünüyor, gece yarısına yakın
   * gönderim ertesi güne taşıyor ve gün sınırındaki filtre yanlış cevap veriyordu.
   * Testler sunucunun saat diliminden BAĞIMSIZ olmalı, o yüzden mutlak an ölçülür.
   */
  it("saat dilimsiz değeri Türkiye yereli (+03:00) kabul eder", () => {
    expect(extractSentDate({ createDate: "2026-08-28 14:52:03" })?.toISOString()).toBe(
      "2026-08-28T11:52:03.000Z",
    )
    // "T" ayıraçlı biçim de aynı kuralla çözülür.
    expect(extractSentDate({ createDate: "2026-08-28T14:52:03" })?.toISOString()).toBe(
      "2026-08-28T11:52:03.000Z",
    )
    // Gece yarısına yakın gönderim GÜN ATLAMAZ: 26 Ağustos 23:34 yerel.
    const gece = extractSentDate({ createDate: "2026-08-26 23:34:36" })
    expect(gece?.toISOString()).toBe("2026-08-26T20:34:36.000Z")
    expect(gece?.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })).toBe("26.08.2026")
    // Yalnız tarih verilmişse yerel gece yarısı.
    expect(extractSentDate({ createDate: "2026-08-28" })?.toISOString()).toBe(
      "2026-08-27T21:00:00.000Z",
    )
  })

  it("normalizeSentDateText saat dilimi taşıyan metne dokunmaz", () => {
    expect(normalizeSentDateText("2026-08-28T14:52:03+03:00")).toBe("2026-08-28T14:52:03+03:00")
    expect(normalizeSentDateText("2026-08-28T14:52:03Z")).toBe("2026-08-28T14:52:03Z")
    expect(normalizeSentDateText("2026-08-28 14:52:03")).toBe("2026-08-28T14:52:03+03:00")
  })
})
