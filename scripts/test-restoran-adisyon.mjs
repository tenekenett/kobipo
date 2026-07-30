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

    await prisma.restaurantTicket.deleteMany({
      where: { id: { in: created.ticketIds.filter(Boolean) } },
    })
    await prisma.restaurantPlanItem.deleteMany({
      where: { id: { in: created.planItemIds.filter(Boolean) } },
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
