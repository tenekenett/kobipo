/**
 * NAKİT PROJEKSİYONUNUN KOVALARI — SAF modül.
 *
 * Ayrı dosya çünkü hesap (`nakit-projeksiyon.ts`) en üstte Prisma'yı içe
 * aktarıyor; takvim aritmetiğinin veritabanına ihtiyacı yok ve asıl hata payı
 * burada (hafta başı, ay sonu, yıl sınırı).
 *
 * NE YAPAR: bugünkü kasa+banka bakiyesinden başlar, açık alacak ve borçları
 * VADESİNE göre önümüzdeki 12 haftaya (ya da 12 aya) dağıtır ve kümülatif
 * bakiye eğrisini çıkarır. Sorduğu soru "geçen ay ne oldu" değil, "önümüzdeki
 * çeyrekte param bitiyor mu".
 *
 * VADESİ GEÇMİŞ TUTAR EĞRİYE GİRMEZ. Girseydi projeksiyon, aylardır tahsil
 * edilememiş parayı "bugün geliyor" sayardı — yani darboğazı tam da darboğaza
 * girmiş firmada gizlerdi. Ayrı bir rakam olarak durur; vadesi hiç tanımlanmamış
 * tutar da öyle (ne zaman geleceği bilinmiyor).
 */

const TR_MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

export type ProjectionGranularity = "week" | "month"

/** Varsayılan kova sayısı — Paraşüt'ün "gelecek 12 hafta / 12 ay" ekseni. */
export const DEFAULT_BUCKET_COUNT = 12

export type ProjectionItem = {
  /** Etkin vade (cari ödeme vadesi uygulanmış hâli). */
  dueDate: Date | string | null
  /** Açık (tahsil/ödeme bekleyen) tutar. */
  amount: number
  /** `in` = bize gelecek (alacak), `out` = bizden çıkacak (borç). */
  direction: "in" | "out"
  /** Vade TANIMLI mı — tanımsızsa hiçbir kovaya düşmez. */
  hasDueDate: boolean
}

export type ProjectionBucket = {
  /** `2026-W37` ya da `2026-10`. */
  key: string
  label: string
  startDate: string
  endDate: string
  inflow: number
  outflow: number
  net: number
  /** Kova SONUNDAKİ kümülatif bakiye. */
  balance: number
}

export type CashProjection = {
  granularity: ProjectionGranularity
  openingBalance: number
  /** Vadesi GEÇMİŞ açık tutarlar — eğrinin dışında. */
  overdue: { inflow: number; outflow: number }
  /** Vadesi hiç TANIMLANMAMIŞ açık tutarlar — eğrinin dışında. */
  undated: { inflow: number; outflow: number }
  /** Eğrinin ötesine (son kovadan sonrasına) düşen tutarlar. */
  beyond: { inflow: number; outflow: number }
  buckets: ProjectionBucket[]
  /**
   * Eğrinin en düşük noktası — "darboğaz" uyarısı buradan çıkar. Bakiye hiç
   * eksiye düşmüyorsa da doldurulur; ekran eksi olup olmadığına kendi bakar.
   */
  lowestPoint: { key: string; label: string; balance: number } | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Haftanın PAZARTESİSİ. `getDay()` pazarı 0 verir; çıplak `-getDay()` pazar
 * günleri haftayı bir gün ileri kaydırırdı.
 */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  const weekday = (day.getDay() + 6) % 7
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - weekday)
}

/** ISO hafta numarası — kova anahtarı `2026-W37` biçiminde. */
function isoWeekKey(monday: Date): string {
  // Perşembe kuralı: ISO haftası, içinde bulunduğu perşembenin yılına aittir.
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3)
  const yearStart = new Date(thursday.getFullYear(), 0, 1)
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`
}

function dayLabel(date: Date): string {
  return `${date.getDate()} ${TR_MONTHS_SHORT[date.getMonth()]}`
}

/** "8-14 Eyl", ay sınırını aşarsa "29 Eyl-5 Eki". */
function weekLabel(start: Date, end: Date): string {
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}-${end.getDate()} ${TR_MONTHS_SHORT[end.getMonth()]}`
  }
  return `${dayLabel(start)}-${dayLabel(end)}`
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

type BucketFrame = { key: string; label: string; start: Date; endExclusive: Date }

