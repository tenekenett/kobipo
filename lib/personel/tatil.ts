/**
 * İşletme tatilleri — vardiya takviminde tatil bandını çizen ve "bu gün tatil mi"
 * sorusunu cevaplayan tek yer.
 *
 * Tatiller GÖMÜLÜ DEĞİL, işveren tanımlar (`CompanyHoliday`). Gerekçe: dinî
 * bayramlar ay takvimine göre kaydığı için sabit bir listeden üretilemez ve her
 * işletme resmî tatilde kapanmaz. Sabit tarihli resmî tatiller aşağıdaki listeden
 * tek tuşla eklenebilir; kayan bayramları işveren kendi girer.
 */

import { isoDay, utcDateToDay } from "@/lib/personel/vardiya"

export type Holiday = {
  id: string
  name: string
  /** "YYYY-MM-DD" */
  date: string
  /** true ise yalnız AY+GÜN eşleşir, yıl yok sayılır. */
  recurring: boolean
  /** Yarım gün tatilde bu dakikadan SONRASI tatildir; null = tam gün. */
  halfDayFrom: number | null
}

/**
 * Türkiye'nin SABİT TARİHLİ resmî tatilleri.
 *
 * Ramazan ve Kurban Bayramı burada YOK: ay takvimine göre kaydıkları için yıla
 * göre hesaplanmaları gerekir ve yanlış tarih, tatil planını sessizce bozar.
 * Onları işveren elle girer.
 */
export const FIXED_HOLIDAYS: { month: number; day: number; name: string; halfDayFrom?: number }[] = [
  { month: 1, day: 1, name: "Yılbaşı" },
  { month: 4, day: 23, name: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { month: 5, day: 1, name: "Emek ve Dayanışma Günü" },
  { month: 5, day: 19, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { month: 7, day: 15, name: "Demokrasi ve Millî Birlik Günü" },
  { month: 8, day: 30, name: "Zafer Bayramı" },
  // 28 Ekim öğleden sonra yarım gün tatildir (13:00'ten itibaren).
  { month: 10, day: 28, name: "Cumhuriyet Bayramı Arifesi", halfDayFrom: 13 * 60 },
  { month: 10, day: 29, name: "Cumhuriyet Bayramı" },
]

/** Verilen yıl için sabit tatillerin gün listesi (arayüzdeki "resmî tatilleri ekle"). */
export const fixedHolidaysForYear = (year: number) =>
  FIXED_HOLIDAYS.map((h) => ({
    name: h.name,
    date: `${year}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`,
    // Sabit tarihliler her yıl aynı güne düşer: tekrar eden olarak kaydedilir ki
    // gelecek yıl yeniden eklemek gerekmesin.
    recurring: true,
    halfDayFrom: h.halfDayFrom ?? null,
  }))

/** Bir güne düşen tatil (tekrar edenlerde yıl yok sayılır); yoksa null. */
export function holidayOn(holidays: Holiday[], day: string): Holiday | null {
  const md = day.slice(5) // "MM-DD"
  for (const h of holidays) {
    if (h.recurring ? h.date.slice(5) === md : h.date === day) return h
  }
  return null
}

/** Aralıktaki her gün için tatil eşlemesi — hafta ızgarası tek seferde okusun. */
export function holidayMap(holidays: Holiday[], days: string[]): Map<string, Holiday> {
  const map = new Map<string, Holiday>()
  for (const d of days) {
    const h = holidayOn(holidays, d)
    if (h) map.set(d, h)
  }
  return map
}

/** Prisma kaydı → istemci şekli. `@db.Date` UTC alanlarından okunur, gün kaymasın. */
export const toHolidayDto = (h: {
  id: string
  name: string
  date: Date
  recurring: boolean
  halfDayFrom: number | null
}): Holiday => ({
  id: h.id,
  name: h.name,
  date: utcDateToDay(h.date),
  recurring: h.recurring,
  halfDayFrom: h.halfDayFrom,
})

/** Bugünün yılı — tatil penceresi varsayılan olarak bu yılı gösterir. */
export const currentYear = () => Number(isoDay(new Date()).slice(0, 4))
