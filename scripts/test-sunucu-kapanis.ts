/**
 * Sunucu tarafı adisyon kapanışı (lib/restoran/close-with-receipt.ts) — OTURUMSUZ.
 * Plan: docs/okc/ASAMA1-KOBIPO.md A5. Aşama 2'deki ÖKC webhook'unun yolu budur.
 *
 * Çalıştırma:
 *   1) npm run dev            (temizlik için: fişler HTTP DELETE ile silinir ki
 *                              kasa/banka bakiyeleri uç mantığıyla geri alınsın)
 *   2) npx tsx scripts/test-sunucu-kapanis.ts
 *
 * Lib fonksiyonları DOĞRUDAN çağrılır, `trustedSystemActor` ile (oturum yok).
 * Demo Firma'da TEST bölge/masa/adisyon açılır, serbest metin kalem (stok etkisi yok).
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { encode } from "next-auth/jwt"
import { prisma } from "@/lib/db/prisma"
import { trustedSystemActor } from "@/lib/api/write-actor"
import { closeTicketWithReceipt } from "@/lib/restoran/close-with-receipt"
import { prepareTicketClose } from "@/lib/restoran/close-ticket"
import { createInvoiceFromBody } from "@/lib/invoice/create-invoice"
import { accountForMethod, defaultPaymentAccounts } from "@/lib/satis/payment"

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
let pass = 0
let fail = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else {
    fail++
    failures.push(label)
  }
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail !== undefined ? ` → ${String(detail)}` : ""}`)
}
const near = (a: unknown, b: number, tol = 0.011) => Math.abs(Number(a) - b) <= tol

async function main() {
  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı")
  const C = company.id
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: C, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  })
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET!
  const cookie = `next-auth.session-token=${await encode({
    token: {
      id: membership!.userId,
      email: membership!.user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
      defaultCompanyId: C,
      defaultRole: "ADMIN",
    },
    secret,
  })}`

  const actor = trustedSystemActor("system:test")
  const stamp = Date.now().toString().slice(-6)
  const created = { areaId: "", tableId: "", ticketIds: [] as string[], invoiceIds: [] as string[] }
  console.log(`Firma: ${company.name}\n`)

  const openTicket = async (code: string, items: Array<{ d: string; q: number; p: number }>) => {
    const t = await prisma.restaurantTicket.create({
      data: {
        companyId: C,
        tableId: created.tableId,
        code,
        status: "OPEN",
        items: {
          create: items.map((i, order) => ({
            description: i.d,
            quantity: i.q,
            unitPrice: i.p,
            vatRate: 10,
            order,
          })),
        },
      },
      select: { id: true, code: true },
    })
    created.ticketIds.push(t.id)
    return t
  }

  try {
    const area = await prisma.restaurantArea.create({ data: { companyId: C, name: `TEST Sunucu ${stamp}` } })
    created.areaId = area.id
    const table = await prisma.restaurantTable.create({
      data: { companyId: C, name: `TS${stamp}`, areaId: area.id },
    })
    created.tableId = table.id

    console.log("1) Oturumsuz kapanış: fiş + 2 tahsilat + kapanış")
    const t1 = await openTicket(`TST-${stamp}-1`, [
      { d: "TEST Çay", q: 2, p: 25 },
      { d: "TEST Tost", q: 1, p: 100 },
    ])
    const r1 = await closeTicketWithReceipt({
      companyId: C,
      ticketId: t1.id,
      actor,
      payments: [
        { method: "CASH", amount: 65 },
        { method: "CREDIT_CARD", amount: 100 },
      ],
    })
    if (r1.ok) created.invoiceIds.push(r1.invoiceId!)
    else if (r1.invoiceId) created.invoiceIds.push(r1.invoiceId)
    check("kapandı", r1.ok, r1.ok ? `${r1.invoiceNo} · ${r1.total}` : `${r1.stage}: ${r1.error}`)
    if (r1.ok) {
      check("fiş toplamı 165", near(r1.total, 165))
      const inv = await prisma.invoice.findUnique({
        where: { id: r1.invoiceId! },
        select: { isReceipt: true, createdBy: true, payments: { select: { paymentMethod: true, amount: true, accountId: true } } },
      })
      check("satış fişi (isReceipt)", inv?.isReceipt === true)
      check("createdBy = system:test (iz)", inv?.createdBy === "system:test", inv?.createdBy)
      check("iki tahsilat yazıldı", inv?.payments.length === 2)
      const accounts = await prisma.financialAccount.findMany({
        where: { companyId: C, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, type: true },
      })
      const defaults = defaultPaymentAccounts(accounts)
      const card = inv?.payments.find((p) => p.paymentMethod === "CREDIT_CARD")
      const cash = inv?.payments.find((p) => p.paymentMethod === "CASH")
      check(
        "kanallar ekranla aynı kuraldan (kart → POS/banka, nakit → kasa)",
        card?.accountId === (accountForMethod("CREDIT_CARD", defaults) ?? card?.accountId) &&
          cash?.accountId === (accountForMethod("CASH", defaults) ?? cash?.accountId),
      )
      const t = await prisma.restaurantTicket.findUnique({ where: { id: t1.id }, select: { status: true, invoiceId: true } })
      check("adisyon CLOSED ve fişe bağlı", t?.status === "CLOSED" && t?.invoiceId === r1.invoiceId)
      const tb = await prisma.restaurantTable.findUnique({ where: { id: table.id }, select: { cleaningSince: true } })
      check("masa 'temizlenecek'", tb?.cleaningSince != null)
    }

    console.log("\n2) Yarım kalan deneme: sahipsiz fiş YENİDEN kullanılır")
    const t2 = await openTicket(`TST-${stamp}-2`, [{ d: "TEST Su", q: 3, p: 10 }])
    const prepRes = await prepareTicketClose(C, t2.id, actor.authorize)
    const prep = await prepRes.json()
    const orphanRes = await createInvoiceFromBody(async () => ({ ...prep.invoicePayload }), actor)
    const orphan = await orphanRes.json()
    created.invoiceIds.push(orphan.id)
    check("önceki deneme fişi kesti ama kapanmadı", orphanRes.status === 201)
    const r2 = await closeTicketWithReceipt({
      companyId: C,
      ticketId: t2.id,
      actor,
      payments: [{ method: "CASH", amount: 33 }],
    })
    check("kapandı", r2.ok, r2.ok ? "" : `${r2.stage}: ${r2.error}`)
    check("sahipsiz fiş kullanıldı (reusedInvoice)", r2.ok && r2.reusedInvoice && r2.invoiceId === orphan.id)
    const sameStamp = await prisma.invoice.count({
      where: { companyId: C, notes: { startsWith: t2.code }, status: { not: "CANCELLED" } },
    })
    check("ikinci fiş kesilmedi (tek fiş)", sameStamp === 1, sameStamp)

    console.log("\n3) Fazla tahsilat reddedilir, sessiz geçilmez")
    const t3 = await openTicket(`TST-${stamp}-3`, [{ d: "TEST Kek", q: 1, p: 50 }])
    const r3 = await closeTicketWithReceipt({
      companyId: C,
      ticketId: t3.id,
      actor,
      payments: [{ method: "CASH", amount: 999 }],
    })
    if (!r3.ok && r3.invoiceId) created.invoiceIds.push(r3.invoiceId)
    check("fazla tahsilat → payment/409", !r3.ok && r3.stage === "payment" && r3.status === 409, r3.ok ? "" : r3.error)
    const t3row = await prisma.restaurantTicket.findUnique({ where: { id: t3.id }, select: { status: true } })
    check("adisyon açık kaldı", t3row?.status === "OPEN")

    console.log("\n4) Kapalı adisyon ikinci kez kapanmaz")
    const again = await closeTicketWithReceipt({ companyId: C, ticketId: t1.id, actor, payments: [] })
    check("kapalı adisyon → prepare/409", !again.ok && again.stage === "prepare" && again.status === 409)
  } finally {
    console.log("\n5) Temizlik")
    for (const id of created.invoiceIds.filter(Boolean)) {
      const res = await fetch(`${BASE}/api/e-donusum/invoices/${id}?companyId=${C}`, { method: "DELETE", headers: { cookie } })
      check("test fişi silindi", res.ok, `HTTP ${res.status}`)
    }
    await prisma.restaurantTicket.deleteMany({ where: { id: { in: created.ticketIds } } })
    if (created.tableId) await prisma.restaurantTable.deleteMany({ where: { id: created.tableId } })
    if (created.areaId) await prisma.restaurantArea.deleteMany({ where: { id: created.areaId } })
  }

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı`)
  if (failures.length) console.log("Kalanlar:\n  - " + failures.join("\n  - "))
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((e) => {
    console.error("\nHATA:", e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
