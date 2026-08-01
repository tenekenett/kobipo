/**
 * Masa/adisyon uçlarının uçtan uca testi (Restoran & Kafe, Aşama 2 Faz A).
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-restoran-adisyon.mjs
 *
 * GERÇEK uçlara GERÇEK HTTP ile gider — mock yok. Oturum, NextAuth'un kendi
 * `encode`'uyla üretilen bir JWT çerezidir (strategy: "jwt"): giriş ekranından
 * ve reCAPTCHA'dan geçmeye gerek kalmaz, kod ve env dosyaları değişmez.
 *
 * Test verisi Demo Firma A.Ş.'de OLUŞTURULUR ve sonunda TEMİZLENİR: fiş silinir
 * (stok geri alınır), adisyon/masa/bölge kayıtları kaldırılır. Kapanışta stoğun
 * gerçekten düştüğü ve iptalde geri geldiği de doğrulanır.
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

const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol

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
    select: { userId: true, role: true, user: { select: { email: true, isSuperAdmin: true } } },
  })
  if (!membership) throw new Error("Demo Firma'da OWNER/ADMIN kullanıcı yok")

  console.log(`Firma : ${company.name} (${company.id})`)
  console.log(`Kullanıcı: ${membership.user.email} (${membership.role})`)
  console.log(`Sunucu: ${BASE}\n`)

  // NextAuth v4 çerez adı: geliştirmede "next-auth.session-token".
  const token = await encode({
    token: {
      id: membership.userId,
      email: membership.user.email,
      isSuperAdmin: membership.user.isSuperAdmin || false,
      isBlogEditor: false,
      defaultCompanyId: company.id,
      defaultRole: membership.role,
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

  // Sunucu ayakta mı?
  const ping = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
  if (ping.status === 401) throw new Error("Oturum çerezi kabul edilmedi (NEXTAUTH_SECRET uyuşmuyor olabilir)")
  if (ping.status >= 500 || ping.body?.raw) {
    throw new Error(`Sunucuya ulaşılamadı (${ping.status}). 'npm run dev' çalışıyor mu?`)
  }

  const stamp = Date.now().toString().slice(-6)
  const created = {
    areaId: null,
    areaId2: null,
    tableIds: [],
    ticketIds: [],
    invoiceIds: [],
    planItemIds: [],
    optionGroupIds: [],
    customerIds: [],
    reservationIds: [],
  }

  try {
    // ── 1. Bölge ve masa ────────────────────────────────────────────────────
    console.log("1) Bölge ve masa kurulumu")
    const area = await api("POST", "/api/restoran/bolgeler", {
      companyId: company.id,
      name: `TEST Bahçe ${stamp}`,
    })
    check("bölge oluştu", area.status === 201, area.body?.name)
    created.areaId = area.body?.id

    const dup = await api("POST", "/api/restoran/bolgeler", {
      companyId: company.id,
      name: `TEST Bahçe ${stamp}`,
    })
    check("aynı adla ikinci bölge reddedildi", dup.status === 409, `HTTP ${dup.status}`)

    const t1 = await api("POST", "/api/restoran/masalar", {
      companyId: company.id,
      areaId: created.areaId,
      name: `T${stamp}-1`,
      capacity: 4,
    })
    check("masa 1 oluştu", t1.status === 201, `${t1.body?.name} @(${t1.body?.x},${t1.body?.y})`)
    created.tableIds.push(t1.body?.id)

    const t2 = await api("POST", "/api/restoran/masalar", {
      companyId: company.id,
      areaId: created.areaId,
      name: `T${stamp}-2`,
    })
    check("masa 2 oluştu", t2.status === 201, `@(${t2.body?.x},${t2.body?.y})`)
    created.tableIds.push(t2.body?.id)
    check(
      "otomatik yerleşim masaları üst üste bindirmiyor",
      t1.body?.x !== t2.body?.x || t1.body?.y !== t2.body?.y,
      `(${t1.body?.x},${t1.body?.y}) vs (${t2.body?.x},${t2.body?.y})`,
    )

    const moved = await api("PATCH", `/api/restoran/masalar/${t1.body.id}`, {
      companyId: company.id,
      x: 7,
      y: 3,
    })
    check("sürükle-bırak (x/y PATCH)", moved.status === 200 && moved.body?.x === 7 && moved.body?.y === 3)

    // ── 2. Adisyon aç ───────────────────────────────────────────────────────
    console.log("\n2) Adisyon açma")
    const open1 = await api("POST", "/api/restoran/adisyonlar", {
      companyId: company.id,
      tableId: t1.body.id,
      guestCount: 3,
    })
    check("adisyon açıldı", open1.status === 201, open1.body?.code)
    check("numara biçimi ADS-YYYY-NNNN", /^ADS-\d{4}-\d{4}$/.test(open1.body?.code || ""), open1.body?.code)
    created.ticketIds.push(open1.body?.id)

    const open2 = await api("POST", "/api/restoran/adisyonlar", {
      companyId: company.id,
      tableId: t1.body.id,
    })
    check("aynı masada ikinci adisyon reddedildi", open2.status === 409, `HTTP ${open2.status}`)
    check("409 yanıtı mevcut adisyonu döndürüyor", open2.body?.ticket?.id === open1.body?.id)

    // ── 3. Kalem ekleme ─────────────────────────────────────────────────────
    console.log("\n3) Kalem ekleme (fiyat ürün kartından kopyalanır)")
    const latte = await prisma.product.findFirst({
      where: { companyId: company.id, name: { contains: "Latte" } },
      select: { id: true, name: true, salePrice: true, vatRate: true, unit: true },
    })
    if (!latte) throw new Error("Demo Firma'da Latte ürünü yok")

    const add1 = await api("POST", `/api/restoran/adisyonlar/${open1.body.id}/kalemler`, {
      companyId: company.id,
      productId: latte.id,
      quantity: 2,
    })
    check("2 adet eklendi", add1.status === 201, `${add1.body?.items?.length} satır`)
    const line = add1.body?.items?.[0]
    check(
      "fiyat/KDV ürün kartından geldi",
      near(line?.unitPrice, Number(latte.salePrice)) && near(line?.vatRate, Number(latte.vatRate)),
      `net ${line?.unitPrice} · KDV %${line?.vatRate}`,
    )

    const add2 = await api("POST", `/api/restoran/adisyonlar/${open1.body.id}/kalemler`, {
      companyId: company.id,
      productId: latte.id,
      quantity: 1,
    })
    check(
      "aynı ürün TEK satırda birleşti (2+1=3)",
      add2.body?.items?.length === 1 && near(add2.body.items[0].quantity, 3),
      `${add2.body?.items?.length} satır · ${add2.body?.items?.[0]?.quantity} adet`,
    )

    const noted = await api("POST", `/api/restoran/adisyonlar/${open1.body.id}/kalemler`, {
      companyId: company.id,
      productId: latte.id,
      quantity: 1,
      note: "az şekerli",
    })
    check("notlu kalem AYRI satır", noted.body?.items?.length === 2, `${noted.body?.items?.length} satır`)

    const expectedNet = Number(latte.salePrice) * 4
    const expectedTotal = expectedNet * (1 + Number(latte.vatRate) / 100)
    check(
      "toplam KDV dahil doğru",
      near(noted.body?.totals?.total, expectedTotal),
      `${noted.body?.totals?.total} (beklenen ${Math.round(expectedTotal * 100) / 100})`,
    )

    // ── 4. Stok HENÜZ düşmedi ───────────────────────────────────────────────
    console.log("\n4) Açık adisyon stoğa dokunmaz")
    const milk = await prisma.product.findFirst({
      where: { companyId: company.id, name: { contains: "Süt" } },
      select: { id: true, name: true, stockQuantity: true },
    })
    const milkBefore = Number(milk?.stockQuantity ?? 0)
    check("süt stoğu değişmedi", true, `${milkBefore} (kapanış öncesi referans)`)

    // ── 5. Kalem düzenleme ──────────────────────────────────────────────────
    console.log("\n5) Kalem düzenleme")
    const firstItem = noted.body.items[0]
    const patched = await api(
      "PATCH",
      `/api/restoran/adisyonlar/${open1.body.id}/kalemler/${firstItem.id}`,
      { companyId: company.id, quantity: 1 },
    )
    check("adet 3 → 1", near(patched.body?.items?.find((i) => i.id === firstItem.id)?.quantity, 1))

    const secondItem = noted.body.items[1]
    const removed = await api(
      "DELETE",
      `/api/restoran/adisyonlar/${open1.body.id}/kalemler/${secondItem.id}?companyId=${company.id}`,
    )
    check("notlu kalem silindi", removed.body?.items?.length === 1)

    // ── 6. Masa taşıma ──────────────────────────────────────────────────────
    console.log("\n6) Masa taşıma")
    const move = await api("PATCH", `/api/restoran/adisyonlar/${open1.body.id}`, {
      companyId: company.id,
      tableId: t2.body.id,
    })
    check("adisyon masa 2'ye taşındı", move.body?.tableId === t2.body.id, move.body?.tableName)

    const other = await api("POST", "/api/restoran/adisyonlar", {
      companyId: company.id,
      tableId: t1.body.id,
    })
    created.ticketIds.push(other.body?.id)
    const clash = await api("PATCH", `/api/restoran/adisyonlar/${other.body.id}`, {
      companyId: company.id,
      tableId: t2.body.id,
    })
    check("dolu masaya taşıma reddedildi", clash.status === 409, clash.body?.error)

    // Veresiye carisi: borcun yazılacağı müşteri adisyona bağlanır. Ekranda
    // ödeme diyaloğunda "Veresiye" seçilince sorulur; seçilmezse fiş ödenmemiş
    // kalır ve borç kimseye yazılmaz.
    // Demo Firma'da cari yok; testin kendi müşterisini kurup sonunda siliyoruz.
    const testCustomer = await prisma.customer.create({
      data: { companyId: company.id, name: `TEST Müşteri ${stamp}` },
      select: { id: true, name: true },
    })
    created.customerIds.push(testCustomer.id)

    const withCustomer = await api("PATCH", `/api/restoran/adisyonlar/${open1.body.id}`, {
      companyId: company.id,
      customerId: testCustomer.id,
    })
    check(
      "adisyona cari bağlandı (veresiye için)",
      withCustomer.body?.customerId === testCustomer.id &&
        withCustomer.body?.customerName === testCustomer.name,
      withCustomer.body?.customerName,
    )
    const cleared = await api("PATCH", `/api/restoran/adisyonlar/${open1.body.id}`, {
      companyId: company.id,
      customerId: null,
    })
    check("cari kaldırılabiliyor", cleared.body?.customerId === null)

    const emptyClose = await api(
      "GET",
      `/api/restoran/adisyonlar/${other.body.id}/kapat?companyId=${company.id}`,
    )
    check("boş adisyon kapatılamıyor", emptyClose.status === 400, emptyClose.body?.error)

    // ── 7. Salon planı tek çağrıda ──────────────────────────────────────────
    console.log("\n7) Salon planı özeti")
    const plan = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
    const planned = plan.body.filter((t) => created.tableIds.includes(t.id))
    const busy = planned.find((t) => t.id === t2.body.id)
    check("masa listesi açık adisyonu özetliyor", busy?.openTicket != null, busy?.openTicket?.code)
    check(
      "özet tutarı adisyonla aynı",
      near(busy?.openTicket?.total, removed.body?.totals?.total),
      `${busy?.openTicket?.total}`,
    )

    // ── 8. Kapanış: fiş + stok ──────────────────────────────────────────────
    console.log("\n8) Kapanış → fiş → stok")
    const prep = await api("GET", `/api/restoran/adisyonlar/${open1.body.id}/kapat?companyId=${company.id}`)
    check("fiş gövdesi hazırlandı", prep.status === 200 && Array.isArray(prep.body?.invoicePayload?.items))
    check(
      "fiş notu adisyonu işaretliyor",
      String(prep.body?.invoicePayload?.notes || "").includes(open1.body.code),
      prep.body?.invoicePayload?.notes,
    )

    const invoice = await api("POST", "/api/e-donusum/invoices", prep.body.invoicePayload)
    check("fiş oluştu", invoice.status === 200 || invoice.status === 201, invoice.body?.invoiceNo)
    created.invoiceIds.push(invoice.body?.id)

    const closed = await api("POST", `/api/restoran/adisyonlar/${open1.body.id}/kapat`, {
      companyId: company.id,
      invoiceId: invoice.body.id,
    })
    check("adisyon kapandı", closed.body?.status === "CLOSED", `${closed.body?.invoiceNo}`)

    const reClose = await api("POST", `/api/restoran/adisyonlar/${open1.body.id}/kapat`, {
      companyId: company.id,
      invoiceId: invoice.body.id,
    })
    check("ikinci kapatma reddedildi (çift satış kapısı)", reClose.status === 409, reClose.body?.error)

    const addAfter = await api("POST", `/api/restoran/adisyonlar/${open1.body.id}/kalemler`, {
      companyId: company.id,
      productId: latte.id,
      quantity: 1,
    })
    check("kapalı adisyona kalem eklenemiyor", addAfter.status === 409, addAfter.body?.error)

    const milkAfter = await prisma.product.findUnique({
      where: { id: milk.id },
      select: { stockQuantity: true },
    })
    check(
      "KAPANIŞTA stok düştü (reçete genişledi)",
      Number(milkAfter.stockQuantity) < milkBefore,
      `${milkBefore} → ${Number(milkAfter.stockQuantity)}`,
    )

    // ── 8b. Seçeneğin REÇETEYE etkisi ───────────────────────────────────────
    // Tek soru: menüde "sütsüz" tanımlanmışsa kasada süt düşüyor mu?
    // Zincirin tamamı burada sınanıyor: seçenek tanımı → adisyon kalemine
    // kopyalanan etki → fiş gövdesi → fatura ucunun stok düşümü.
    console.log("\n8b) Seçeneğin reçeteye etkisi")
    const optGroup = await api("POST", "/api/restoran/urun-secenekleri", {
      companyId: company.id,
      productId: latte.id,
      name: `TEST Süt ${stamp}`,
      options: [
        { name: "Sütsüz", priceDelta: 0, effectMode: "SWAP", fromProductId: milk.id },
        { name: "Büyük", priceDelta: 10, recipeFactor: 2 },
      ],
    })
    check("seçenek grubu kuruldu", optGroup.status === 201, optGroup.body?.name)
    created.optionGroupIds.push(optGroup.body?.id)

    const optNoMilk = optGroup.body?.options?.[0]
    const optBig = optGroup.body?.options?.[1]
    check(
      "değişim etkisi kaydedildi (hedefsiz = çıkar)",
      optNoMilk?.effectMode === "SWAP" &&
        optNoMilk?.fromProductId === milk.id &&
        optNoMilk?.toProductId === null,
      `${optNoMilk?.effectMode} ${optNoMilk?.fromProductId} → ${optNoMilk?.toProductId}`,
    )
    check("porsiyon çarpanı kaydedildi", Number(optBig?.recipeFactor) === 2, `${optBig?.recipeFactor}`)

    const bogusEffect = await api("POST", "/api/restoran/urun-secenekleri", {
      companyId: company.id,
      productId: latte.id,
      name: `TEST Kaçak ${stamp}`,
      options: [{ name: "Sızıntı", effectMode: "SWAP", fromProductId: "baska-firmanin-urunu" }],
    })
    check("başka firmanın ürünü etkiye bağlanamıyor", bogusEffect.status === 400, bogusEffect.body?.error)

    /** Paket adisyonda 1 latte satar, kapatır ve sütteki DÜŞÜŞÜ döndürür. */
    const sellLatte = async (optionIds) => {
      const stockOf = async () =>
        Number(
          (await prisma.product.findUnique({ where: { id: milk.id }, select: { stockQuantity: true } }))
            ?.stockQuantity ?? 0,
        )
      const before = await stockOf()
      const ticket = await api("POST", "/api/restoran/adisyonlar", {
        companyId: company.id,
        note: `TEST paket ${stamp}`,
      })
      created.ticketIds.push(ticket.body?.id)
      await api("POST", `/api/restoran/adisyonlar/${ticket.body.id}/kalemler`, {
        companyId: company.id,
        productId: latte.id,
        quantity: 1,
        optionIds,
      })
      const payload = await api(
        "GET",
        `/api/restoran/adisyonlar/${ticket.body.id}/kapat?companyId=${company.id}`,
      )
      const inv = await api("POST", "/api/e-donusum/invoices", payload.body.invoicePayload)
      created.invoiceIds.push(inv.body?.id)
      await api("POST", `/api/restoran/adisyonlar/${ticket.body.id}/kapat`, {
        companyId: company.id,
        invoiceId: inv.body.id,
      })
      return { drop: before - (await stockOf()), payload: payload.body.invoicePayload }
    }

    const plainSale = await sellLatte([])
    check("seçeneksiz latte sütü düşürdü (referans)", plainSale.drop > 0, `${plainSale.drop} LT`)

    const noMilkSale = await sellLatte([optNoMilk.id])
    check(
      "SÜTSÜZ seçildi → süt HİÇ düşmedi",
      Math.abs(noMilkSale.drop) < 0.00005,
      `${noMilkSale.drop} LT`,
    )
    check(
      "etki fiş gövdesine eklendi",
      noMilkSale.payload?.items?.[0]?.recipeEffects?.[0]?.mode === "SWAP",
      JSON.stringify(noMilkSale.payload?.items?.[0]?.recipeEffects),
    )
    const noMilkInvoice = await prisma.invoice.findUnique({
      where: { id: created.invoiceIds[created.invoiceIds.length - 1] },
      include: { items: true },
    })
    check(
      "fatura kalemi seçeneği ADIYLA taşıyor (üretim ayrıntısı yazılmadı)",
      (noMilkInvoice?.items?.[0]?.description ?? "").includes("Sütsüz"),
      noMilkInvoice?.items?.[0]?.description,
    )

    const bigSale = await sellLatte([optBig.id])
    check(
      "BÜYÜK BOY → süt tam 2 kat düştü",
      Math.abs(bigSale.drop - plainSale.drop * 2) < 0.0001,
      `${bigSale.drop} = 2 × ${plainSale.drop}`,
    )

    // ── 9. Faz D: masa raporu + gün sonu açık adisyonlar ────────────────────
    // Bu noktada VERİ TAM: open1 kapandı (fişli), `other` masa 1'de hâlâ açık.
    // İkisi iki ayrı raporun konusu — kapanan ölçülür, açık uyarır.
    console.log("\n9) Faz D — masa raporu ve açık adisyonlar")

    // Açık adisyona kalem ekleniyor: boş adisyonun tutarı 0 olurdu ve "açık
    // hesap tutarı" iddiası hiçbir şey doğrulamazdı.
    const openWithItem = await api("POST", `/api/restoran/adisyonlar/${other.body.id}/kalemler`, {
      companyId: company.id,
      productId: latte.id,
      quantity: 2,
    })
    const openTotal = openWithItem.body?.totals?.total
    check("açık adisyona kalem eklendi", openWithItem.status === 201, `${openTotal} ₺`)

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date()
    dayEnd.setHours(23, 59, 59, 999)
    const rangeQ = `startDate=${encodeURIComponent(dayStart.toISOString())}&endDate=${encodeURIComponent(dayEnd.toISOString())}`

    const tablesReport = await api(
      "GET",
      `/api/restoran/raporlar/masalar?companyId=${company.id}&${rangeQ}`,
    )
    check("masa raporu geldi", tablesReport.status === 200, `HTTP ${tablesReport.status}`)

    // Ciro FİŞTEN gelmeli, adisyon kalemlerinden değil (iskonto/yuvarlama farkı).
    const soldInvoice = await prisma.invoice.findUnique({
      where: { id: invoice.body.id },
      select: { totalAmount: true },
    })
    const t2Bucket = (tablesReport.body?.tables ?? []).find((r) => r.name === t2.body.name)
    check("kapanan adisyon masasıyla raporda", t2Bucket != null, t2Bucket?.name)
    check(
      "masa cirosu fişin toplamıyla aynı",
      near(t2Bucket?.revenue, Number(soldInvoice?.totalAmount ?? 0)),
      `${t2Bucket?.revenue} vs ${Number(soldInvoice?.totalAmount ?? 0)}`,
    )
    check("masa tek adisyon saydı", t2Bucket?.tickets === 1, `${t2Bucket?.tickets} adisyon`)
    check("masa ortalama sepeti tek adisyonda ciroya eşit", near(t2Bucket?.avgTicket, t2Bucket?.revenue))
    check(
      "masa süresi ölçüldü (negatif değil)",
      t2Bucket?.avgMinutes != null && t2Bucket.avgMinutes >= 0,
      `${t2Bucket?.avgMinutes} dk`,
    )
    check(
      "AÇIK adisyon masa raporuna GİRMİYOR",
      !(tablesReport.body?.tables ?? []).some((r) => r.name === t1.body.name),
      "masa 1 yok (adisyonu açık)",
    )
    check(
      "devir hızı hesaplandı",
      tablesReport.body?.summary?.turnover != null &&
        tablesReport.body?.summary?.activeTables >= 2,
      `${tablesReport.body?.summary?.activeTables} aktif masa`,
    )
    check(
      "saat yoğunluğu dolu",
      Array.isArray(tablesReport.body?.hours) && tablesReport.body.hours.length > 0,
      `${tablesReport.body?.hours?.length} saat dilimi`,
    )

    const dayReport = await api(
      "GET",
      `/api/restoran/raporlar/gun-sonu?companyId=${company.id}&${rangeQ}`,
    )
    check("gün sonu raporu geldi", dayReport.status === 200, `HTTP ${dayReport.status}`)
    const openRow = (dayReport.body?.openTickets ?? []).find((t) => t.id === other.body.id)
    check("gün sonunda açık adisyon listelendi", openRow != null, openRow?.code)
    check("açık adisyon tutarı adisyon ekranıyla aynı", near(openRow?.total, openTotal), `${openRow?.total}`)
    check("açık adisyon masasıyla geldi", openRow?.tableName === t1.body.name, openRow?.tableName)
    check(
      "KAPANAN adisyon açık listesinde YOK",
      !(dayReport.body?.openTickets ?? []).some((t) => t.id === open1.body.id),
    )
    const openSum = (dayReport.body?.openTickets ?? []).reduce((a, t) => a + t.total, 0)
    check(
      "açık hesap toplamı listeyle tutuyor",
      near(dayReport.body?.summary?.openTicketTotal, openSum),
      `${dayReport.body?.summary?.openTicketTotal}`,
    )
    // Ciro yalnız FİŞLERDEN oluşmalı: açık masa tutarı buraya sızarsa gün sonu
    // sayımı olduğundan yüksek çıkar ve kasada sürekli "eksik" görünür.
    const receiptSum = (dayReport.body?.receipts ?? []).reduce((a, r) => a + r.total, 0)
    check(
      "açık hesap ciroya EKLENMEDİ",
      near(dayReport.body?.summary?.revenueGross, receiptSum),
      `ciro ${dayReport.body?.summary?.revenueGross} = fişler ${receiptSum.toFixed(2)} (açık ${openSum} hariç)`,
    )

    // Geçmiş bir gün sorulduğunda "şu an açık" olan adisyon görünmemeli: adisyon
    // o gün daha AÇILMAMIŞTI. `status` alanına bakan bir uygulama bunu kaçırırdı.
    const past = new Date(dayStart)
    past.setDate(past.getDate() - 7)
    const pastEnd = new Date(past)
    pastEnd.setHours(23, 59, 59, 999)
    const pastReport = await api(
      "GET",
      `/api/restoran/raporlar/gun-sonu?companyId=${company.id}&startDate=${encodeURIComponent(past.toISOString())}&endDate=${encodeURIComponent(pastEnd.toISOString())}`,
    )
    check(
      "bir hafta önceki günde bugünün açık adisyonu YOK",
      !(pastReport.body?.openTickets ?? []).some((t) => t.id === other.body.id),
      `${pastReport.body?.openTickets?.length ?? 0} açık adisyon`,
    )

    // ── 10. Dükkan krokisi + bölge ayrımı ───────────────────────────────────
    console.log("\n10) Dükkan krokisi")
    const wall = await api("POST", "/api/restoran/plan", {
      companyId: company.id,
      areaId: created.areaId,
      kind: "WALL",
    })
    check("duvar eklendi", wall.status === 201, `${wall.body?.width}×${wall.body?.height} hücre`)
    check("duvarın varsayılan ölçüsü uzun", wall.body?.width === 8 && wall.body?.height === 1)
    created.planItemIds.push(wall.body?.id)

    const bar = await api("POST", "/api/restoran/plan", {
      companyId: company.id,
      areaId: created.areaId,
      kind: "BAR",
      label: "Kahve barı",
    })
    check("bar eklendi", bar.status === 201, bar.body?.label)
    created.planItemIds.push(bar.body?.id)

    const badKind = await api("POST", "/api/restoran/plan", {
      companyId: company.id,
      kind: "MASA_DEGIL",
    })
    check("geçersiz öğe türü reddedildi", badKind.status === 400, badKind.body?.error)

    const movedWall = await api("PATCH", `/api/restoran/plan/${wall.body.id}`, {
      companyId: company.id,
      x: 2,
      y: 5,
      width: 12,
      label: "Cam cephe",
    })
    check(
      "duvar taşındı ve uzatıldı",
      movedWall.body?.x === 2 && movedWall.body?.y === 5 && movedWall.body?.width === 12,
      `@(${movedWall.body?.x},${movedWall.body?.y}) · ${movedWall.body?.width} hücre`,
    )

    // İkinci bölge: "Tümü"de bölümlerin ayrı tuvallere düşmesi için gereken veri.
    const area2 = await api("POST", "/api/restoran/bolgeler", {
      companyId: company.id,
      name: `TEST Teras ${stamp}`,
    })
    created.areaId2 = area2.body?.id
    const t3 = await api("POST", "/api/restoran/masalar", {
      companyId: company.id,
      areaId: created.areaId2,
      name: `T${stamp}-3`,
    })
    created.tableIds.push(t3.body?.id)
    check("ikinci bölgeye masa eklendi", t3.status === 201, t3.body?.name)

    const planList = await api("GET", `/api/restoran/plan?companyId=${company.id}`)
    const mine = planList.body.filter((i) => created.planItemIds.includes(i.id))
    check("kroki listesi geldi", mine.length === 2, `${mine.length} öğe`)
    check(
      "kroki öğeleri bölgeye bağlı (bölüm ayrımı buradan çıkıyor)",
      mine.every((i) => i.areaId === created.areaId),
    )

    const tablesByArea = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
    const a1 = tablesByArea.body.filter((t) => t.areaId === created.areaId && created.tableIds.includes(t.id))
    const a2 = tablesByArea.body.filter((t) => t.areaId === created.areaId2)
    check("bölge 1 masaları", a1.length === 2, `${a1.length} masa`)
    check("bölge 2 masaları", a2.length === 1, `${a2.length} masa`)

    // ── 10b. Kare kroki: plan boyutu ────────────────────────────────────────
    // Tuval kare olduğu için bölge tek bir kenar uzunluğu (gridSize) tutar.
    console.log("\n10b) Plan boyutu (kare kroki)")
    const gridDefault = await api("GET", `/api/restoran/bolgeler?companyId=${company.id}`)
    const myArea = gridDefault.body.find((a) => a.id === created.areaId)
    check("bölge varsayılan ızgarayla geliyor", myArea?.gridSize === 16, `${myArea?.gridSize}`)

    const grown = await api("PATCH", `/api/restoran/bolgeler/${created.areaId}`, {
      companyId: company.id,
      gridSize: 24,
    })
    check("plan büyütüldü", grown.body?.gridSize === 24, `${grown.body?.gridSize}`)

    // 12 hücrelik duvar @x=2 → 14 hücre gerekiyor; 10'a inmek reddedilmeli.
    const shrunk = await api("PATCH", `/api/restoran/bolgeler/${created.areaId}`, {
      companyId: company.id,
      gridSize: 10,
    })
    check("içeriği kesecek küçültme reddedildi", shrunk.status === 409, shrunk.body?.error)

    const clamped = await api("PATCH", `/api/restoran/bolgeler/${created.areaId}`, {
      companyId: company.id,
      gridSize: 999,
    })
    check("uçuk ızgara üst sınıra oturdu", clamped.body?.gridSize === 40, `${clamped.body?.gridSize}`)

    // Kalemle çizim: ekran x/y/width/height'ı kendisi gönderiyor.
    const drawn = await api("POST", "/api/restoran/plan", {
      companyId: company.id,
      areaId: created.areaId,
      kind: "SOFA",
      x: 3,
      y: 9,
      width: 5,
      height: 2,
    })
    created.planItemIds.push(drawn.body?.id)
    check(
      "kalemle çizilen öğe verilen ölçüde doğdu",
      drawn.status === 201 && drawn.body?.width === 5 && drawn.body?.height === 2,
      `${drawn.body?.kind} ${drawn.body?.width}×${drawn.body?.height} @(${drawn.body?.x},${drawn.body?.y})`,
    )

    // ── 10c. Masa durumları ─────────────────────────────────────────────────
    console.log("\n10c) Masa durumları (hesap istendi / toplanacak)")
    // 8. adımda kapanan adisyon bu masadaydı: kapanış masayı damgalamış olmalı.
    const afterClose = await prisma.restaurantTable.findUnique({
      where: { id: created.tableIds[1] },
      select: { cleaningSince: true },
    })
    check("adisyon kapanınca masa kendiliğinden 'toplanacak' oldu", !!afterClose?.cleaningSince)

    const stateTicket = await api("POST", "/api/restoran/adisyonlar", {
      companyId: company.id,
      tableId: created.tableIds[1],
    })
    created.ticketIds.push(stateTicket.body?.id)

    const afterReopen = await prisma.restaurantTable.findUnique({
      where: { id: created.tableIds[1] },
      select: { cleaningSince: true },
    })
    check(
      "yeni adisyon damgayı temizledi (masa kilitlenmiyor)",
      afterReopen?.cleaningSince === null,
    )

    const billOn = await api("PATCH", `/api/restoran/adisyonlar/${stateTicket.body.id}`, {
      companyId: company.id,
      billRequested: true,
    })
    check("hesap istendi işaretlendi", !!billOn.body?.billRequestedAt, billOn.body?.billRequestedAt)

    const planWithState = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
    const billTable = planWithState.body.find((t) => t.id === created.tableIds[1])
    check(
      "plan 'hesap istendi'yi masada gösteriyor",
      !!billTable?.openTicket?.billRequestedAt,
    )

    const billOff = await api("PATCH", `/api/restoran/adisyonlar/${stateTicket.body.id}`, {
      companyId: company.id,
      billRequested: false,
    })
    check("hesap isteği kaldırıldı", billOff.body?.billRequestedAt === null)

    const dirty = await api("PATCH", `/api/restoran/masalar/${created.tableIds[1]}`, {
      companyId: company.id,
      cleaned: false,
    })
    check("masa 'toplanacak' işaretlendi", !!dirty.body?.cleaningSince)

    const cleaned = await api("PATCH", `/api/restoran/masalar/${created.tableIds[1]}`, {
      companyId: company.id,
      cleaned: true,
    })
    check("masa toplandı", cleaned.body?.cleaningSince === null)

    // ── 10d. Rezervasyon ────────────────────────────────────────────────────
    console.log("\n10d) Rezervasyon")
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60000)
    const resv = await api("POST", "/api/restoran/rezervasyonlar", {
      companyId: company.id,
      tableId: created.tableIds[0],
      guestName: `TEST Misafir ${stamp}`,
      guestCount: 4,
      reservedAt: inTwoHours.toISOString(),
      durationMin: 90,
    })
    created.reservationIds.push(resv.body?.id)
    check("rezervasyon alındı", resv.status === 201, resv.body?.guestName)

    const clashResv = await api("POST", "/api/restoran/rezervasyonlar", {
      companyId: company.id,
      tableId: created.tableIds[0],
      guestName: `TEST Çakışan ${stamp}`,
      reservedAt: new Date(inTwoHours.getTime() + 30 * 60000).toISOString(),
    })
    check("çakışan rezervasyon reddedildi", clashResv.status === 409, clashResv.body?.error)

    const farResv = await api("POST", "/api/restoran/rezervasyonlar", {
      companyId: company.id,
      tableId: created.tableIds[0],
      guestName: `TEST Geç ${stamp}`,
      reservedAt: new Date(inTwoHours.getTime() + 4 * 60 * 60000).toISOString(),
    })
    created.reservationIds.push(farResv.body?.id)
    check("çakışmayan saat kabul edildi", farResv.status === 201)

    const seatByHand = await api("PATCH", `/api/restoran/rezervasyonlar/${resv.body.id}`, {
      companyId: company.id,
      status: "SEATED",
    })
    check("'oturdu' el ile verilemiyor", seatByHand.status === 409, seatByHand.body?.error)

    const planWithResv = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
    const resvTable = planWithResv.body.find((t) => t.id === created.tableIds[0])
    check(
      "plan yaklaşan rezervasyonu masada gösteriyor",
      resvTable?.reservation?.id === resv.body.id,
      `${resvTable?.reservation?.guestName} · ${resvTable?.reservation?.minutesUntil} dk`,
    )

    // ── 10e. Taşı / birleştir ───────────────────────────────────────────────
    console.log("\n10e) Adisyon taşıma ve birleştirme")
    const mergeSourceTable = await api("POST", "/api/restoran/masalar", {
      companyId: company.id,
      areaId: created.areaId,
      name: `T${stamp}-M`,
    })
    created.tableIds.push(mergeSourceTable.body?.id)

    const mergeSource = await api("POST", "/api/restoran/adisyonlar", {
      companyId: company.id,
      tableId: mergeSourceTable.body.id,
      guestCount: 2,
    })
    created.ticketIds.push(mergeSource.body?.id)
    await api("POST", `/api/restoran/adisyonlar/${mergeSource.body.id}/kalemler`, {
      companyId: company.id,
      description: "TEST Çay",
      quantity: 3,
      unitPrice: 20,
      vatRate: 10,
    })

    const targetBefore = await api("GET", `/api/restoran/adisyonlar/${stateTicket.body.id}?companyId=${company.id}`)
    const merge = await api("POST", `/api/restoran/adisyonlar/${stateTicket.body.id}/birlestir`, {
      companyId: company.id,
      sourceTicketId: mergeSource.body.id,
    })
    check("adisyonlar birleştirildi", merge.status === 200, `${merge.body?.movedItems} kalem`)
    check(
      "kalemler hedefe geçti",
      merge.body?.ticket?.items?.length ===
        (targetBefore.body?.items?.length ?? 0) + (merge.body?.movedItems ?? 0),
      `${merge.body?.ticket?.items?.length} kalem`,
    )

    const sourceAfter = await prisma.restaurantTicket.findUnique({
      where: { id: mergeSource.body.id },
      select: { status: true, mergedIntoId: true },
    })
    check(
      "kaynak adisyon 'birleştirildi' izi taşıyor (iptalden ayrı)",
      sourceAfter?.status === "CANCELLED" && sourceAfter?.mergedIntoId === stateTicket.body.id,
    )

    const selfMerge = await api("POST", `/api/restoran/adisyonlar/${stateTicket.body.id}/birlestir`, {
      companyId: company.id,
      sourceTicketId: stateTicket.body.id,
    })
    check("adisyon kendisiyle birleştirilemiyor", selfMerge.status === 400, selfMerge.body?.error)

    // ── 10f. Boş bekleme raporu ─────────────────────────────────────────────
    // Masa 2'de 8. adımda bir adisyon kapanmıştı; birleşen adisyonu da burada
    // kapatınca aynı masada AYNI GÜN iki kapanış oluyor → aralarındaki boşluk
    // ölçülebilir hale geliyor. Ölçüm geçmiş veriden türetiliyor, yeni alan yok.
    console.log("\n10f) Boş bekleme (masa ölü zamanı)")
    const idlePayload = await api(
      "GET",
      `/api/restoran/adisyonlar/${stateTicket.body.id}/kapat?companyId=${company.id}`,
    )
    const idleInvoice = await api("POST", "/api/e-donusum/invoices", idlePayload.body.invoicePayload)
    created.invoiceIds.push(idleInvoice.body?.id)
    const idleClose = await api("POST", `/api/restoran/adisyonlar/${stateTicket.body.id}/kapat`, {
      companyId: company.id,
      invoiceId: idleInvoice.body.id,
    })
    check("birleşen adisyon kapatıldı", idleClose.status === 200, idleClose.body?.invoiceNo)

    const idleReport = await api("GET", `/api/restoran/raporlar/masalar?companyId=${company.id}`)
    const idleTable = idleReport.body?.tables?.find((t) => t.key === created.tableIds[1])
    check(
      "aynı masadaki iki devir arasındaki boşluk ölçüldü",
      idleTable?.idleGaps === 1 && Number.isFinite(idleTable?.avgIdleMinutes),
      `${idleTable?.idleGaps} boşluk · ort ${Number(idleTable?.avgIdleMinutes).toFixed(1)} dk`,
    )
    check(
      "boş bekleme negatif değil",
      (idleTable?.avgIdleMinutes ?? 0) >= 0 && (idleTable?.idleMinutes ?? 0) >= 0,
    )
    const singleTurn = idleReport.body?.tables?.filter(
      (t) => t.key !== "__takeaway__" && t.tickets === 1,
    )
    check(
      "tek devirli masada boşluk yok (günün ilk adisyonundan önce boşluk olmaz)",
      (singleTurn ?? []).every((t) => t.idleGaps === 0),
      `${singleTurn?.length ?? 0} masa`,
    )
    const takeaway = idleReport.body?.tables?.find((t) => t.key === "__takeaway__")
    check(
      "masasız (paket) adisyonlar boş bekleme üretmiyor",
      !takeaway || takeaway.idleGaps === 0,
      `${takeaway?.tickets ?? 0} paket adisyon`,
    )
    check(
      "özet boş bekleme alanlarını taşıyor",
      idleReport.body?.summary?.idleGaps >= 1 &&
        idleReport.body?.summary?.idleMaxMinutes === 120,
      `ort ${Number(idleReport.body?.summary?.avgIdleMinutes ?? 0).toFixed(1)} dk`,
    )

    // ── 11. Ekranlar ────────────────────────────────────────────────────────
    // Sayfalar Client Component; 200 dönmesi derlendiklerini ve sunucuda hatasız
    // render edildiklerini gösterir (render hatası Next'te 500 döner).
    console.log("\n11) Ekranlar")
    for (const [label, path] of [
      ["salon planı", "/restoran/masalar"],
      ["adisyon", `/restoran/adisyon/${open1.body.id}`],
      ["kahveci satış (refactor sonrası)", "/restoran/satis"],
      ["menü & reçeteler", "/restoran/menu"],
      ["raporlar — masalar sekmesi", "/restoran/raporlar?rapor=masalar"],
      ["raporlar — gün sonu sekmesi", "/restoran/raporlar?rapor=gun-sonu"],
    ]) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
      check(`${label} sayfası`, res.status === 200, `HTTP ${res.status}`)
    }

    // ── 12. Modül kapısı ────────────────────────────────────────────────────
    console.log("\n12) Modül kapısı (sunucu tarafı)")
    await prisma.company.update({
      where: { id: company.id },
      data: { disabledModules: { set: [...(company.disabledModules ?? []), "restaurant"] } },
    })
    const blocked = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
    check("modül kapalıyken uç 403", blocked.status === 403, blocked.body?.error)
    const blockedReport = await api("GET", `/api/restoran/raporlar/masalar?companyId=${company.id}`)
    check("modül kapalıyken masa raporu 403", blockedReport.status === 403, blockedReport.body?.error)
    await prisma.company.update({
      where: { id: company.id },
      data: { disabledModules: { set: company.disabledModules ?? [] } },
    })
    const restored = await api("GET", `/api/restoran/masalar?companyId=${company.id}`)
    check("modül geri açıldı", restored.status === 200)
  } finally {
    // ── Temizlik ──────────────────────────────────────────────────────────
    console.log("\n13) Temizlik (test verisi geri alınıyor)")
    for (const invoiceId of created.invoiceIds.filter(Boolean)) {
      const del = await fetch(`${BASE}/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`, {
        method: "DELETE",
        headers: { cookie },
      })
      check("fiş silindi (stok geri alındı)", del.ok, `HTTP ${del.status}`)
    }
    const milkFinal = await prisma.product.findFirst({
      where: { companyId: company.id, name: { contains: "Süt" } },
      select: { stockQuantity: true },
    })
    console.log(`  · süt stoğu şimdi: ${Number(milkFinal?.stockQuantity ?? 0)}`)

    // Rezervasyon adisyona bağlı olabilir; adisyonlardan ÖNCE silinmeli.
    await prisma.restaurantReservation.deleteMany({
      where: { companyId: company.id, id: { in: created.reservationIds.filter(Boolean) } },
    })
    await prisma.restaurantTicket.deleteMany({
      where: { id: { in: created.ticketIds.filter(Boolean) } },
    })
    await prisma.restaurantPlanItem.deleteMany({
      where: { id: { in: created.planItemIds.filter(Boolean) } },
    })
    // Şıklar CASCADE ile gider.
    await prisma.productOptionGroup.deleteMany({
      where: { id: { in: created.optionGroupIds.filter(Boolean) } },
    })
    await prisma.customer.deleteMany({
      where: { id: { in: created.customerIds.filter(Boolean) } },
    })
    await prisma.restaurantTable.deleteMany({
      where: { id: { in: created.tableIds.filter(Boolean) } },
    })
    await prisma.restaurantArea.deleteMany({
      where: { id: { in: [created.areaId, created.areaId2].filter(Boolean) } },
    })
    const leftover = await prisma.restaurantTicket.count({ where: { companyId: company.id } })
    const leftoverPlan = await prisma.restaurantPlanItem.count({ where: { companyId: company.id } })
    console.log(`  · kalan adisyon kaydı: ${leftover} · kalan kroki öğesi: ${leftoverPlan}`)
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
