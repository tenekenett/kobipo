/**
 * "Ayrı hesaplara ayır" uçtan uca testi — adet bölme, iskonto dağılımı, masada
 * birden çok hesap, kapanış sırası ve masa damgası. Plan: docs/okc/ASAMA1-KOBIPO.md A4
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-hesap-bolme.mjs
 *
 * Oturum ve temizlik test-restoran-adisyon.mjs ile aynı: Demo Firma'da TEST bölge
 * + masa açılır, serbest metin kalemlerle (stok etkisi yok) çalışılır; fişler API'den
 * silinir, adisyon/masa/bölge kaldırılır.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const failures = []
function check(label, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}${detail ? ` → ${detail}` : ""}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`)
  }
}
const near = (a, b, tol = 0.011) => Math.abs(Number(a) - Number(b)) <= tol

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true, disabledModules: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı")
  if (company.disabledModules.includes("restaurant")) throw new Error("Demo Firma'da restoran modülü kapalı")
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  })
  const employee = await prisma.employee.findFirst({
    where: { companyId: company.id, status: "ACTIVE" },
    select: { id: true },
  })

  const token = await encode({
    token: {
      id: membership.userId,
      email: membership.user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
      defaultCompanyId: company.id,
      defaultRole: "ADMIN",
    },
    secret,
  })
  const cookie = `next-auth.session-token=${token}`
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    return { status: res.status, body: json }
  }

  console.log(`Firma : ${company.name}\nSunucu: ${BASE}\n`)
  const stamp = Date.now().toString().slice(-6)
  const created = { areaId: null, tableIds: [], ticketIds: [], invoiceIds: [] }
  const C = company.id

  try {
    console.log("1) Masa ve adisyon")
    const area = await api("POST", "/api/restoran/bolgeler", { companyId: C, name: `TEST Bölme ${stamp}` })
    created.areaId = area.body?.id
    const table = await api("POST", "/api/restoran/masalar", { companyId: C, name: `TB${stamp}`, areaId: area.body?.id })
    const table2 = await api("POST", "/api/restoran/masalar", { companyId: C, name: `TC${stamp}`, areaId: area.body?.id })
    created.tableIds.push(table.body?.id, table2.body?.id)
    check("masalar açıldı", table.status === 201 && table2.status === 201, `${table.status}/${table2.status}`)

    const open = await api("POST", "/api/restoran/adisyonlar", { companyId: C, tableId: table.body.id })
    const source = open.body
    created.ticketIds.push(source?.id)
    check("adisyon açıldı", open.status === 201, source?.code)

    const add = await api("POST", `/api/restoran/adisyonlar/${source.id}/kalemler`, {
      companyId: C,
      items: [
        { description: "TEST Çay", quantity: 3, unitPrice: 25, vatRate: 10 },
        { description: "TEST Tost", quantity: 1, unitPrice: 100, vatRate: 10 },
        { description: "TEST Kek", quantity: 1, unitPrice: 50, vatRate: 10 },
      ],
    })
    check("3 kalem eklendi", add.status === 201 && add.body?.items?.length === 3, `HTTP ${add.status} ${add.body?.error ?? ""}`)
    const item = (name) => add.body.items.find((i) => i.description === name)
    const cay = item("TEST Çay")
    const tost = item("TEST Tost")
    const kek = item("TEST Kek")

    const comp = await api("PATCH", `/api/restoran/adisyonlar/${source.id}/kalemler/${kek.id}`, {
      companyId: C,
      status: "COMP",
      reasonCode: "STAFF",
      reason: "test ikramı",
      compEmployeeId: employee?.id,
    })
    check("kek ikram işaretlendi", comp.status === 200, `HTTP ${comp.status} ${comp.body?.error ?? ""}`)

    const disc = await api("PATCH", `/api/restoran/adisyonlar/${source.id}`, {
      companyId: C,
      discountType: "AMOUNT",
      discountValue: 10,
      discountReasonCode: "LOYAL",
      discountReason: "test iskontosu",
      discountEmployeeId: employee?.id,
    })
    // brüt: 3×27,5 + 110 = 192,5 (ikram hariç) − 10 = 182,5
    check("10 ₺ hesap iskontosu", disc.status === 200 && near(disc.body?.totals?.total, 182.5), `${disc.body?.totals?.total ?? disc.body?.error}`)

    console.log("\n2) Kural korunuyor: masaya ikinci adisyon AÇILAMAZ")
    const second = await api("POST", "/api/restoran/adisyonlar", { companyId: C, tableId: table.body.id })
    check("aynı masaya yeni adisyon → 409, mevcut döner", second.status === 409 && second.body?.ticket?.id === source.id)

    console.log("\n3) Geçersiz bölmeler")
    const all = await api("POST", `/api/restoran/adisyonlar/${source.id}/bol`, {
      companyId: C,
      parts: [{ items: [{ itemId: cay.id, quantity: 3 }, { itemId: tost.id, quantity: 1 }] }],
    })
    check("hesabın tamamı ayrılamaz", all.status === 400, all.body?.error)
    const tooMuch = await api("POST", `/api/restoran/adisyonlar/${source.id}/bol`, {
      companyId: C,
      parts: [{ items: [{ itemId: cay.id, quantity: 4 }] }],
    })
    check("miktarı aşan bölme reddedilir", tooMuch.status === 400, tooMuch.body?.error)
    const compMove = await api("POST", `/api/restoran/adisyonlar/${source.id}/bol`, {
      companyId: C,
      parts: [{ items: [{ itemId: kek.id, quantity: 1 }] }],
    })
    check("ikram kalemi taşınamaz", compMove.status === 400, compMove.body?.error)

    console.log("\n4) Ayrı hesap: 3 çaydan 1'i + tost")
    const split = await api("POST", `/api/restoran/adisyonlar/${source.id}/bol`, {
      companyId: C,
      parts: [{ items: [{ itemId: cay.id, quantity: 1 }, { itemId: tost.id, quantity: 1 }] }],
    })
    check("bölündü", split.status === 200, `HTTP ${split.status} ${split.body?.error ?? ""}`)
    const part = split.body?.parts?.[0]
    const src = split.body?.source
    created.ticketIds.push(part?.id)
    check("yeni hesap aynı masada", part?.tableId === table.body.id)
    check("yeni hesap kaynağa bağlı (splitFromId)", part?.splitFromId === source.id)
    check("yeni hesap kaynağın açılış saatini taşıyor", part?.openedAt === source.openedAt)
    const srcCay = src?.items?.find((i) => i.id === cay.id)
    check("kaynakta 2 çay kaldı", near(srcCay?.quantity, 2, 0.0001), `${srcCay?.quantity}`)
    check("tost satırı parçaya geçti (kaynakta yok)", !src?.items?.some((i) => i.id === tost.id))
    check("ikram kaynakta kaldı", src?.items?.some((i) => i.id === kek.id && i.status === "COMP"))
    const partCay = part?.items?.find((i) => i.description === "TEST Çay")
    check("parçada 1 çay (yeni satır)", near(partCay?.quantity, 1, 0.0001) && partCay?.id !== cay.id)
    check("parçada tost", part?.items?.some((i) => i.id === tost.id))
    // tutar iskontosu: parça brüt 137,5 → 10×137,5/192,5 = 7,14 · kaynak 2,86
    check("iskonto brüt oranında dağıldı", near(part?.discountValue, 7.14) && near(src?.discountValue, 2.86), `${part?.discountValue} / ${src?.discountValue}`)
    check("iskonto sebebi parçaya kopyalandı", part?.discountReasonCode === "LOYAL")
    check("toplamlar korunur: 130,36 + 52,14 = 182,5", near(part?.totals?.total, 130.36) && near(src?.totals?.total, 52.14), `${part?.totals?.total} + ${src?.totals?.total}`)

    console.log("\n5) Kardeşler ve masa özeti")
    const srcView = await api("GET", `/api/restoran/adisyonlar/${source.id}?companyId=${C}`)
    check("kaynak kardeşini görüyor", srcView.body?.siblings?.some((s) => s.id === part.id))
    const partView = await api("GET", `/api/restoran/adisyonlar/${part.id}?companyId=${C}`)
    check("parça kaynağın kodunu biliyor", partView.body?.splitFromCode === source.code)
    const tables = await api("GET", `/api/restoran/masalar?companyId=${C}`)
    const t = tables.body?.find?.((x) => x.id === table.body.id)
    check("masada 2 hesap", t?.openTicketCount === 2 && t?.openTickets?.length === 2)
    check("masa özeti = hesapların toplamı (182,5)", near(t?.openTicket?.total, 182.5), `${t?.openTicket?.total}`)

    console.log("\n6) Kapanış sırası ve masa damgası")
    const closeTicket = async (id) => {
      const prep = await api("GET", `/api/restoran/adisyonlar/${id}/kapat?companyId=${C}`)
      const inv = await api("POST", "/api/e-donusum/invoices", prep.body.invoicePayload)
      created.invoiceIds.push(inv.body?.id)
      const closed = await api("POST", `/api/restoran/adisyonlar/${id}/kapat`, { companyId: C, invoiceId: inv.body?.id })
      return { inv, closed }
    }
    const c1 = await closeTicket(part.id)
    check("ayrı hesap kendi fişiyle kapandı", c1.closed.status === 200 && near(c1.inv.body?.totalAmount, 130.36), `fiş ${c1.inv.body?.totalAmount} · HTTP ${c1.closed.status} ${c1.closed.body?.error ?? ""}`)
    let tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.body.id }, select: { cleaningSince: true } })
    check("kardeş açıkken masa 'temizlenecek' OLMADI", tableRow?.cleaningSince == null)

    const c2 = await closeTicket(source.id)
    check("kaynak hesap kapandı", c2.closed.status === 200 && near(c2.inv.body?.totalAmount, 52.14), `fiş ${c2.inv.body?.totalAmount}`)
    tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.body.id }, select: { cleaningSince: true } })
    check("son hesap kapanınca masa 'temizlenecek'", tableRow?.cleaningSince != null)
    check(
      "iki fişin toplamı bölünmemiş hesaba eşit",
      near(Number(c1.inv.body?.totalAmount) + Number(c2.inv.body?.totalAmount), 182.5),
    )

    console.log("\n7) Bölünmüş hesabı başka masaya taşımak")
    const open2 = await api("POST", "/api/restoran/adisyonlar", { companyId: C, tableId: table.body.id })
    created.ticketIds.push(open2.body?.id)
    const add2 = await api("POST", `/api/restoran/adisyonlar/${open2.body.id}/kalemler`, {
      companyId: C,
      items: [{ description: "TEST Su", quantity: 2, unitPrice: 10, vatRate: 10 }],
    })
    const split2 = await api("POST", `/api/restoran/adisyonlar/${open2.body.id}/bol`, {
      companyId: C,
      parts: [{ items: [{ itemId: add2.body.items[0].id, quantity: 1 }] }],
    })
    const part2 = split2.body?.parts?.[0]
    created.ticketIds.push(part2?.id)
    const moved = await api("PATCH", `/api/restoran/adisyonlar/${part2.id}`, { companyId: C, tableId: table2.body.id })
    check("ayrı hesap boş masaya taşınabilir", moved.status === 200, `HTTP ${moved.status} ${moved.body?.error ?? ""}`)
    const back = await api("PATCH", `/api/restoran/adisyonlar/${part2.id}`, { companyId: C, tableId: table.body.id })
    check("dolu masaya taşıma hâlâ 409", back.status === 409)
  } finally {
    console.log("\n8) Temizlik")
    for (const invoiceId of created.invoiceIds.filter(Boolean)) {
      const del = await api("DELETE", `/api/e-donusum/invoices/${invoiceId}?companyId=${C}`)
      check("test fişi silindi", del.status < 300, `HTTP ${del.status}`)
    }
    await prisma.restaurantTicket.deleteMany({ where: { id: { in: created.ticketIds.filter(Boolean) } } })
    await prisma.restaurantTable.deleteMany({ where: { id: { in: created.tableIds.filter(Boolean) } } })
    if (created.areaId) await prisma.restaurantArea.deleteMany({ where: { id: created.areaId } })
    const leftover = await prisma.restaurantTicket.count({ where: { companyId: C, id: { in: created.ticketIds.filter(Boolean) } } })
    console.log(`  · kalan test adisyonu: ${leftover}`)
  }

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı`)
  if (failures.length) console.log("Kalanlar:\n  - " + failures.join("\n  - "))
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((e) => {
    console.error("\nHATA:", e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
