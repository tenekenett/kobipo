import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { cariVisibilityWhere } from "@/lib/cari/visibility"
import { resolveCariVisibility } from "@/lib/cari/resolve-visibility"
import { assertCariMirrorWrite } from "@/lib/cari/dual-role-access"
import { withApiErrors } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { parseVirmanInput, virmanBacaklari, type VirmanParty } from "@/lib/cari/virman"
import { nextVirmanNo } from "@/lib/cari/virman-db"

export const dynamic = "force-dynamic"

/**
 * CARİ VİRMAN FİŞİ — yeni kayıt (kural: lib/cari/virman.ts).
 *
 * Gövde: { companyId, party: {kind, id}, side: DEBIT|CREDIT,
 *          counterparty?: {kind, id} | null, amount, date?, description? }
 *
 * Kasaya hiçbir şey yazılmaz. Karşı cari verilirse ters yönde ikinci bacak
 * açılır; verilmezse fiş tek taraflıdır. İki bacak aynı veritabanı işleminde
 * yazılır — biri yazılıp öbürü yazılmazsa bakiye yoktan var olurdu.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const companyId = await resolveCompanyId(body?.companyId)
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  }

  const parsed = parseVirmanInput(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const input = parsed.value

  const access = await ensureCompanyWrite(companyId)
  const visibility = await resolveCariVisibility(companyId)

  // Her bacağın carisi: bu firmanın, kullanıcının görebildiği, arşivde olmayan
  // bir kayıt olmalı. Slug gelebilir (SEF URL) → cuid'e çözülür.
  const resolveParty = async (party: VirmanParty) => {
    const id = await resolveSlugId(party.kind, party.id, companyId)
    const where = { id, companyId, ...cariVisibilityWhere(visibility) }
    const select = { id: true, name: true, archivedAt: true }
    const found =
      party.kind === "customer"
        ? await prisma.customer.findFirst({ where, select })
        : await prisma.supplier.findFirst({ where, select })
    return found ? { kind: party.kind, ...found } : null
  }

  const legs = virmanBacaklari(input)
  const resolved = await Promise.all(legs.map((leg) => resolveParty(leg.party)))
  for (const [i, party] of resolved.entries()) {
    if (!party) {
      return NextResponse.json(
        { error: i === 0 ? "Cari bulunamadı" : "Karşı cari bulunamadı" },
        { status: 404 },
      )
    }
    if (party.archivedAt) {
      return NextResponse.json(
        { error: `"${party.name}" arşivlenmiş; arşivdeki cariye virman girilemez` },
        { status: 400 },
      )
    }
  }
  const parties = resolved as NonNullable<(typeof resolved)[number]>[]
  // Slug ile gelen karşı cari, çözüldükten sonra fişin carisiyle aynı çıkabilir.
  if (parties.length === 2 && parties[0].kind === parties[1].kind && parties[0].id === parties[1].id) {
    return NextResponse.json({ error: "Karşı cari, fişin girildiği cariyle aynı olamaz" }, { status: 400 })
  }

  // Sayfa kapısı "iki cari sayfasından biri"ni sordu; burada HER bacağın kendi
  // sayfası sorulur (yalnız müşteri yazabilen, tedarikçiye bacak açamaz).
  for (const kind of new Set(parties.map((p) => p.kind))) {
    await assertCariMirrorWrite(access, kind)
  }

  const create = () =>
    prisma.$transaction(async (db) => {
      const virmanNo = await nextVirmanNo(db, companyId)
      return db.cariVirman.create({
        data: {
          companyId,
          virmanNo,
          date: input.date,
          amount: new Prisma.Decimal(input.amount.toFixed(2)),
          description: input.description,
          createdBy: user.id,
          legs: {
            create: legs.map((leg, i) => ({
              companyId,
              side: leg.side,
              customerId: parties[i].kind === "customer" ? parties[i].id : null,
              supplierId: parties[i].kind === "supplier" ? parties[i].id : null,
            })),
          },
        },
        select: { id: true, virmanNo: true, date: true, amount: true },
      })
    })

  // Eşzamanlı iki kayıt aynı numarayı alırsa tekillik ikincisini reddeder; bir
  // kez daha denenir (o anda en büyük numara değişmiş olur).
  let virman
  try {
    virman = await create()
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      virman = await create()
    } else {
      throw error
    }
  }

  revalidateDashboard(companyId)

  return NextResponse.json(
    { ...virman, amount: Number(virman.amount), legCount: legs.length },
    { status: 201 },
  )
})
