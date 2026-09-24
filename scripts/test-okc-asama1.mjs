/**
 * ÖKC Aşama 1 uçtan uca testi — yazarkasa tanımı, Z raporu, mutabakat, fiş ÖKC kimliği,
 * rol kuralı ve gün sonu özeti. Plan: docs/okc/ASAMA1-KOBIPO.md
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-okc-asama1.mjs
 *
 * GERÇEK uçlara GERÇEK HTTP ile gider (test-restoran-adisyon.mjs ile aynı oturum yolu:
 * NextAuth `encode` ile JWT çerezi). Veri Demo Firma A.Ş.'de OLUŞTURULUR ve sonunda
 * TEMİZLENİR: fişler silinir, Z kayıtları ve cihaz kaldırılır, geçici kasiyer
 * kullanıcısı (SALES üyeliği) silinir.
 *
 * Pencere yalıtımı: Z1 testin başında alınır, fişler ondan sonra kesilir, Z2 en son.
 * Z2'nin penceresi (Z1, Z2] yalnız bu testin fişlerini kapsar.
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

const localDay = (d) => {
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function sessionCookie(secret, user, companyId, role) {
  const token = await encode({
    token: {
      id: user.id,
      email: user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
      defaultCompanyId: companyId,
      defaultRole: role,
    },
    secret,
  })
  return `next-auth.session-token=${token}`
}

function client(cookie) {
  return async (method, path, body) => {
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
}

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET bulunamadı (.env.local)")

  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true, disabledModules: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı")
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, user: { select: { id: true, email: true } } },
  })
  if (!membership) throw new Error("Demo Firma'da ADMIN yok")

  console.log(`Firma : ${company.name} (${company.id})`)
  console.log(`Sunucu: ${BASE}\n`)

  const api = client(await sessionCookie(secret, membership.user, company.id, "ADMIN"))
  const ping = await api("GET", `/api/okc/devices?companyId=${company.id}`)
  if (ping.status === 401) throw new Error("Oturum çerezi kabul edilmedi")
  if (ping.status >= 500 || ping.body?.raw) throw new Error(`Sunucuya ulaşılamadı (${ping.status})`)

  const stamp = Date.now().toString().slice(-6)
  const created = { deviceIds: [], zIds: [], invoiceIds: [], userId: null }

  try {
    // ── 1. Yazarkasa tanımı ────────────────────────────────────────────────
    console.log("1) Yazarkasa tanımı")
    const dev = await api("POST", "/api/okc/devices", {
      companyId: company.id,
      name: `TEST Kasa ${stamp}`,
      brand: "Beko",
      model: "X30TR",
      serialNo: `test ${stamp} ab`,
      ekuNo: `eku ${stamp}`,
    })
    check("cihaz oluştu", dev.status === 201, `HTTP ${dev.status}`)
    const device = dev.body
    created.deviceIds.push(device?.id)
    check("seri no boşluksuz büyük harfe çevrildi", device?.serialNo === `TEST${stamp}AB`, device?.serialNo)

    const dup = await api("POST", "/api/okc/devices", {
      companyId: company.id,
      name: "Kopya",
      serialNo: `TEST${stamp}AB`,
    })
    check("aynı seri no ikinci kez tanımlanamaz", dup.status === 409, `HTTP ${dup.status}`)

    const list = await api("GET", `/api/okc/devices?companyId=${company.id}`)
    check("cihaz listede", list.body?.some?.((d) => d.id === device.id))

    // ── 2. Z1 → fişler → Z2 ─────────────────────────────────────────────────
    console.log("\n2) Pencere: Z1, iki fiş, Z2")
    const z1 = await api("POST", "/api/okc/z-raporlari", {
      companyId: company.id,
      deviceId: device.id,
      zNo: 1,
      takenAt: new Date(Date.now() - 60_000).toISOString(),
      grossTotal: "0",
    })
    check("Z1 girildi (pencere başı)", z1.status === 201, `HTTP ${z1.status}`)
    created.zIds.push(z1.body?.id)
    check("ilk Z'de pencere gün başından", z1.body?.window?.first === true)
    const z1Detail = await api("GET", `/api/okc/z-raporlari/${z1.body?.id}?companyId=${company.id}`)
    check("girilmeyen EKÜ cihazdan geldi", z1Detail.body?.ekuNo === `EKU${stamp}`, z1Detail.body?.ekuNo)

    const receipt = async (vatRate, net, method) => {
      const inv = await api("POST", "/api/e-donusum/invoices", {
        companyId: company.id,
        type: "SALES",
        invoiceType: "MANUAL",
        isReceipt: true,
        date: new Date().toISOString(),
        currency: "TRY",
        sendInvoice: false,
        notes: `TEST ÖKC ${stamp}`,
        items: [{ description: `TEST kalem %${vatRate}`, unit: "ADET", quantity: 1, unitPrice: net, vatRate }],
      })
      created.invoiceIds.push(inv.body?.id)
      if (inv.status >= 300) return { inv }
      const pay = await api("POST", "/api/faturalar/odemeler", {
        companyId: company.id,
        invoiceId: inv.body.id,
        amount: Number(inv.body.totalAmount),
        paymentMethod: method,
        paymentDate: new Date().toISOString(),
      })
      return { inv, pay }
    }

    const a = await receipt(10, 100, "CASH")
    check("fiş A (%10, nakit) kesildi", a.inv.status < 300, `HTTP ${a.inv.status} · ${a.inv.body?.totalAmount ?? a.inv.body?.error}`)
    check("fiş A tahsil edildi", a.pay && a.pay.status < 300, `HTTP ${a.pay?.status} ${a.pay?.body?.error ?? ""}`)
    const b = await receipt(20, 100, "CREDIT_CARD")
    check("fiş B (%20, kart) kesildi", b.inv.status < 300, `HTTP ${b.inv.status} · ${b.inv.body?.totalAmount ?? b.inv.body?.error}`)
    check("fiş B tahsil edildi", b.pay && b.pay.status < 300, `HTTP ${b.pay?.status} ${b.pay?.body?.error ?? ""}`)

    const z2Body = {
      companyId: company.id,
      deviceId: device.id,
      zNo: 2,
      takenAt: new Date(Date.now() + 1000).toISOString(),
      grossTotal: "230,00",
      receiptCount: 2,
      vatLines: [
        { rate: 1, base: "", vat: "" },
        { rate: 10, base: "100", vat: "10" },
        { rate: 20, base: "100", vat: "20" },
      ],
      paymentLines: [
        { method: "CASH", amount: "110" },
        { method: "CREDIT_CARD", amount: "120" },
        { method: "MEAL_CARD", amount: "" },
      ],
    }
    const z2 = await api("POST", "/api/okc/z-raporlari", z2Body)
    check("Z2 girildi", z2.status === 201, `HTTP ${z2.status} ${z2.body?.error ?? ""}`)
    created.zIds.push(z2.body?.id)
    const m = z2.body?.mutabakat
    check("Z2 penceresi Z1'den başlıyor", z2.body?.window?.first === false)
    check("pencerede tam 2 fiş", m?.receiptCount?.kobipo === 2, `${m?.receiptCount?.kobipo}`)
    check("karşılaştırılabilir (tek cihaz)", z2.body?.comparable === true)
    check("Z2 birebir TUTUYOR", m?.ok === true, JSON.stringify(m?.total))
    check(
      "KDV ekseni: %10 → 110, %20 → 120",
      m?.vat?.find((r) => r.key === "vat:10")?.kobipo === 110 && m?.vat?.find((r) => r.key === "vat:20")?.kobipo === 120,
    )
    check(
      "ödeme ekseni: nakit 110, kart 120",
      m?.payments?.find((r) => r.key === "pay:CASH")?.kobipo === 110 &&
        m?.payments?.find((r) => r.key === "pay:CREDIT_CARD")?.kobipo === 120,
    )
    check("iç tutarsızlık yok", (z2.body?.internalIssues ?? []).length === 0)

    const dupZ = await api("POST", "/api/okc/z-raporlari", { ...z2Body, takenAt: new Date().toISOString() })
    check("aynı cihaza aynı Z no ikinci kez girilemez", dupZ.status === 409, `HTTP ${dupZ.status}`)

    // ── 3. 1 kuruşluk fark ──────────────────────────────────────────────────
    console.log("\n3) Bilerek 1 kuruş farklı Z")
    const bad = await api("PATCH", `/api/okc/z-raporlari/${z2.body.id}`, {
      ...z2Body,
      grossTotal: "230,01",
      vatLines: [
        { rate: 10, base: "100", vat: "10,01" },
        { rate: 20, base: "100", vat: "20" },
      ],
      paymentLines: [
        { method: "CASH", amount: "110,01" },
        { method: "CREDIT_CARD", amount: "120" },
      ],
    })
    check("Z2 düzeltildi (yönetici)", bad.status === 200, `HTTP ${bad.status} ${bad.body?.error ?? ""}`)
    const mb = bad.body?.mutabakat
    check("genel sonuç: FARK VAR", mb?.ok === false)
    check("toplam farkı +0,01", mb?.total?.diff === 0.01, `${mb?.total?.diff}`)
    check("fark %10 satırında", mb?.vat?.find((r) => r.key === "vat:10")?.ok === false)
    check("%20 satırı temiz", mb?.vat?.find((r) => r.key === "vat:20")?.ok === true)
    check("fark nakit satırında", mb?.payments?.find((r) => r.key === "pay:CASH")?.diff === 0.01)
    check("kart satırı temiz", mb?.payments?.find((r) => r.key === "pay:CREDIT_CARD")?.ok === true)
    check("iç tutarlılık bozulmadı (Z kendi içinde tutuyor)", (bad.body?.internalIssues ?? []).length === 0)

    const typo = await api("PATCH", `/api/okc/z-raporlari/${z2.body.id}`, {
      ...z2Body,
      grossTotal: "320,00",
    })
    check(
      "yazım hatası iç tutarsızlık olarak AYRI yakalanır",
      (typo.body?.internalIssues ?? []).some((i) => i.code === "VAT_SUM") &&
        (typo.body?.internalIssues ?? []).some((i) => i.code === "PAYMENT_SUM"),
      (typo.body?.internalIssues ?? []).map((i) => i.code).join(","),
    )
    await api("PATCH", `/api/okc/z-raporlari/${z2.body.id}`, z2Body)

    // ── 4. Fişin ÖKC kimliği ────────────────────────────────────────────────
    console.log("\n4) Fiş ÖKC kimliği (elle)")
    const okc = await api("PATCH", `/api/fisler/${a.inv.body.id}/okc`, {
      companyId: company.id,
      deviceId: device.id,
      receiptNo: "1001",
      zNo: 2,
    })
    check("fiş A'ya ÖKC no yazıldı", okc.status === 200 && okc.body?.receiptNo === 1001, `HTTP ${okc.status} ${okc.body?.error ?? ""}`)
    check("kaynak USER", okc.body?.source === "USER")
    const noDevice = await api("PATCH", `/api/fisler/${a.inv.body.id}/okc`, { companyId: company.id, receiptNo: 5 })
    check("cihazsız numara reddedilir", noDevice.status === 400)

    const detail = await api("GET", `/api/okc/z-raporlari/${z2.body.id}?companyId=${company.id}`)
    const rowA = detail.body?.receipts?.find((r) => r.id === a.inv.body.id)
    check("Z detayında fiş A doğrudan Z'ye bağlı", rowA?.assigned === true && rowA?.okcReceiptNo === 1001)
    check("Z hâlâ 2 fiş sayıyor (çift sayım yok)", detail.body?.mutabakat?.receiptCount?.kobipo === 2)

    const fisList = await api("GET", `/api/fisler?companyId=${company.id}&direction=outgoing`)
    const listed = (fisList.body?.rows ?? []).find((r) => r.id === a.inv.body.id)
    check("fiş listesinde ÖKC/Z no", listed?.okcReceiptNo === 1001 && listed?.okcZNo === 2, `HTTP ${fisList.status}`)
    const fisDetail = await api("GET", `/api/fisler/${a.inv.body.id}?companyId=${company.id}`)
    check("fiş detayında yazarkasa adı", fisDetail.body?.okc?.deviceName === `TEST Kasa ${stamp}`)

    // ── 4b. Fiş iptali: yazarkasa kapısı (lib/okc/receipt-okc.ts) ──────────
    console.log("\n4b) Fiş iptali — yazarkasa kapısı")
    const cancelA = await api("POST", `/api/fisler/${a.inv.body.id}/iptal`, { companyId: company.id, okcConfirmed: true })
    check("Z no'su girilmiş Z'yi gösteren fiş iptal edilemez", cancelA.status === 409 && cancelA.body?.code === "OKC_Z_TAKEN", `HTTP ${cancelA.status} ${cancelA.body?.code ?? cancelA.body?.error ?? ""}`)
    const cancelB = await api("POST", `/api/fisler/${b.inv.body.id}/iptal`, { companyId: company.id })
    check("Z penceresindeki (ÖKC bilgisiz) fiş iptal edilemez", cancelB.status === 409 && cancelB.body?.code === "OKC_Z_TAKEN", `HTTP ${cancelB.status} ${cancelB.body?.code ?? cancelB.body?.error ?? ""}`)
    const c = await receipt(10, 50, "CASH")
    check("fiş C (Z2'den sonra) kesildi", c.inv.status < 300 && c.pay?.status < 300, `HTTP ${c.inv.status}/${c.pay?.status}`)
    await api("PATCH", `/api/fisler/${c.inv.body.id}/okc`, { companyId: company.id, deviceId: device.id, receiptNo: 1002 })
    const cancelC1 = await api("POST", `/api/fisler/${c.inv.body.id}/iptal`, { companyId: company.id })
    check("yazarkasa bilgili fiş onaysız iptal edilmez", cancelC1.status === 409 && cancelC1.body?.code === "OKC_CONFIRM", `HTTP ${cancelC1.status} ${cancelC1.body?.code ?? ""}`)
    const cancelC2 = await api("POST", `/api/fisler/${c.inv.body.id}/iptal`, { companyId: company.id, okcConfirmed: true })
    check("onayla iptal edilir", cancelC2.status === 200, `HTTP ${cancelC2.status} ${cancelC2.body?.error ?? ""}`)

    // ── 5. Kasiyer: girer ama düzeltemez ────────────────────────────────────
    console.log("\n5) Kasiyer (SALES) yetkisi")
    const tempUser = await prisma.user.create({
      data: {
        email: `okc-test-kasiyer-${stamp}@demo.kobipo.test`,
        name: "TEST Kasiyer",
        // Hash değil: bu hesapla giriş yapılamaz, yalnız test çerezi taşır.
        password: `disabled-${stamp}`,
        companies: { create: { companyId: company.id, role: "SALES" } },
      },
      select: { id: true, email: true },
    })
    created.userId = tempUser.id
    const cashier = client(await sessionCookie(secret, tempUser, company.id, "SALES"))
    const cList = await cashier("GET", `/api/okc/z-raporlari?companyId=${company.id}`)
    check("kasiyer Z listesini görür", cList.status === 200, `HTTP ${cList.status}`)
    check("kasiyere canEdit=false", cList.body?.canEdit === false)
    const cCreate = await cashier("POST", "/api/okc/z-raporlari", {
      ...z2Body,
      zNo: 3,
      takenAt: new Date(Date.now() + 2000).toISOString(),
      grossTotal: "0",
      receiptCount: 0,
      vatLines: [],
      paymentLines: [],
    })
    check("kasiyer Z GİREBİLİR", cCreate.status === 201, `HTTP ${cCreate.status} ${cCreate.body?.error ?? ""}`)
    created.zIds.push(cCreate.body?.id)
    const cPatch = await cashier("PATCH", `/api/okc/z-raporlari/${z2.body.id}`, z2Body)
    check("kasiyer Z DÜZELTEMEZ", cPatch.status === 403, `HTTP ${cPatch.status}`)
    const cDelete = await cashier("DELETE", `/api/okc/z-raporlari/${z2.body.id}?companyId=${company.id}`)
    check("kasiyer Z SİLEMEZ", cDelete.status === 403, `HTTP ${cDelete.status}`)
    const cDevice = await cashier("POST", "/api/okc/devices", {
      companyId: company.id,
      name: "Kasiyer cihazı",
      serialNo: `K${stamp}`,
    })
    check("kasiyer yazarkasa tanımlayamaz (sayfa kapısı)", cDevice.status === 403, `HTTP ${cDevice.status}`)
    if (cDevice.status === 201) created.deviceIds.push(cDevice.body?.id)

    // ── 6. Cihaz silme / pasif ──────────────────────────────────────────────
    console.log("\n6) Z kaydı olan cihaz")
    const del = await api("DELETE", `/api/okc/devices/${device.id}?companyId=${company.id}`)
    check("Z'si olan cihaz silinemez", del.status === 409 && del.body?.code === "HAS_HISTORY", `HTTP ${del.status}`)
    const off = await api("PATCH", `/api/okc/devices/${device.id}`, { companyId: company.id, isActive: false })
    check("cihaz pasife alındı", off.status === 200 && off.body?.isActive === false)
    const onInactive = await api("POST", "/api/okc/z-raporlari", {
      ...z2Body,
      zNo: 99,
      takenAt: new Date().toISOString(),
    })
    check("pasif cihaza Z girilemez", onInactive.status === 400, `HTTP ${onInactive.status}`)
    await api("PATCH", `/api/okc/devices/${device.id}`, { companyId: company.id, isActive: true })

    // ── 7. Gün sonu özeti ───────────────────────────────────────────────────
    console.log("\n7) Gün sonu Z özeti")
    if (company.disabledModules.includes("restaurant")) {
      console.log("  · restoran modülü kapalı, atlandı")
    } else {
      const today = localDay(new Date())
      const gs = await api(
        "GET",
        `/api/restoran/raporlar/gun-sonu?companyId=${company.id}&startDate=${today}&endDate=${today}`,
      )
      check("gün sonu cevabında okc özeti", gs.status === 200 && gs.body?.okc?.deviceCount >= 1, `HTTP ${gs.status}`)
      const zRow = gs.body?.okc?.reports?.find((r) => r.id === z2.body.id)
      check("Z2 bugünün gün sonunda, TUTUYOR", zRow?.ok === true, JSON.stringify(zRow ?? null))
    }

    // ── 8. Liste ────────────────────────────────────────────────────────────
    console.log("\n8) Z listesi")
    const zl = await api("GET", `/api/okc/z-raporlari?companyId=${company.id}&deviceId=${device.id}`)
    check("listede 3 Z", zl.body?.reports?.length === 3, `${zl.body?.reports?.length}`)
    check("yöneticiye canEdit=true", zl.body?.canEdit === true)
  } finally {
    console.log("\n9) Temizlik")
    for (const id of created.zIds.filter(Boolean)) {
      await api("DELETE", `/api/okc/z-raporlari/${id}?companyId=${company.id}`)
    }
    for (const invoiceId of created.invoiceIds.filter(Boolean)) {
      const del = await api("DELETE", `/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`)
      check("test fişi silindi", del.status < 300, `HTTP ${del.status}`)
    }
    for (const id of created.deviceIds.filter(Boolean)) {
      const del = await api("DELETE", `/api/okc/devices/${id}?companyId=${company.id}`)
      check("test cihazı silindi", del.status === 200, `HTTP ${del.status} ${del.body?.error ?? ""}`)
    }
    if (created.userId) await prisma.user.delete({ where: { id: created.userId } })
    const leftover = await prisma.okcDevice.count({ where: { companyId: company.id, name: { startsWith: "TEST Kasa" } } })
    console.log(`  · kalan test cihazı: ${leftover}`)
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