/** Kova çerçeveleri: bugünün haftasından/ayından başlayarak `count` adet. */
function frames(today: Date, granularity: ProjectionGranularity, count: number): BucketFrame[] {
  const out: BucketFrame[] = []

  if (granularity === "week") {
    let cursor = startOfWeek(today)
    for (let i = 0; i < count; i++) {
      const end = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 6)
      const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
      out.push({ key: isoWeekKey(cursor), label: weekLabel(cursor, end), start: cursor, endExclusive: next })
      cursor = next
    }
    return out
  }

  for (let i = 0; i < count; i++) {
    // `new Date(y, m + i, 1)` ay taşmasını kendi çözer: Aralık + 1 → Ocak,
    // yıl da bir artar. Elle mod alsaydık yıl sınırında kova kaybederdik.
    const start = new Date(today.getFullYear(), today.getMonth() + i, 1)
    const next = new Date(today.getFullYear(), today.getMonth() + i + 1, 1)
    out.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: `${TR_MONTHS_SHORT[start.getMonth()]} ${String(start.getFullYear()).slice(-2)}`,
      start,
      endExclusive: next,
    })
  }
  return out
}

export function buildCashProjection(args: {
  today?: Date
  openingBalance: number
  granularity: ProjectionGranularity
  bucketCount?: number
  items: ProjectionItem[]
}): CashProjection {
  const today = startOfDay(args.today ?? new Date())
  const count = args.bucketCount ?? DEFAULT_BUCKET_COUNT
  const frameList = frames(today, args.granularity, count)
  const horizon = frameList.length > 0 ? frameList[frameList.length - 1].endExclusive : today

  const buckets: ProjectionBucket[] = frameList.map((frame) => ({
    key: frame.key,
    label: frame.label,
    startDate: toDateInput(frame.start),
    // Bitiş EKRANDA kapsayıcı: sınır dışlayıcı olduğu için olduğu gibi basılsa
    // hafta "8-15 Eyl" görünürdü (sekiz gün).
    endDate: toDateInput(new Date(frame.endExclusive.getTime() - 86_400_000)),
    inflow: 0,
    outflow: 0,
    net: 0,
    balance: 0,
  }))

  const overdue = { inflow: 0, outflow: 0 }
  const undated = { inflow: 0, outflow: 0 }
  const beyond = { inflow: 0, outflow: 0 }

  const add = (target: { inflow: number; outflow: number }, item: ProjectionItem) => {
    if (item.direction === "in") target.inflow += item.amount
    else target.outflow += item.amount
  }

  for (const item of args.items) {
    if (item.amount === 0) continue
    if (!item.hasDueDate || !item.dueDate) {
      add(undated, item)
      continue
    }

    const due = startOfDay(new Date(item.dueDate))
    // Vadesi BUGÜNDEN ÖNCE dolmuş tutar eğriye girmez (bkz. dosya başlığı).
    if (due < today) {
      add(overdue, item)
      continue
    }
    if (due >= horizon) {
      add(beyond, item)
      continue
    }

    const index = frameList.findIndex((frame) => due >= frame.start && due < frame.endExclusive)
    if (index === -1) {
      // Ufkun içindeyken hiçbir kovaya düşmemek imkânsız; yine de sessizce
      // kaybetmektense "ötesi"ne yazıp toplamı korumak doğrusu.
      add(beyond, item)
      continue
    }
    if (item.direction === "in") buckets[index].inflow += item.amount
    else buckets[index].outflow += item.amount
  }

  let running = args.openingBalance
  let lowest: CashProjection["lowestPoint"] = null
  for (const bucket of buckets) {
    bucket.inflow = round2(bucket.inflow)
    bucket.outflow = round2(bucket.outflow)
    bucket.net = round2(bucket.inflow - bucket.outflow)
    running = round2(running + bucket.net)
    bucket.balance = running
    if (!lowest || bucket.balance < lowest.balance) {
      lowest = { key: bucket.key, label: bucket.label, balance: bucket.balance }
    }
  }

  return {
    granularity: args.granularity,
    openingBalance: round2(args.openingBalance),
    overdue: { inflow: round2(overdue.inflow), outflow: round2(overdue.outflow) },
    undated: { inflow: round2(undated.inflow), outflow: round2(undated.outflow) },
    beyond: { inflow: round2(beyond.inflow), outflow: round2(beyond.outflow) },
    buckets,
    lowestPoint: lowest,
  }
}
