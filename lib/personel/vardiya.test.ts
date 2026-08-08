/**
 * Vardiya zaman aritmetiğinin testleri.
 *
 * Bu modül projedeki en sessiz hata kaynağı: dakika ↔ saat çevrimi ve gün
 * sınırları yanlış olduğunda ekran ÇALIŞIR, yalnız rakamlar yanlış çıkar. Bu
 * yüzden testler mutlu yolu değil, geçmişte gerçekten pahalıya patlamış uç
 * durumları hedefliyor: gece vardiyası (1440'ı aşan bitiş), yerel gün ↔ UTC
 * çevrimi ve hafta başlangıcının pazar günü.
 */

import { describe, expect, it } from "vitest"
import {
  DAY_MINUTES,
  actualNetMinutes,
  dayDiff,
  dayToUtcDate,
  durationLabel,
  earlyLeaveMinutes,
  hhmmToMinute,
  lateMinutes,
  minuteToHHMM,
  netMinutes,
  overlaps,
  overtimeMinutes,
  resolveStampMinute,
  shiftDayIso,
  utcDateToDay,
  weekDaysIso,
  weekRangeLabel,
  weekStartIso,
} from "./vardiya"

describe("minuteToHHMM", () => {
  it("gün içi dakikayı saate çevirir", () => {
    expect(minuteToHHMM(540)).toBe("09:00")
    expect(minuteToHHMM(1020)).toBe("17:00")
    expect(minuteToHHMM(0)).toBe("00:00")
  })

  it("ertesi güne taşan dakikada saat başa sarar", () => {
    // Gece vardiyasının bitişi 1440'ı aşar; ekranda "02:00" yazmalı, "26:00" değil.
    expect(minuteToHHMM(1560)).toBe("02:00")
    expect(minuteToHHMM(DAY_MINUTES)).toBe("00:00")
  })
})

describe("hhmmToMinute", () => {
  it("geçerli saati dakikaya çevirir", () => {
    expect(hhmmToMinute("09:00")).toBe(540)
    expect(hhmmToMinute("9:05")).toBe(545)
  })

  it("geçersiz girdide null döner", () => {
    expect(hhmmToMinute("")).toBeNull()
    expect(hhmmToMinute("9")).toBeNull()
    expect(hhmmToMinute("09:70")).toBeNull()
    expect(hhmmToMinute("48:00")).toBeNull()
  })
})

describe("netMinutes", () => {
  it("molayı düşer", () => {
    expect(netMinutes(540, 1020, 60)).toBe(420)
  })

  it("gece vardiyasını doğru ölçer", () => {
    // 22:00–02:00 = 1320–1560, dört saat.
    expect(netMinutes(1320, 1560, 0)).toBe(240)
  })

  it("mola vardiyadan uzunsa negatife düşmez", () => {
    expect(netMinutes(540, 600, 120)).toBe(0)
  })
})

describe("durationLabel", () => {
  it("saat ve dakikayı okunur yazar", () => {
    expect(durationLabel(510)).toBe("8 sa 30 dk")
    expect(durationLabel(480)).toBe("8 sa")
    expect(durationLabel(45)).toBe("45 dk")
  })
})

describe("overlaps", () => {
  it("kesişen aralıkları yakalar", () => {
    expect(overlaps(540, 1020, 900, 1200)).toBe(true)
  })

  it("uç uca gelen aralıklar çakışmaz", () => {
    // 09:00–17:00 ile 17:00–22:00 aynı anda değil, arka arkayadır.
    expect(overlaps(540, 1020, 1020, 1320)).toBe(false)
  })
})

describe("dakiklik ölçüleri", () => {
  const shift = { plannedStart: 540, plannedEnd: 1020, breakMinutes: 60 }

  it("tolerans içindeki gecikmeyi saymaz", () => {
    // PUNCTUALITY_TOLERANCE = 5: üç dakika geç gelmek "geç" değildir.
    expect(lateMinutes({ ...shift, actualStart: 543 })).toBe(0)
    expect(lateMinutes({ ...shift, actualStart: 560 })).toBe(20)
  })

  it("damga yoksa null döner — 'bilinmiyor' ile 'geç değil' aynı şey değil", () => {
    expect(lateMinutes(shift)).toBeNull()
    expect(overtimeMinutes(shift)).toBeNull()
    expect(earlyLeaveMinutes(shift)).toBeNull()
  })

  it("fazla mesai ile erken çıkışı ayırır", () => {
    expect(overtimeMinutes({ ...shift, actualEnd: 1080 })).toBe(60)
    expect(earlyLeaveMinutes({ ...shift, actualEnd: 1080 })).toBe(0)
    expect(earlyLeaveMinutes({ ...shift, actualEnd: 960 })).toBe(60)
  })

  it("tek uç damgalanmışsa fiilî süre hesaplanmaz", () => {
    // Vardiya sürüyor: "0 dakika çalıştı" demek yanlış olurdu.
    expect(actualNetMinutes({ ...shift, actualStart: 540 })).toBeNull()
    expect(actualNetMinutes({ ...shift, actualStart: 540, actualEnd: 1020 })).toBe(420)
  })
})

