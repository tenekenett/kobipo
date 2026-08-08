/**
 * İş Kanunu uyarılarının testleri.
 *
 * Bu hesap sessizce yanlış olabilecek türden: uyarı çıkmadığında ekran normal
 * görünür ve kimse eksik uyarıyı fark etmez. Özellikle iki durum geçmişte
 * gerçekten kör kaldı ve testleri burada: gece vardiyasının ertesi güne taşması
 * ve dinlenme denetiminin HAFTA SINIRINI aşması.
 */

import { describe, expect, it } from "vitest"
import { laborWarnings, type LaborShift } from "./is-kanunu"
import { weekDaysIso } from "./vardiya"

const WEEK = weekDaysIso("2026-08-03") // Pzt 3 Ağustos → Paz 9 Ağustos

const shift = (day: string, start: number, end: number, breakMinutes = 0): LaborShift => ({
  workDate: day,
  plannedStart: start,
  plannedEnd: end,
  breakMinutes,
})

const codes = (list: { code: string }[]) => list.map((w) => w.code)

describe("laborWarnings", () => {
  it("vardiyasız personelde uyarı üretmez", () => {
    expect(laborWarnings([], WEEK)).toEqual([])
  })

  it("normal bir hafta temiz geçer", () => {
    // 5 gün × 8 saat = 40 saat, iki gün tatil.
    const shifts = WEEK.slice(0, 5).map((d) => shift(d, 540, 1020, 0))
    expect(laborWarnings(shifts, WEEK)).toEqual([])
  })

  it("haftalık 45 saati aşınca uyarır", () => {
    // 6 gün × 8 saat = 48 saat.
    const shifts = WEEK.slice(0, 6).map((d) => shift(d, 540, 1020, 0))
    expect(codes(laborWarnings(shifts, WEEK))).toContain("WEEKLY")
  })

  it("mola 45 saatin dışındadır", () => {
    // 6 gün × 8 saat = 48 saat BRÜT (sınırın üstünde), ama molalar düşülünce
    // 6 × 7 = 42 saat NET (sınırın altında) → uyarı çıkmamalı. Ara dinlenmeler
    // çalışma süresinden sayılmaz (m.68).
    const shifts = WEEK.slice(0, 6).map((d) => shift(d, 540, 1020, 60))
    expect(codes(laborWarnings(shifts, WEEK))).not.toContain("WEEKLY")
  })

  it("günlük 11 saati aynı günün TOPLAMINDAN ölçer", () => {
    // Sabah 6 saat + akşam 6 saat = 12 saat; tek tek bakılsaydı ikisi de sınırın altında.
    const shifts = [shift(WEEK[0], 360, 720), shift(WEEK[0], 900, 1260)]
    expect(codes(laborWarnings(shifts, WEEK))).toContain("DAILY")
  })

  it("aynı gündeki iki vardiya arası dinlenme sayılmaz", () => {
    // Öğlen + akşam servisi olağandır; aradaki boşluk ara dinlenmedir (m.68).
    const shifts = [shift(WEEK[0], 600, 840), shift(WEEK[0], 1020, 1320)]
    expect(codes(laborWarnings(shifts, WEEK))).not.toContain("REST")
  })

  it("iki gün arasında 11 saatten az dinlenme varsa uyarır", () => {
    // Pzt 14:00–22:00, Sal 06:00 → 8 saat dinlenme.
    const shifts = [shift(WEEK[0], 840, 1320), shift(WEEK[1], 360, 840)]
    expect(codes(laborWarnings(shifts, WEEK))).toContain("REST")
  })

  it("gece vardiyası ertesi güne taşınır ve dinlenme ondan sonra ölçülür", () => {
    // Pzt 22:00–02:00 (1320–1560, yani salı 02:00), Sal 08:00 → 6 saat dinlenme.
    const shifts = [shift(WEEK[0], 1320, 1560), shift(WEEK[1], 480, 960)]
    expect(codes(laborWarnings(shifts, WEEK))).toContain("REST")
  })

  it("yedi gün dolu ise hafta tatili uyarısı verir", () => {
    const shifts = WEEK.map((d) => shift(d, 540, 840))
    expect(codes(laborWarnings(shifts, WEEK))).toContain("NO_DAY_OFF")
  })

  it("hafta dışındaki vardiyalar toplamlara girmez", () => {
    // Önceki haftanın altı vardiyası 45 saati aşırırdı; sayılmamalı.
    const outside = Array.from({ length: 6 }, (_, i) =>
      shift(weekDaysIso("2026-07-27")[i], 540, 1020),
    )
    expect(laborWarnings([...outside, shift(WEEK[0], 540, 1020)], WEEK)).toEqual([])
  })

  describe("hafta sınırı", () => {
    it("komşu gün verilmezse sınırdaki ihlal GÖRÜNMEZ", () => {
      // Bu, düzeltmeden önceki davranış: pazar gecesi biten vardiyadan sonra
      // pazartesi sabahı gelen vardiya bir SONRAKİ haftadadır.
      const shifts = [shift(WEEK[6], 1320, 1560)] // Paz 22:00–02:00
      expect(codes(laborWarnings(shifts, WEEK))).not.toContain("REST")
    })

    it("komşu gün verilince sınırdaki ihlali yakalar", () => {
      const shifts = [shift(WEEK[6], 1320, 1560)] // Paz 22:00 → Pzt 02:00
      const adjacent = [shift("2026-08-10", 480, 960)] // ertesi Pzt 08:00 → 6 saat ara
      expect(codes(laborWarnings(shifts, WEEK, adjacent))).toContain("REST")
    })

    it("komşu günler haftalık 45 saat toplamına GİRMEZ", () => {
      // Hafta içi 5×8=40 saat (sınırın altında); komşu günlerde 2×8 saat daha var.
      const shifts = WEEK.slice(0, 5).map((d) => shift(d, 540, 1020))
      const adjacent = [shift("2026-08-02", 540, 1020), shift("2026-08-10", 540, 1020)]
      expect(codes(laborWarnings(shifts, WEEK, adjacent))).not.toContain("WEEKLY")
    })

    it("iki komşu gün birbiriyle karşılaştırılmaz", () => {
      // Haftanın kendi vardiyası ortada duruyor; önceki ve sonraki günler
      // birbirine 11 saatten yakın olamaz zaten, ama kural açıkça test ediliyor.
      const shifts = [shift(WEEK[3], 540, 1020)]
      const adjacent = [shift("2026-08-02", 1320, 1560), shift("2026-08-10", 480, 960)]
      expect(codes(laborWarnings(shifts, WEEK, adjacent))).not.toContain("REST")
    })
  })
})
