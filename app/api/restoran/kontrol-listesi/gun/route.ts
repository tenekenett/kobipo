// Bir GÜNÜN kontrol listesi durumu + onay atma/kaldırma.
//
// Gün, istemcinin YEREL günü olarak gelir ("YYYY-MM-DD") ve `@db.Date` kolonuna
// UTC gece yarısı olarak yazılır (bkz. lib/personel/vardiya.ts, aynı desen):
// TSİ 00:30'da atılan kapanış tiki dünün listesine düşmesin.
//
// Onay satırı YOKSA madde yapılmamıştır — ayrı "yapılmadı" durumu tutulmuyor.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { dayToUtcDate } from "@/lib/personel/vardiya"
import { CHECKLIST_TITLE_MAX, isChecklistType, type ChecklistDay } from "@/lib/restoran/checklist"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const type = searchParams.get("type")
    if (!isChecklistType(type)) {
      return NextResponse.json({ error: "type OPENING veya CLOSING olmalı" }, { status: 400 })
    }

    const date = searchParams.get("date") ?? ""
    if (!DAY_RE.test(date)) {
      return NextResponse.json({ error: "date YYYY-MM-DD olmalı" }, { status: 400 })
    }

    const workDate = dayToUtcDate(date)

    const [items, entries, employees] = await Promise.all([
      prisma.checklistItem.findMany({
        where: { companyId, type, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true, sortOrder: true, isActive: true },
      }),
      prisma.checklistEntry.findMany({
        where: { companyId, type, workDate },
        select: {
          id: true,
          itemId: true,
          employeeId: true,
          employeeName: true,
          note: true,
          checkedAt: true,
        },
      }),
      // Personel listesi BU uçtan dönüyor, `/api/personel/employees`ten değil:
      // o uç `hr` modülüne bağlı (lib/module-access.ts) ve yalnız restoran paketi
      // almış bir işletmede 403 verir — oysa isim seçimi bu akışın çekirdeği.
      // Aynı istekte gelmesi ekranın ikinci ağ turunu da ortadan kaldırıyor.
      prisma.employee.findMany({
        where: { companyId, status: "ACTIVE" },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true, position: true },
      }),
    ])

    const entryOf = new Map(entries.filter((e) => e.itemId).map((e) => [e.itemId as string, e]))

    const payload: ChecklistDay = {
      date,
      type,
      items: items.map((item) => {
        const entry = entryOf.get(item.id)
        return {
          id: item.id,
          title: item.title,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
          entry: entry
            ? {
                id: entry.id,
                employeeId: entry.employeeId,
                employeeName: entry.employeeName,
                note: entry.note,
                checkedAt: entry.checkedAt.toISOString(),
              }
            : null,
        }
      }),
      employees: employees.map((e) => ({
        id: e.id,
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || "—",
        position: e.position ?? null,
      })),
    }

    return NextResponse.json(payload)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching checklist day:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Onay at. Aynı madde aynı gün ikinci kez gönderilirse mevcut onay döner. */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const date = String(body.date ?? "")
    if (!DAY_RE.test(date)) {
      return NextResponse.json({ error: "date YYYY-MM-DD olmalı" }, { status: 400 })
    }

    const item = await prisma.checklistItem.findFirst({
      where: { id: String(body.itemId ?? ""), companyId },
      select: { id: true, type: true, title: true },
    })
    if (!item) return NextResponse.json({ error: "Madde bulunamadı" }, { status: 404 })

    // Personel seçimi ZORUNLU DEĞİL: personel kartı hiç tanımlamamış bir kafede
    // (İK modülü kapalı olabilir) akış tıkanmasın. Seçim yoksa tiki atan Kobipo
    // kullanıcısının adı yazılır — "kimse" yazmaktan iyidir, ekran da seçiciyi
    // liste boşsa gizler.
    let employeeId: string | null = null
    let employeeName = (user.name ?? user.email ?? "—").trim()

    if (body.employeeId) {
      const employee = await prisma.employee.findFirst({
        where: { id: String(body.employeeId), companyId },
        select: { id: true, firstName: true, lastName: true },
      })
      if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })
      employeeId = employee.id
      employeeName = `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || "—"
    }

    const workDate = dayToUtcDate(date)
    const note = body.note ? String(body.note).trim().slice(0, 500) : null

    // upsert: iki kasiyer aynı maddeyi aynı anda işaretlerse ikinci istek
    // benzersiz kısıta çakıp 500 dönmesin — son gönderen kazanır.
    const entry = await prisma.checklistEntry.upsert({
      where: { companyId_itemId_workDate: { companyId, itemId: item.id, workDate } },
      create: {
        companyId,
        itemId: item.id,
        type: item.type,
        workDate,
        itemTitle: item.title.slice(0, CHECKLIST_TITLE_MAX),
        employeeId,
        employeeName: employeeName.slice(0, CHECKLIST_TITLE_MAX),
        note,
        checkedBy: user.id,
      },
      update: {
        employeeId,
        employeeName: employeeName.slice(0, CHECKLIST_TITLE_MAX),
        note,
        checkedBy: user.id,
      },
      select: {
        id: true,
        itemId: true,
        employeeId: true,
        employeeName: true,
        note: true,
        checkedAt: true,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error creating checklist entry:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Onayı kaldır — yanlış maddeye basıldığında geri alınabilsin. */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const date = searchParams.get("date") ?? ""
    if (!DAY_RE.test(date)) {
      return NextResponse.json({ error: "date YYYY-MM-DD olmalı" }, { status: 400 })
    }

    const itemId = searchParams.get("itemId")
    if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 })

    // deleteMany: kayıt yoksa da 200 döner (kullanıcı zaten kaldırılmış bir
    // onayı ikinci kez kaldırmaya çalışmış olabilir).
    const result = await prisma.checklistEntry.deleteMany({
      where: { companyId, itemId, workDate: dayToUtcDate(date) },
    })

    return NextResponse.json({ success: true, removed: result.count })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting checklist entry:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
