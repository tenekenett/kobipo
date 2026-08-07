import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { DAY_MINUTES, MAX_MINUTE } from "@/lib/personel/vardiya"
import { SHIFT_INCLUDE, statusFor, toShiftDto } from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

const ACTIONS = ["in", "out", "absent", "clear"] as const
type Action = (typeof ACTIONS)[number]

/**
 * Tek dokunuşluk giriş/çıkış damgası.
 *
 * DAKİKA İSTEMCİDEN GELİR, sunucunun saatinden değil: üretimde sunucu UTC'de
 * çalışıyor, "şimdi" oradan okunsaydı TSİ'de 12:00'de basılan damga 09:00 olarak
 * kaydedilirdi. İstemci kendi yerel gününün dakikasını gönderir (0–1439), sunucu
 * yalnız doğrular ve gerekiyorsa ertesi güne taşır.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const action: Action = body.action
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Geçersiz işlem" }, { status: 400 })
  }

  await ensureCompanyWrite(companyId)

  const shift = await prisma.workShift.findFirst({ where: { id, companyId } })
  if (!shift) return NextResponse.json({ error: "Vardiya bulunamadı" }, { status: 404 })

  let actualStart = shift.actualStart
  let actualEnd = shift.actualEnd

  if (action === "absent" || action === "clear") {
    actualStart = null
    actualEnd = null
  } else {
    const raw = Math.round(Number(body.minute))
    if (!Number.isFinite(raw) || raw < 0 || raw >= DAY_MINUTES) {
      return NextResponse.json({ error: "minute 0–1439 arası olmalı" }, { status: 400 })
    }
    const minute = resolveMinute(raw, shift.plannedStart, shift.plannedEnd)
    if (action === "in") actualStart = minute
    else actualEnd = minute
  }

  // Çıkış girişten önce kalamaz: gece 01:00'de basılan çıkış zaten resolveMinute ile
  // ertesi güne taşınır; buraya düşen durum gerçekten hatalı sıradır.
  if (actualStart != null && actualEnd != null && actualEnd < actualStart) {
    return NextResponse.json({ error: "Fiilî çıkış girişten önce olamaz" }, { status: 400 })
  }

  const updated = await prisma.workShift.update({
    where: { id },
    data: {
      actualStart,
      actualEnd,
      status: statusFor(actualStart, actualEnd, action === "absent"),
    },
    include: SHIFT_INCLUDE,
  })

  return NextResponse.json(toShiftDto(updated))
}

/**
 * Gün içi dakikayı vardiyanın eksenine oturtur.
 *
 * Gece vardiyasında (22:00–02:00 → 1320–1560) saat 01:00'de basılan damga ham
 * haliyle 60'tır ve vardiyanın 20 saat ÖNCESİNE düşer. İki aday (m ve m+1440)
 * arasından plana en yakın olanı seçilir.
 */
function resolveMinute(raw: number, plannedStart: number, plannedEnd: number): number {
  const distance = (m: number) =>
    m < plannedStart ? plannedStart - m : m > plannedEnd ? m - plannedEnd : 0
  const next = raw + DAY_MINUTES
  if (next > MAX_MINUTE) return raw
  return distance(next) < distance(raw) ? next : raw
}
