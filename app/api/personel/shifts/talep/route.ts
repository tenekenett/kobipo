import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { localDay, localHour } from "@/lib/restoran/reports"

export const dynamic = "force-dynamic"

/** Geriye kaç hafta bakılacağı. Dört hafta: bir aylık düzeni gösterir, kampanyalı tek bir günü ise ortalar. */
const DEFAULT_WEEKS = 4
const MAX_WEEKS = 12

/**
 * Vardiya planlanan günün TALEP profili — o hafta gününün saatlik yoğunluğu.
 *
 * Takvim bugüne kadar yalnız "kim çalışıyor"u gösteriyordu; "bu saatte kaç kişi
 * lazım" sorusunun cevabı hiçbir yerde yoktu. Kafede bu, planlamanın asıl
 * sorusudur ve verisi zaten elimizde: geçmiş cumaların saatlik adisyon yoğunluğu,
 * gelecek cumanın ihtiyacının en iyi tahminidir.
 *
 * Ölçü ADİSYON SAYISI ve MİSAFİR SAYISI, ciro değil: personel ihtiyacını belirleyen
 * şey masaya taşınan tabak sayısıdır, o masanın ne kadar tuttuğu değil. Pahalı
 * bir şişe şarap ciroyu ikiye katlar ama kimseye ek iş çıkarmaz.
 *
 * SAAT KIRILIMI yerel (`localHour`, Europe/Istanbul): "en yoğun saat 20:00"
 * derken kastedilen TSİ 20:00'dir. Aynı dönüşüm restoran raporlarında da
 * kullanılıyor; iki ekranın aynı saati farklı kovaya atması kabul edilemez.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const weekday = Number(searchParams.get("weekday"))
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return NextResponse.json({ error: "weekday 0–6 arası olmalı" }, { status: 400 })
  }
  const weeks = Math.min(MAX_WEEKS, Math.max(1, Number(searchParams.get("weeks")) || DEFAULT_WEEKS))

  const context = await ensureCompanyAccess(companyId)

  // Restoran modülü kapalıysa BOŞ döner, hata değil: talep şeridi bir ek bilgidir,
  // yokluğunda vardiya takvimi eksiksiz çalışmalı.
  if ((context.disabledModules ?? []).includes("restaurant")) {
    return NextResponse.json({ enabled: false, hours: [], sampleDays: 0 })
  }

  // Pencere: bugünden geriye `weeks` hafta. Gün süzgeci SQL'de yerel takvim
  // gününe göre yapılır; `EXTRACT(DOW)` Postgres'te 0=Pazar, JS `getDay()` ile aynı.
  const since = new Date()
  since.setDate(since.getDate() - weeks * 7)
  since.setHours(0, 0, 0, 0)

  const openedAt = Prisma.sql`t."openedAt"`
  const rows = await prisma.$queryRaw<
    { hour: number; tickets: number; guests: number }[]
  >`
    SELECT
      ${localHour(openedAt)} AS hour,
      COUNT(*)::int AS tickets,
      COALESCE(SUM(COALESCE(t."guestCount", 1)), 0)::int AS guests
    FROM restaurant_tickets t
    WHERE t."companyId" = ${companyId}
      AND t.status <> 'CANCELLED'
      AND t."openedAt" >= ${since}
      AND EXTRACT(DOW FROM ${localDay(openedAt)}) = ${weekday}
    GROUP BY 1
    ORDER BY 1
  `

  // Kaç ayrı gün örneklendi: ortalama alırken bölen bu. Hiç veri yoksa şerit
  // çizilmez — tek bir günün rakamını "tipik cuma" diye göstermek yanıltıcı olurdu.
  const sample = await prisma.$queryRaw<{ days: number }[]>`
    SELECT COUNT(DISTINCT ${localDay(openedAt)})::int AS days
    FROM restaurant_tickets t
    WHERE t."companyId" = ${companyId}
      AND t.status <> 'CANCELLED'
      AND t."openedAt" >= ${since}
      AND EXTRACT(DOW FROM ${localDay(openedAt)}) = ${weekday}
  `

  const sampleDays = sample[0]?.days ?? 0
  return NextResponse.json({
    enabled: true,
    sampleDays,
    // Saat başına ORTALAMA (gün sayısına bölünmüş): ham toplam, dört haftalık
    // veriyle bir haftalık veriyi karşılaştırılamaz hale getirirdi.
    hours: rows.map((r) => ({
      hour: r.hour,
      tickets: sampleDays > 0 ? r.tickets / sampleDays : 0,
      guests: sampleDays > 0 ? r.guests / sampleDays : 0,
    })),
  })
})
