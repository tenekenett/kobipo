/**
 * TEK DÜZE ÇALIŞMA — devam (puantaj) kuralları.
 *
 * Vardiya takvimi "kim saat kaçta" sorusunu çözer; her gün aynı saatte gelen bir
 * ekipte o soru yoktur ve saatli ızgara yalnızca kafa karıştırır. Bu dosya öbür
 * soruyu çözer: "bu ay kim kaç gün çalıştı, kim izinliydi" — bordronun gün
 * kesintisi buradan çıkar.
 *
 * SATIR = İSTİSNA. `AttendanceDay` yalnız SAPMA için yazılır; kayıt yoksa günün
 * durumu türetilir (`effectiveDayStatus`). Aylık maaşlı çalışanda olağan hâl
 * "çalıştı" olduğu için kullanıcı 30 gün × 30 kişi işaretlemez, yalnız izinli ve
 * gelmeyen günleri tıklar.
 *
 * Saf fonksiyonlar: hem sunucu özeti (lib/personel/devam-ozet.ts) hem haftalık
 * takvim ekranı buradan okur. İki taraf kendi kuralını yazsaydı ekranda "izinli"
 * görünen gün bordroda kesintiye girebilirdi.
 */

import { openingOfDay, type OpeningHours } from "@/lib/personel/opening-hours"
import { holidayOn, type Holiday } from "@/lib/personel/tatil"
import { weekdayOf } from "@/lib/personel/vardiya"

export type DevamStatus =
  | "WORKED"
  | "HALF_DAY"
  | "PAID_LEAVE"
  | "SICK"
  | "UNPAID_LEAVE"
  | "ABSENT"
  | "HOLIDAY"
  | "WEEKLY_OFF"

/**
 * Durumun bordroya etkisi.
 *
 * `workedDays` çalışılmış gün sayısına, `deductionDays` ücretten düşülecek gün
 * sayısına katkıdır. İkisi bağımsızdır: ücretli izinde ne çalışma vardır ne
 * kesinti — ücret tam ödenir.
 *
 * RAPORLU (SICK) kesinti üretmez. İstirahat günlerinde geçici iş göremezlik
 * ödeneğini SGK öder ve işverenin ücretten kesip kesmeyeceği işletmeye/sözleşmeye
 * göre değişen bir karardır; sunucuda sabitlenirse kullanıcı göremeden bordroya
 * girer. Bordro penceresi bunu ayrı bir seçenek olarak sorar.
 */
export const DEVAM_STATUS: Record<
  DevamStatus,
  { label: string; short: string; workedDays: number; deductionDays: number; tone: string }
> = {
  WORKED: { label: "Çalıştı", short: "Ç", workedDays: 1, deductionDays: 0, tone: "worked" },
  HALF_DAY: { label: "Yarım gün", short: "½", workedDays: 0.5, deductionDays: 0.5, tone: "half" },
  PAID_LEAVE: { label: "Ücretli izin", short: "İ", workedDays: 0, deductionDays: 0, tone: "leave" },
  SICK: { label: "Raporlu", short: "R", workedDays: 0, deductionDays: 0, tone: "sick" },
  UNPAID_LEAVE: {
    label: "Ücretsiz izin",
    short: "Ü",
    workedDays: 0,
    deductionDays: 1,
    tone: "unpaid",
  },
  ABSENT: { label: "Devamsız", short: "D", workedDays: 0, deductionDays: 1, tone: "absent" },
  HOLIDAY: { label: "Tatil", short: "T", workedDays: 0, deductionDays: 0, tone: "holiday" },
  WEEKLY_OFF: { label: "Hafta tatili", short: "—", workedDays: 0, deductionDays: 0, tone: "off" },
}

export const DEVAM_STATUSES = Object.keys(DEVAM_STATUS) as DevamStatus[]

export const isDevamStatus = (v: unknown): v is DevamStatus =>
  typeof v === "string" && v in DEVAM_STATUS

/** Hücrenin durumu nereden geldi — ekran "türetildi" ile "işaretlendi"yi ayırır. */
export type DevamSource =
  /** Kullanıcı elle işaretledi (AttendanceDay satırı var). */
  | "record"
  /** İzin modülünde onaylı izin kaydı var. */
  | "leave"
  /** İşletme tatili (CompanyHoliday). */
  | "holiday"
  /** Açılış saatlerinde kapalı gün. */
  | "closed"
  /** Varsayılan: aylık maaşlının olağan hâli. */
  | "default"
  /** İşe giriş öncesi / çıkış sonrası — personel o gün şirkette değil. */
  | "employment"

export type DevamCell = {
  /** İşe giriş öncesi/çıkış sonrası günlerde null: sayıma hiç girmez. */
  status: DevamStatus | null
  source: DevamSource
  note?: string | null
}

