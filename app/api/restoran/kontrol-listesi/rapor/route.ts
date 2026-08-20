// Kontrol listesi uyum raporu — "hangi gün hangi madde eksik kaldı".
//
// Liste bloklamadığı ve tik doğrulanmadığı için özelliğin TEK yaptırım gücü bu
// rapordur: patron eksikleri burada görür.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { dayToUtcDate, utcDateToDay } from "@/lib/personel/vardiya"
import { CHECKLIST_TYPES, type ChecklistType } from "@/lib/restoran/checklist"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

type DayCell = { total: number; done: number; missing: string[] }

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const to = searchParams.get("endDate") ?? ""
    const from = searchParams.get("startDate") ?? ""
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
      return NextResponse.json({ error: "startDate ve endDate YYYY-MM-DD olmalı" }, { status: 400 })
    }
    if (from > to) {
      return NextResponse.json({ error: "startDate endDate'ten büyük olamaz" }, { status: 400 })
    }

    const days = dayRange(from, to)
    if (days.length > 400) {
      return NextResponse.json({ error: "Aralık en fazla 400 gün olabilir" }, { status: 400 })
    }

    const [items, entries] = await Promise.all([
      // Yalnız AKTİF maddeler beklenen sayılır. Pasifleştirilmiş bir madde ne
      // zaman kaldırıldığını taşımıyor (`isActive` tarihsiz); geçmişte beklenmiş
      // saymak "listeden çıkardığım madde aylardır eksik" gibi yanlış bir tablo
      // çizerdi. O maddeye ait TİKLER yine de aşağıda sayılır.
      prisma.checklistItem.findMany({
        where: { companyId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, type: true, title: true, createdAt: true },
      }),
      prisma.checklistEntry.findMany({
        where: {
          companyId,
          workDate: { gte: dayToUtcDate(from), lte: dayToUtcDate(to) },
        },
        select: { itemId: true, type: true, workDate: true, employeeName: true },
      }),
    ])

    const doneKeys = new Set<string>()
    const entriesPerDay = new Map<string, number>()
    const perEmployee = new Map<string, number>()
    for (const entry of entries) {
      const day = utcDateToDay(entry.workDate)
      if (entry.itemId) doneKeys.add(`${entry.itemId}|${day}`)
      entriesPerDay.set(day, (entriesPerDay.get(day) ?? 0) + 1)
      perEmployee.set(entry.employeeName, (perEmployee.get(entry.employeeName) ?? 0) + 1)
    }

    // Bir madde EKLENDİĞİ GÜNDEN önce beklenmez: patron bugün yeni madde yazınca
    // rapor geçmiş ayın tamamını "eksik" göstermemeli.
    const addedDay = new Map(items.map((item) => [item.id, utcDateToDay(item.createdAt)]))

    const perItem = items.map((item) => ({
      id: item.id,
      type: item.type as ChecklistType,
      title: item.title,
      expectedDays: 0,
      doneDays: 0,
    }))
    const perItemIndex = new Map(perItem.map((row, index) => [row.id, index]))

    const rows = days.map((day) => {
      const cells = {} as Record<ChecklistType, DayCell>
      for (const type of CHECKLIST_TYPES) cells[type] = { total: 0, done: 0, missing: [] }

      for (const item of items) {
        if ((addedDay.get(item.id) ?? day) > day) continue
        const cell = cells[item.type as ChecklistType]
        if (!cell) continue

        const stat = perItem[perItemIndex.get(item.id) as number]
        cell.total += 1
        stat.expectedDays += 1

        if (doneKeys.has(`${item.id}|${day}`)) {
          cell.done += 1
          stat.doneDays += 1
        } else {
          cell.missing.push(item.title)
        }
      }

      return {
        date: day,
        opening: cells.OPENING,
        closing: cells.CLOSING,
        // Gün boyunca HİÇ tik atılmamışsa mekân kapalı da olabilir. Rapor bunu
        // "eksik" ile aynı kefeye koymaz, ayırt etmeyi patrona bırakır: kapanış
        // günlerini bilen tek taraf o (tatil takvimi listeyle ilişkilendirilmiyor).
        untouched: (entriesPerDay.get(day) ?? 0) === 0,
      }
    })

    return NextResponse.json({
      from,
      to,
      days: rows,
      // En çok ATLANAN madde başta: patronun raporda aradığı ilk cevap bu.
      items: perItem
        .filter((row) => row.expectedDays > 0)
        .sort((a, b) => b.expectedDays - b.doneDays - (a.expectedDays - a.doneDays)),
      employees: [...perEmployee.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error building checklist report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** from..to arası günler, dahil. İkisi de "YYYY-MM-DD". */
function dayRange(from: string, to: string): string[] {
  const days: string[] = []
  const cursor = dayToUtcDate(from)
  const end = dayToUtcDate(to)
  while (cursor.getTime() <= end.getTime()) {
    days.push(utcDateToDay(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}