describe("resolveStampMinute", () => {
  // Gündüz vardiyası: 09:00–17:00 → 540–1020.
  it("gündüz vardiyasında dakikayı olduğu gibi bırakır", () => {
    expect(resolveStampMinute(545, 540, 1020)).toBe(545)
    expect(resolveStampMinute(1015, 540, 1020)).toBe(1015)
  })

  // Gece vardiyası: 22:00–02:00 → 1320–1560.
  it("gece vardiyasında sabaha sarkan damgayı ertesi güne taşır", () => {
    // 01:00'de basılan çıkış ham haliyle 60'tır ve vardiyanın 21 saat öncesine
    // düşerdi; 1500 (ertesi gün 01:00) olmalı.
    expect(resolveStampMinute(60, 1320, 1560)).toBe(1500)
  })

  it("gece vardiyasının başındaki damgayı taşımaz", () => {
    // 21:55'te gelen personel: 1315 plana yakın, 2755 saçma olurdu.
    expect(resolveStampMinute(1315, 1320, 1560)).toBe(1315)
  })

  it("gün sınırını aşacak adayı seçmez", () => {
    // Aday m+1440 iki günü aşıyorsa ham değer korunur.
    expect(resolveStampMinute(1400, 540, 1020)).toBe(1400)
  })
})

describe("gün aritmetiği", () => {
  it("ay ve yıl sınırını doğru geçer", () => {
    expect(shiftDayIso("2026-01-31", 1)).toBe("2026-02-01")
    expect(shiftDayIso("2026-01-01", -1)).toBe("2025-12-31")
    expect(shiftDayIso("2024-02-28", 1)).toBe("2024-02-29") // artık yıl
  })

  it("dayDiff, shiftDayIso'nun tersidir", () => {
    expect(dayDiff("2026-08-03", "2026-08-10")).toBe(7)
    expect(dayDiff("2026-08-10", "2026-08-03")).toBe(-7)
    expect(dayDiff("2026-01-31", "2026-02-01")).toBe(1)
  })

  it("UTC gün çevrimi gidip gelirken kaymaz", () => {
    // Yerel `new Date("2026-08-07")` TSİ'de bir gün geriye kayardı; bu çevrimin
    // varlık sebebi tam olarak bu.
    expect(utcDateToDay(dayToUtcDate("2026-08-07"))).toBe("2026-08-07")
    expect(utcDateToDay(dayToUtcDate("2026-01-01"))).toBe("2026-01-01")
  })
})

describe("hafta", () => {
  it("hafta pazartesi başlar", () => {
    // 2026-08-07 cuma → pazartesi 2026-08-03.
    expect(weekStartIso("2026-08-07")).toBe("2026-08-03")
    expect(weekStartIso("2026-08-03")).toBe("2026-08-03")
  })

  it("pazar ÖNCEKİ haftaya aittir", () => {
    // getDay()=0 olan pazar, düzeltilmezse kendi haftasının başı sanılır ve
    // hafta ızgarası bir hafta ileri kayardı.
    expect(weekStartIso("2026-08-09")).toBe("2026-08-03")
  })

  it("yedi günlük diziyi pazartesiden üretir", () => {
    const days = weekDaysIso("2026-08-03")
    expect(days).toHaveLength(7)
    expect(days[0]).toBe("2026-08-03")
    expect(days[6]).toBe("2026-08-09")
  })

  it("aynı ay içindeki haftada ay adını bir kez yazar", () => {
    expect(weekRangeLabel("2026-08-03")).toBe("3–9 Ağustos 2026")
  })

  it("ay atlayan haftada iki tarihi de tam yazar", () => {
    expect(weekRangeLabel("2026-08-31")).toContain("Eylül")
  })
})