export type DevamLeave = {
  employeeId: string
  /** ANNUAL | EXCUSE | SICK | UNPAID */
  type: string
  /** "YYYY-MM-DD" */
  startDay: string
  endDay: string
}

/** İzin türü → devam durumu. Ücretsiz izin kesinti üretir, diğerleri üretmez. */
export function leaveToStatus(type: string): DevamStatus {
  if (type === "UNPAID") return "UNPAID_LEAVE"
  if (type === "SICK") return "SICK"
  return "PAID_LEAVE"
}

export type DevamEmployee = {
  id: string
  /** "YYYY-MM-DD" — boşsa sınır uygulanmaz. */
  hireDay?: string | null
  terminationDay?: string | null
}

/**
 * Bir personelin bir gününün EFEKTİF durumu.
 *
 * Sıra bilerek böyledir ve değiştirilmemelidir:
 *   1. istihdam sınırı — girmemiş/çıkmış personel hiçbir sayıma girmez
 *   2. elle işaretlenmiş kayıt — kullanıcının kararı her türetmeyi yener
 *   3. onaylı izin — izin modülü ile takvim ayrışmasın
 *   4. işletme tatili
 *   5. açılış saatlerinde kapalı gün → hafta tatili
 *   6. varsayılan: çalıştı
 *
 * (3) ile (4) yer değiştirseydi tatile denk gelen yıllık izin "tatil" görünür,
 * izin bakiyesinden düşen gün takvimde kaybolurdu.
 */
export function effectiveDayStatus(args: {
  day: string
  employee: DevamEmployee
  record?: { status: string; note?: string | null } | null
  leaves?: DevamLeave[]
  holidays?: Holiday[]
  openingHours?: OpeningHours | null
}): DevamCell {
  const { day, employee, record, leaves = [], holidays = [], openingHours = null } = args

  if (employee.hireDay && day < employee.hireDay) return { status: null, source: "employment" }
  if (employee.terminationDay && day > employee.terminationDay)
    return { status: null, source: "employment" }

  if (record && isDevamStatus(record.status)) {
    return { status: record.status, source: "record", note: record.note ?? null }
  }

  const leave = leaves.find(
    (l) => l.employeeId === employee.id && l.startDay <= day && l.endDay >= day,
  )
  if (leave) return { status: leaveToStatus(leave.type), source: "leave" }

  const holiday = holidayOn(holidays, day)
  if (holiday) return { status: "HOLIDAY", source: "holiday", note: holiday.name }

  // Açılış saati TANIMSIZSA hafta tatili türetilmez: tanımsız firmada her günü
  // "çalıştı" saymak, kullanıcının hiç girmediği bir çalışma takvimini bordroya
  // sokmaktan daha güvenli — kesinti üretmeyen tarafta kalır.
  if (openingHours && !openingOfDay(openingHours, weekdayOf(day))) {
    return { status: "WEEKLY_OFF", source: "closed" }
  }

  return { status: "WORKED", source: "default" }
}

export type DevamOzet = {
  workedDays: number
  deductionDays: number
  /** Durum bazında gün sayısı — ekran ve dışa aktarım aynı kırılımı gösterir. */
  counts: Record<DevamStatus, number>
}

export const emptyCounts = (): Record<DevamStatus, number> =>
  DEVAM_STATUSES.reduce(
    (acc, key) => {
      acc[key] = 0
      return acc
    },
    {} as Record<DevamStatus, number>,
  )

/** Hücre listesini aylık özete indirger. Boş (istihdam dışı) günler sayılmaz. */
export function summarize(cells: DevamCell[]): DevamOzet {
  const counts = emptyCounts()
  let workedDays = 0
  let deductionDays = 0
  for (const cell of cells) {
    if (!cell.status) continue
    counts[cell.status] += 1
    workedDays += DEVAM_STATUS[cell.status].workedDays
    deductionDays += DEVAM_STATUS[cell.status].deductionDays
  }
  return { workedDays, deductionDays, counts }
}

/**
 * Kesinti günü — bordro penceresinin sorduğu iki seçenekle birlikte.
 *
 * Raporlu ve ücretsiz izin ayrı ayrı açılıp kapanabilir; devamsızlık her zaman
 * kesintidir (ücretsiz sayılmayan bir devamsızlık zaten devamsızlık değildir).
 */
export function deductionDaysFor(
  counts: Record<DevamStatus, number>,
  options: { countSick?: boolean; countUnpaid?: boolean } = {},
): number {
  const { countSick = false, countUnpaid = true } = options
  let days = counts.ABSENT + counts.HALF_DAY * DEVAM_STATUS.HALF_DAY.deductionDays
  if (countUnpaid) days += counts.UNPAID_LEAVE
  if (countSick) days += counts.SICK
  return Math.round(days * 2) / 2
}
