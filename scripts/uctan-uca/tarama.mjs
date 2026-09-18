/**
 * Uçtan uca tarama — her API ucu, her sayfa, her query süzgeci; dört kimlikle.
 *
 *   1) Kobipo dev sunucusu açık olmalı:  npx next dev --turbo -p 3005
 *   2) TEST_BASE_URL=http://localhost:3005 node scripts/uctan-uca/tarama.mjs [seçenekler]
 *
 * Seçenekler:
 *   --eslesme=<regex>   yalnız yolu eşleşen uçlar/sayfalar (ör. --eslesme=^cari)
 *   --fuzz-yok          süzgeç (query) bulandırmasını atla
 *   --sayfa-yok         panel sayfalarını atla
 *   --yazma-yok         POST/PUT/PATCH/DELETE olumsuz sondalarını atla
 *   --eszamanli=N       aynı anda kaç istek (varsayılan 6)
 *   --devam             yarım kalan taramayı sürdür: sondalar.jsonl'deki sondalar atlanır
 *
 * GERÇEK sunucuya GERÇEK HTTP ile gider; oturumlar NextAuth `encode` ile üretilen JWT
 * çerezleridir (scripts/test-fatura-kurus.mjs ile aynı yol). Kimlikler:
 *   anon     çerez yok
 *   adminA   A firmasının (TARAMA_FIRMA_A) süper olmayan ADMIN'i
 *   adminB   A'ya ÜYE OLMAYAN başka bir firmanın ADMIN'i
 *   viewerA  A'da VIEWER — tarama için açılır, sonunda SİLİNİR
 *   super    (varsa) bir süper-admin; yalnız salt-okuma sondalarında
 *
 * Yazma uçlarına yalnız OLUMSUZ sondalar gider (anon / adminB / viewerA): kapı doğru
 * çalışıyorsa hiçbir kayıt yazılmaz. Kapı kırıksa yazar — bu yüzden A firmasının tüm
 * tablolarının satır sayısı tarama öncesi/sonrası karşılaştırılır ve fark bulgu olur.
 * A firması bu yüzden GERÇEK MÜŞTERİ FİRMASI OLMAMALI (varsayılan: Reypo Medya, dev).
 *
 * Çıktı: scripts/uctan-uca/sonuc.json (tüm sondalar) + docs/denetim/UCTAN-UCA-TARAMA-SONUC.md
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"
import { inventory } from "./envanter.mjs"

loadEnv({ path: ".env.local", override: true })

const ROOT = process.cwd()
const BASE = process.env.TEST_BASE_URL || "http://localhost:3005"
const FIRMA_A = process.env.TARAMA_FIRMA_A || "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı (dev)
const FIRMA_B = process.env.TARAMA_FIRMA_B || "cmod4a8xz0001liqswmpjb6x2" // Demo Firma A.Ş.
const ADMIN_A = process.env.TARAMA_ADMIN_A || "yasin.dikdere123@gmail.com"
const ADMIN_B = process.env.TARAMA_ADMIN_B || "demo@muhasebe.com"
const VIEWER_EMAIL = "oto-tarama-viewer@kobipo.test"

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : def
}
const ESLESME = opt("eslesme") ? new RegExp(opt("eslesme")) : null
const CONCURRENCY = Number(opt("eszamanli", 6))
const DO_FUZZ = !flag("fuzz-yok")
const DO_PAGES = !flag("sayfa-yok")
const DO_WRITES = !flag("yazma-yok")
const DEVAM = flag("devam")

const prisma = new PrismaClient()
const secret = process.env.NEXTAUTH_SECRET
if (!secret) throw new Error("NEXTAUTH_SECRET yok")

// ---------------------------------------------------------------------------
// Sınıflandırma
// ---------------------------------------------------------------------------

/** Dış servise giden ya da iş çalıştıran uçlar: OLUMLU sonda yok (kapı sondaları var). */
const EXTERNAL = [
  /^e-donusum\/(check-vkn|discover-|inbox\/sync|invoices\/sync-statuses|onboarding|partner-check|verify-tenant-vkn|templates\/(refresh|activate|design|preview|designs))/,
  /^e-donusum\/invoices\/\[id\]\/(check-status|approve|cancel|finalize|draft-pdf|preview-pdf|pdf)/,
  /^e-donusum\/inbox\/\[uuid\]\/(respond|pdf|view)/,
  /^e-donusum\/invoices\/preview-pdf/,
  /^e-donusum\/(credit|numerators|tax-types|withholding-types|series-templates|templates)$/,
  /^e-irsaliye\/\[id\]\/(send|status)/,
  /^billing\/(cron|recurring|notify-expiring|reconcile)/,
  /^asistan\/sohbet/,
  /^alis\/fis-tarama/,
  /^test-mysoft/,
  /^kur$/,
  /^kontor\/tariffs$/,
  /^banka\/mutabakat/,
  /^faturalar\/\[id\]\/email/,
  /^system-admin\/backup/,
  /^import$/,
]

/** Sondanın ANON kimlikle "reddedildi" sayıldığı durumlar. */
const isReject = (s) => s === 401 || s === 403 || (s >= 300 && s < 400)

// Rota önekine göre [id] hangi fikstürden dolar.
const SEGMENT_MAP = [
  [/^cari\/customers\//, "customer"],
  [/^cari\/suppliers\//, "supplier"],
  [/^stok\/products\//, "product"],
  [/^stok\/etiket-sablonlari\//, "labelTemplate"],
  [/^depolar\//, "warehouse"],
  [/^finans\/accounts\//, "financialAccount"],
  [/^finans\/transactions\//, "transaction"],
  [/^faturalar\/odemeler\//, "invoicePayment"],
  [/^faturalar\//, "invoice"],
  [/^e-donusum\/invoices\//, "invoice"],
  [/^e-donusum\/inbox\//, "incomingUuid"],
  [/^e-irsaliye\//, "waybill"],
  [/^irsaliye\//, "waybill"],
  [/^siparis\//, "order"],
  [/^teklif\//, "quote"],
  [/^fisler\//, "receipt"],
  [/^cek-senet\//, "check"],
  [/^personel\/employees\//, "employee"],
  [/^personel\/leaves\//, "leaveRecord"],
  [/^personel\/payroll\//, "payrollRecord"],
  [/^personel\/assets\//, "assetAssignment"],
  [/^personel\/documents\//, "employeeDocument"],
  [/^personel\/belge-sablonlari\//, "documentTemplate"],
  [/^personel\/holidays\//, "companyHoliday"],
  [/^personel\/shifts\//, "workShift"],
  [/^personel\/shift-templates\//, "shiftTemplate"],
  [/^restoran\/adisyonlar\//, "restaurantTicket"],
  [/^restoran\/bolgeler\//, "restaurantArea"],
  [/^restoran\/masalar\//, "restaurantTable"],
  [/^restoran\/plan\//, "restaurantPlanItem"],
  [/^restoran\/recipes\//, "productRecipe"],
  [/^restoran\/rezervasyonlar\//, "restaurantReservation"],
  [/^restoran\/urun-secenekleri\//, "productOptionGroup"],
  [/^restoran\/kontrol-listesi\//, "checklistItem"],
  [/^company\/definitions\//, "companyDefinition"],
  [/^company\/roles\//, "companyRole"],
  [/^company\/invitations\//, "companyInvitation"],
  [/^company\/users\//, "userCompany"],
  [/^companies\//, "company"],
  [/^support\/tickets\//, "supportTicket"],
  [/^admin\/support\//, "supportTicket"],
  [/^admin\/discount-codes\//, "discountCode"],
  [/^billing\/orders\//, "packageOrder"],
  [/^billing\/admin\/orders\//, "packageOrder"],
  [/^kontor\/orders\//, "kontorOrder"],
  [/^billing\/packages\//, "plan"],
  [/^kontor\/packages\//, "kontorPackage"],
  [/^blog\//, "blogPost"],
  [/^system-admin\/companies\//, "company"],
  [/^system-admin\/users\//, "userA"],
  [/^system-admin\/blog-editors\//, "blogEditor"],
  [/^system-admin\/role-templates\//, "roleTemplate"],
  [/^system-admin\/document-templates\//, "systemDocumentTemplate"],
  [/^invitations\//, "invitationToken"],
  [/^pay\//, "paymentLinkToken"],
]

const DATASETS = [
  "products", "cari", "ekstre", "invoices", "gelen-e-faturalar", "rapor-stok", "rapor-stok-hareket",
  "rapor-cari-yaslandirma", "rapor-kar-zarar", "rapor-bilanco", "rapor-nakit-akisi", "rapor-gelir-gider",
  "rapor-harcamalar", "rapor-satis", "rapor-alis", "rapor-personel", "personel-puantaj", "personel-devam",
  "personel-vardiya", "rapor-vergiler",
]

// Panel sayfalarındaki dinamik parçalar.
const PAGE_SEGMENT_MAP = [
  [/^cari\/\[type\]/, { type: "customers", id: "customer" }],
  [/^cek-senet\/cek\//, { id: "check" }],
  [/^cek-senet\/senet\//, { id: "promissoryNote" }],
  [/^stok\//, { id: "product" }],
  [/^personel\//, { id: "employee" }],
  [/^e-donusum\/kontor\/odeme\//, { id: "kontorOrder" }],
  [/^e-donusum\//, { id: "invoice" }],
  [/^faturalar\//, { id: "invoice" }],
  [/^fisler\//, { id: "receipt" }],
  [/^finans\/hareketler\//, { id: "transaction" }],
  [/^finans\/kanallar\//, { id: "financialAccount" }],
  [/^restoran\/adisyon\//, { id: "restaurantTicket" }],
  [/^teklif\//, { id: "quote" }],
  [/^ayarlar\/subeler\//, { id: "branch" }],
  [/^ayarlar\/abonelik\/odeme\//, { id: "packageOrder" }],
  [/^alis\/gelen-e-faturalar\//, { uuid: "incomingUuid" }],
  [/^raporlar\/(satis|alis)\//, { bolum: "outline" }],
  [/^system-admin\/companies\//, { id: "company" }],
  [/^blog-admin\//, { id: "blogPost" }],
]

/** Query bulandırma değerleri — 500 ve zaman ölçülür. */
const FUZZ_VALUES = [
  "", "'", "\"><script>alert(1)</script>", "-1", "0", "999999999999", "abc", "2026-13-45", "%00",
  "x".repeat(2500), "[]", "null", "undefined", "1;DROP TABLE users--", "*", "%", "../../etc/passwd",
]
const FUZZ_BY_NAME = {
  limit: ["100000", "1e9"], pageSize: ["100000"], take: ["100000"], page: ["-5", "1e9"],
  companyId: ["' OR 1=1--", FIRMA_B], company: [FIRMA_B],
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const started = Date.now()
const log = (...a) => console.log(...a)

async function pool(items, fn, n = CONCURRENCY) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx], idx)
      }
    })
  )
  return out
}

async function sessionFor(email) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isSuperAdmin: true, isBlogEditor: true, companies: { select: { companyId: true, role: true } } },
  })
  if (!user) throw new Error(`kullanıcı yok: ${email}`)
  const first = user.companies[0]
  const token = await encode({
    token: {
      id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin || false, isBlogEditor: user.isBlogEditor || false,
      defaultCompanyId: first?.companyId ?? null, defaultRole: first?.role ?? null,
    },
    secret,
  })
  return { email, userId: user.id, cookie: `next-auth.session-token=${token}`, isSuperAdmin: user.isSuperAdmin }
}

async function http(session, method, url, body) {
  const t0 = performance.now()
  try {
    const res = await fetch(`${BASE}${url}`, {
      method,
      redirect: "manual",
      headers: {
        ...(session ? { cookie: session.cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "x-oto-tarama": "1",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    })
    const text = await res.text()
    return {
      status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, text,
      location: res.headers.get("location"), ctype: res.headers.get("content-type") || "",
    }
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), bytes: 0, text: String(e?.message || e), location: null, ctype: "" }
  }
}

const STACK_RE = /PrismaClient\w*Error|Invalid `prisma\.|\bat \w+ \([^)]*\.(ts|js|mjs):\d+|node_modules[\\/]|ECONNREFUSED|TypeError: |ReferenceError: |Cannot read properties/

function stackLeak(r) {
  return r.status >= 500 && STACK_RE.test(r.text) ? "stack" : null
}

// ---------------------------------------------------------------------------
// Fikstürler
// ---------------------------------------------------------------------------

async function firstId(model, where, select = { id: true }) {
  try {
    const row = await prisma[model].findFirst({ where, select })
    return row ?? null
  } catch (e) {
    return null
  }
}

async function loadFixtures(companyId) {
  const f = {}
  const simple = {
    customer: "customer", supplier: "supplier", product: "product", labelTemplate: "labelTemplate",
    warehouse: "warehouse", financialAccount: "financialAccount", transaction: "transaction",
    invoicePayment: "invoicePayment", waybill: "waybill", order: "order", quote: "quote", check: "check",
    promissoryNote: "promissoryNote", employee: "employee", leaveRecord: "leaveRecord", payrollRecord: "payrollRecord",
    assetAssignment: "assetAssignment", employeeDocument: "employeeDocument", documentTemplate: "documentTemplate",
    companyHoliday: "companyHoliday", workShift: "workShift", shiftTemplate: "shiftTemplate",
    restaurantTicket: "restaurantTicket", restaurantArea: "restaurantArea", restaurantTable: "restaurantTable",
    restaurantPlanItem: "restaurantPlanItem", productRecipe: "productRecipe", restaurantReservation: "restaurantReservation",
    productOptionGroup: "productOptionGroup", checklistItem: "checklistItem", companyDefinition: "companyDefinition",
    companyRole: "companyRole", supportTicket: "supportTicket", packageOrder: "packageOrder", kontorOrder: "kontorOrder",
  }
  for (const [key, model] of Object.entries(simple)) f[key] = (await firstId(model, { companyId }))?.id ?? null
  f.company = companyId
  f.invoice = (await firstId("invoice", { companyId, isReceipt: false }))?.id ?? null
  f.receipt = (await firstId("invoice", { companyId, isReceipt: true }))?.id ?? null
  f.incomingUuid = (await firstId("incomingInvoice", { companyId }, { uuid: true }))?.uuid ?? null
  const inv = await firstId("companyInvitation", { companyId }, { id: true, token: true })
  f.companyInvitation = inv?.id ?? null
  f.invitationToken = inv?.token ?? null
  f.paymentLinkToken = (await firstId("paymentLink", { companyId }, { token: true }))?.token ?? null
  f.userCompany = (await firstId("userCompany", { companyId }))?.id ?? null
  f.restaurantTicketItem = (await firstId("restaurantTicketItem", { ticket: { companyId } }))?.id ?? null
  f.branch = (await firstId("company", { parentCompanyId: companyId }))?.id ?? null
  // sistem geneli
  f.plan = (await firstId("plan", {}))?.id ?? null
  f.kontorPackage = (await firstId("kontorPackage", {}))?.id ?? null
  f.blogPost = (await firstId("blogPost", {}))?.id ?? null
  f.roleTemplate = (await firstId("roleTemplate", {}))?.id ?? null
  f.systemDocumentTemplate = (await firstId("documentTemplate", { companyId: null }))?.id ?? null
  f.discountCode = (await firstId("discountCode", {}))?.id ?? null
  f.blogEditor = (await firstId("user", { isBlogEditor: true }))?.id ?? null
  f.userA = null // sonra doldurulur (adminA)
  return f
}

/** adminB için A'ya ait olduğu KESİN metinler: yanıt gövdesinde geçerse sızıntı. */
async function loadMarkers(companyId, fixtures) {
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, taxNumber: true } })
  const names = []
  for (const model of ["customer", "supplier", "product", "employee"]) {
    try {
      const rows = await prisma[model].findMany({ where: { companyId }, select: { name: true }, take: 3 })
      for (const r of rows) if (r.name && r.name.length >= 6) names.push(r.name)
    } catch {}
  }
  const ids = Object.entries(fixtures)
    .filter(([k, v]) => typeof v === "string" && v.length > 10 && !["plan", "kontorPackage", "blogPost", "roleTemplate", "systemDocumentTemplate", "discountCode", "blogEditor", "userA"].includes(k))
    .map(([, v]) => v)
  return { name: co?.name, texts: [companyId, co?.name, co?.taxNumber, ...names].filter(Boolean), ids: [...new Set(ids)] }
}

async function snapshot(companyId) {
  const tables = await prisma.$queryRawUnsafe(
    `select table_name from information_schema.columns where table_schema='public' and column_name='companyId' order by 1`
  )
  const union = tables
    .map((t) => `select '${t.table_name}' as t, count(*)::int as n from public."${t.table_name}" where "companyId" = '${companyId}'`)
    .join(" union all ")
  const rows = await prisma.$queryRawUnsafe(union)
  return Object.fromEntries(rows.map((r) => [r.t, r.n]))
}

const LOG_TABLES = new Set(["system_logs", "access_logs", "automation_card_events", "notifications", "cron_runs", "subscription_events", "usage_limits", "login_attempts"])

// ---------------------------------------------------------------------------
// URL kurma
// ---------------------------------------------------------------------------

function fixtureKeyFor(routePath, segment) {
  if (segment === "dataset") return "dataset"
  if (segment === "uuid") return "incomingUuid"
  if (segment === "companyId") return "company"
  if (segment === "itemId") return "restaurantTicketItem"
  if (segment === "token") return routePath.startsWith("pay/") ? "paymentLinkToken" : "invitationToken"
  if (segment === "nextauth") return "nextauth"
  for (const [re, key] of SEGMENT_MAP) if (re.test(routePath)) return key
  return null
}

/** Rota yolunu somut URL(ler)e çevirir; eksik fikstürde null. */
function concreteUrls(route, fixtures) {
  let paths = [route.path]
  const missing = []
  for (const seg of route.segments) {
    const key = fixtureKeyFor(route.path, seg)
    if (key === "dataset") {
      paths = paths.flatMap((p) => DATASETS.map((d) => p.replace("[dataset]", d)))
      continue
    }
    if (key === "nextauth") {
      paths = paths.map((p) => p.replace("[...nextauth]", "session"))
      continue
    }
    const val = key ? fixtures[key] : null
    if (!val) {
      missing.push(`${seg}→${key ?? "?"}`)
      break
    }
    paths = paths.map((p) => p.replace(`[${seg}]`, val))
  }
  if (missing.length) return { urls: [], missing }
  return { urls: paths.map((p) => `/api/${p}`), missing }
}

/**
 * Olumsuz yazma sondalarının gövdesi. Amaç doğrulamayı GEÇİP kapıya ulaşmak: gövde
 * boş olursa çoğu uç "name required" ile 400 döner ve kapı hiç ölçülemez. Kapı
 * doğruysa yine hiçbir şey yazılmaz; kırıksa yazılan kayıt "OTO-TARAMA" adıyla
 * bulunur ve satır sayısı farkı bulgu olarak çıkar.
 */
const genericBody = (companyId) => ({
  companyId, name: "OTO-TARAMA", title: "OTO-TARAMA", code: "OTO-TARAMA", description: "OTO-TARAMA",
  date: new Date().toISOString().slice(0, 10), amount: 1, quantity: 1, price: 1, unitPrice: 1, items: [],
  email: "oto-tarama@kobipo.test", status: "ACTIVE", type: "CHECK", role: "VIEWER", key: "OTO-TARAMA",
})

const withCompany = (url, companyId, extra = {}) => {
  const u = new URL(url, "http://x")
  u.searchParams.set("companyId", companyId)
  u.searchParams.set("company", companyId)
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
  return u.pathname + u.search
}

// ---------------------------------------------------------------------------
// Bulgular
// ---------------------------------------------------------------------------

const findings = []
const probes = []
/**
 * Sondalar bittikçe diske yazılır (JSONL): tarama yarıda kesilirse (bellek, kapanış)
 * ölçüm kaybolmaz ve `--devam` kaldığı yerden sürer. Bulgular anahtarları da aynı
 * dosyaya girer ki devam eden koşu önceki bulguları yeniden üretmek zorunda kalmasın.
 */
const JSONL = path.join(ROOT, "scripts", "uctan-uca", "sondalar.jsonl")
const probeKey = (j) => `${j.identity} ${j.method} ${j.url}`
function finding(severity, kind, where, detail, probe) {
  const f = { severity, kind, where, detail, status: probe?.status, ms: probe?.ms, url: probe?.url, identity: probe?.identity, method: probe?.method }
  findings.push(f)
  fs.appendFileSync(JSONL, JSON.stringify({ t: "bulgu", ...f }) + "\n")
}
function record(p) {
  probes.push(p)
  fs.appendFileSync(JSONL, JSON.stringify({ t: "sonda", ...p }) + "\n")
  return p
}
const bodyHash = (text) => createHash("sha1").update(text).digest("hex")

/**
 * Olumsuz yazma sondalarının kapı DIŞINDA kalan tek olumlu etkisi: `POST /api/companies`
 * "yeni hesap" yerleşiminde HER oturumlu kullanıcıya açıktır (ilk firma akışı) —
 * viewerA'nın kendi hesabı yoktur, gövdedeki ad ile bir firma açar. Bu tasarım gereği;
 * ama kayıt kalmamalı: koşu boyunca açılan OTO-TARAMA firmaları silinir (cascade).
 */
async function deleteScanCompanies(since) {
  const rows = await prisma.company.findMany({
    where: { name: "OTO-TARAMA", createdAt: { gte: since } },
    select: { id: true },
  })
  for (const r of rows) await prisma.company.delete({ where: { id: r.id } })
  return rows.length
}

function containsMarker(text, markers) {
  if (!text) return null
  for (const t of markers.texts) if (t && text.includes(t)) return t
  for (const id of markers.ids) if (text.includes(id)) return id
  return null
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------

async function main() {
  log(`Sunucu: ${BASE}`)
  const ok = await fetch(`${BASE}/api/health/db`).then((r) => r.status).catch(() => 0)
  if (!ok) throw new Error("sunucuya ulaşılamıyor")

  const companyA = await prisma.company.findUnique({ where: { id: FIRMA_A }, select: { name: true } })
  const companyB = await prisma.company.findUnique({ where: { id: FIRMA_B }, select: { name: true } })
  log(`A: ${companyA?.name} (${FIRMA_A})  B: ${companyB?.name} (${FIRMA_B})`)

  /** adminA'nın olumlu yanıtı: { hash, bytes } — gövde bellekte tutulmaz. */
  const positiveBody = new Map()
  const adminA = await sessionFor(ADMIN_A)
  const adminB = await sessionFor(ADMIN_B)
  if (adminA.isSuperAdmin || adminB.isSuperAdmin) throw new Error("adminA/adminB süper olmamalı")
  const bMember = await prisma.userCompany.findFirst({ where: { userId: adminB.userId, companyId: FIRMA_A } })
  if (bMember) throw new Error("adminB A'ya üye — tarama anlamsız")
  const superUser = await prisma.user.findFirst({ where: { isSuperAdmin: true }, select: { email: true } })
  const superS = superUser ? await sessionFor(superUser.email) : null

  // viewerA: tarama için aç
  let viewerUser = await prisma.user.findUnique({ where: { email: VIEWER_EMAIL } })
  if (!viewerUser) viewerUser = await prisma.user.create({ data: { email: VIEWER_EMAIL, name: "OTO-TARAMA Viewer", password: "x" } })
  await prisma.userCompany.upsert({
    where: { userId_companyId: { userId: viewerUser.id, companyId: FIRMA_A } },
    update: { role: "VIEWER" },
    create: { userId: viewerUser.id, companyId: FIRMA_A, role: "VIEWER" },
  })
  const viewerA = await sessionFor(VIEWER_EMAIL)

  const fixtures = await loadFixtures(FIRMA_A)
  fixtures.userA = adminA.userId
  const markers = await loadMarkers(FIRMA_A, fixtures)
  const missingFixtures = Object.entries(fixtures).filter(([, v]) => !v).map(([k]) => k)
  log(`Fikstür: ${Object.keys(fixtures).length - missingFixtures.length} dolu, eksik: ${missingFixtures.join(", ") || "-"}`)

  /** Önceki koşudan taşınan sonda anahtarları ve olumlu gövde hash'leri. */
  const doneKeys = new Set()
  const pageResults = []
  let before = null
  if (DEVAM && fs.existsSync(JSONL)) {
    for (const line of fs.readFileSync(JSONL, "utf8").split("\n")) {
      if (!line.trim()) continue
      const row = JSON.parse(line)
      if (row.t === "sonda") {
        probes.push(row)
        doneKeys.add(probeKey(row))
        if (row.probeKind === "positive" && row.bodyHash) positiveBody.set(`${row.method} ${row.url}`, { hash: row.bodyHash, bytes: row.bytes })
      } else if (row.t === "bulgu") findings.push(row)
      else if (row.t === "sayfa") { pageResults.push(row); doneKeys.add(`${row.identity} GET ${row.url}`) }
      else if (row.t === "snapshot") before = row.counts
    }
    log(`Devam: ${doneKeys.size} sonda önceki koşudan alındı (${findings.length} bulgu)`)
  } else if (fs.existsSync(JSONL)) fs.unlinkSync(JSONL)
  // Satır sayısı tabanı İLK koşudan gelir: devam eden koşu yeni taban alsaydı önceki
  // koşunun yazdığı kayıt "değişiklik yok" sayılırdı.
  if (!before) {
    before = await snapshot(FIRMA_A)
    fs.appendFileSync(JSONL, JSON.stringify({ t: "snapshot", counts: before }) + "\n")
  }

  let routes = inventory()
  if (ESLESME) routes = routes.filter((r) => ESLESME.test(r.path))
  log(`Uç: ${routes.length}`)

  const sessions = { anon: null, adminA, adminB, viewerA, super: superS }
  const cls = (r) => {
    if (r.gates.includes("requireSuperAdmin") || r.path.startsWith("system-admin/") || r.path.startsWith("admin/") || r.path.startsWith("billing/admin/")) return "SUPER"
    if (r.gates.includes("requireBlogEditor")) return "BLOG"
    if (r.gates.includes("cronSecret") && !r.gates.includes("ensureCompanyAccess")) return "CRON"
    if (r.publicByDesign || r.gates.length === 0) return "PUBLIC"
    return "COMPANY"
  }
  const isExternal = (p) => EXTERNAL.some((re) => re.test(p))

  // -------------------------------------------------------------------------
  // 1) API sondaları
  // -------------------------------------------------------------------------
  const jobs = []
  const uncovered = []
  for (const r of routes) {
    const routeClass = cls(r)
    const { urls, missing } = concreteUrls(r, fixtures)
    if (!urls.length) {
      uncovered.push({ path: r.path, methods: r.methods, reason: `fikstür yok: ${missing.join(",")}` })
      continue
    }
    for (const base of urls) {
      for (const method of r.methods) {
        const isWrite = method !== "GET"
        if (isWrite && !DO_WRITES) continue
        // Katalog uçları (planlar, fiyat listesi, kontör paketleri) GET'te her oturuma
        // açıktır, yazması süper-admine kapalıdır: sınıf METODA göre ayrılır, yoksa
        // "yönetici planları gördü" diye sahte kritik doğar.
        const klass = routeClass === "SUPER" && r.publicByDesign && !isWrite ? "PUBLIC" : routeClass
        const ext = isExternal(r.path)
        const push = (identity, url, body, probeKind, expect) =>
          jobs.push({ route: r, klass, method, identity, url, body, probeKind, expect })
        const qa = withCompany(base, FIRMA_A)
        const qb = withCompany(base, FIRMA_B)
        const bodyA = isWrite ? genericBody(FIRMA_A) : undefined
        const bodyB = isWrite ? genericBody(FIRMA_B) : undefined

        if (klass === "PUBLIC") {
          push("anon", qa, isWrite ? {} : undefined, "public", "not500")
          continue
        }
        if (klass === "CRON") {
          push("anon", qa, isWrite ? {} : undefined, "anon", "reject")
          continue
        }
        // her sınıf: anon reddedilmeli
        push("anon", qa, bodyA, "anon", "reject")
        if (klass === "SUPER") {
          push("adminA", qa, bodyA, "nonSuper", "reject")
          if (!isWrite && superS && !ext) push("super", qa, undefined, "positive", "not500")
          continue
        }
        if (klass === "BLOG") {
          push("adminA", qa, bodyA, "nonEditor", "reject")
          continue
        }
        // COMPANY
        push("adminB", qa, bodyA, "crossTenant", "reject")
        if (r.segments.length) push("adminB", qb, bodyB, "idor", "reject")
        if (isWrite) push("viewerA", qa, bodyA, "viewerWrite", "reject")
        if (!isWrite && !ext) {
          push("adminA", qa, undefined, "positive", "not500")
          push("viewerA", qa, undefined, "viewerRead", "not500")
          if (DO_FUZZ) {
            for (const key of r.params) {
              if (key === "companyId" || key === "company") continue
              const vals = [...FUZZ_VALUES, ...(FUZZ_BY_NAME[key] || [])]
              for (const v of vals) jobs.push({ route: r, klass, method, identity: "adminA", url: withCompany(base, FIRMA_A, { [key]: v }), body: undefined, probeKind: `fuzz:${key}`, expect: "not500", fuzzValue: v })
            }
            for (const key of ["companyId", "company"]) {
              if (!r.params.includes(key)) continue
              for (const v of FUZZ_BY_NAME[key]) jobs.push({ route: r, klass, method, identity: "adminA", url: withCompany(base, FIRMA_A, { [key]: v }), body: undefined, probeKind: `fuzz:${key}`, expect: "not500", fuzzValue: v })
            }
          }
        }
      }
    }
  }
  log(`Sonda: ${jobs.length} (fuzz ${jobs.filter((j) => j.probeKind.startsWith("fuzz")).length})`)

  // Aynı URL'nin adminA gövdesi (adminB karşılaştırması için) — önce olumluları koştur.
  const pending = jobs.filter((j) => !doneKeys.has(probeKey(j)))
  if (DEVAM) log(`Kalan sonda: ${pending.length}`)
  const positiveFirst = [...pending].sort((a, b) => (a.probeKind === "positive" ? -1 : 0) - (b.probeKind === "positive" ? -1 : 0))
  let done = 0
  await pool(positiveFirst, async (j) => {
    try {
      await runProbe(j)
    } catch (e) {
      finding("bilgi", "tarama-hatasi", `${j.method} ${j.route.path}`, `sonda değerlendirilemedi: ${String(e?.message || e).slice(0, 120)}`)
    }
    done++
    if (done % 250 === 0) log(`  ${done}/${pending.length} … ${Math.round((Date.now() - started) / 1000)}s`)
  })

  async function runProbe(j) {
    let res = await http(sessions[j.identity], j.method, j.url, j.body)
    // Dev sunucu ilk isteği derlemeyle şişirir; olumlu ölçüm ikinci istekten alınır.
    if (j.probeKind === "positive" && res.ms > 800) {
      const again = await http(sessions[j.identity], j.method, j.url, j.body)
      if (again.status === res.status) res = again
    }
    const { route: _r, ...jj } = j
    const p = record({
      ...jj, route: j.route.path, status: res.status, ms: res.ms, bytes: res.bytes, ctype: res.ctype, location: res.location,
      snippet: res.text.slice(0, 160).replace(/\s+/g, " "),
      ...(j.probeKind === "positive" ? { bodyHash: bodyHash(res.text) } : {}),
    })

    const leak = stackLeak(res)
    if (leak) finding("orta", "stack-sizintisi", `${j.method} ${j.route.path}`, `5xx gövdesi iç hata metni taşıyor`, p)

    if (j.probeKind === "positive") {
      positiveBody.set(`${j.method} ${j.url}`, { hash: p.bodyHash, bytes: res.bytes })
      if (res.status >= 500) finding("yuksek", "500", `${j.method} ${j.route.path}`, `adminA olumlu istekte 5xx: ${p.snippet}`, p)
      else if (res.status === 403 || res.status === 401) finding("dusuk", "olumlu-403", `${j.method} ${j.route.path}`, `A yöneticisi kendi firmasında ${res.status} aldı: ${p.snippet}`, p)
      else if (res.status === 404 || res.status === 400) finding("bilgi", "olumlu-4xx", `${j.method} ${j.route.path}`, `${res.status}: ${p.snippet}`, p)
      if (res.ms > 3000) finding("orta", "yavas", `${j.method} ${j.route.path}`, `${res.ms} ms, ${res.bytes} bayt`, p)
      else if (res.ms > 1500) finding("dusuk", "yavas", `${j.method} ${j.route.path}`, `${res.ms} ms, ${res.bytes} bayt`, p)
      if (res.bytes > 1_000_000) finding("orta", "buyuk-yanit", `${j.method} ${j.route.path}`, `${res.bytes} bayt`, p)
      return
    }
    if (j.probeKind === "public") {
      if (res.status >= 500) finding("yuksek", "500", `${j.method} ${j.route.path}`, `açık uç 5xx: ${p.snippet}`, p)
      return
    }
    if (j.probeKind === "viewerRead") {
      if (res.status >= 500) finding("yuksek", "500", `${j.method} ${j.route.path}`, `viewer okumada 5xx: ${p.snippet}`, p)
      return
    }
    if (j.probeKind.startsWith("fuzz")) {
      if (res.status >= 500) finding("orta", "fuzz-500", `${j.method} ${j.route.path}`, `${j.probeKind.slice(5)}=${String(j.fuzzValue ?? "").slice(0, 40)} → 5xx: ${p.snippet}`, p)
      if (res.ms > 5000) finding("orta", "fuzz-yavas", `${j.method} ${j.route.path}`, `${j.probeKind.slice(5)} ile ${res.ms} ms`, p)
      return
    }
    // reddedilmesi beklenenler
    if (j.expect === "reject") {
      if (res.status >= 500) {
        finding("orta", "kapi-500", `${j.method} ${j.route.path}`, `${j.identity} (${j.probeKind}) 5xx aldı — kapı yerine çöküş: ${p.snippet}`, p)
        return
      }
      if (isReject(res.status)) return
      if (res.status === 404) {
        // id firmaya göre süzüldü → beklenen. Anon'da 404, kapıdan önce id çözümü demek (düşük).
        if (j.identity === "anon") finding("dusuk", "anon-404", `${j.method} ${j.route.path}`, `oturumsuz istek 401 yerine 404 aldı (id çözümü kapıdan önce)`, p)
        return
      }
      if (res.status === 400 || res.status === 422 || res.status === 409) {
        if (j.identity === "anon") finding("dusuk", "anon-400", `${j.method} ${j.route.path}`, `oturumsuz istek 401 yerine ${res.status} aldı (doğrulama kapıdan önce): ${p.snippet}`, p)
        else if (j.probeKind === "viewerWrite") finding("bilgi", "viewer-400", `${j.method} ${j.route.path}`, `VIEWER yazma ${res.status} (doğrulama rol kapısından önce; 403 doğrulanamadı)`, p)
        else finding("dusuk", "kapi-400", `${j.method} ${j.route.path}`, `${j.identity} (${j.probeKind}) ${res.status} aldı, kapı sırası belirsiz: ${p.snippet}`, p)
        return
      }
      // 2xx
      const sev = "kritik"
      if (j.identity === "anon") {
        finding(sev, "oturumsuz-erisim", `${j.method} ${j.route.path}`, `oturumsuz istek ${res.status} döndü (${res.bytes} bayt)`, p)
        return
      }
      if (j.probeKind === "nonSuper" || j.probeKind === "nonEditor") {
        finding(sev, "yetki-asimi", `${j.method} ${j.route.path}`, `${j.probeKind} kimlik ${res.status} aldı`, p)
        return
      }
      if (j.probeKind === "viewerWrite") {
        finding(sev, "viewer-yazdi", `${j.method} ${j.route.path}`, `VIEWER yazma ucundan ${res.status} aldı`, p)
        return
      }
      if (j.probeKind === "crossTenant" || j.probeKind === "idor") {
        const hit = containsMarker(res.text, markers)
        // "adminA ile birebir aynı gövde" yalnız FİRMAYA GÖRE veri veren uçta sızıntıdır;
        // sistem geneli katalog (rol kalıpları, planlar) herkese aynı döner.
        const pos = j.method === "GET" && j.route.companyIdIn ? positiveBody.get(`GET ${j.url}`) : null
        const same = Boolean(pos && pos.hash === bodyHash(res.text) && res.bytes > 40)
        if (hit || same) {
          finding(sev, j.probeKind === "idor" ? "idor" : "firma-sizintisi", `${j.method} ${j.route.path}`, `${j.identity} A verisini gördü (${hit ? `işaret: ${hit.slice(0, 40)}` : "adminA gövdesiyle birebir"})`, p)
        } else if (j.method === "GET") {
          finding("orta", "firma-param-yoksayildi", `${j.method} ${j.route.path}`, `${j.identity} companyId=A ile ${res.status} aldı; A işareti yok (${res.bytes} bayt) — elle doğrula`, p)
        } else {
          finding("yuksek", "yazma-2xx", `${j.method} ${j.route.path}`, `${j.identity} (${j.probeKind}) yazma ucundan ${res.status} aldı: ${p.snippet}`, p)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2) Panel sayfaları
  // -------------------------------------------------------------------------
  if (DO_PAGES) {
    const pages = []
    const walkPages = (dir, prefix) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walkPages(p, prefix ? `${prefix}/${e.name}` : e.name)
        else if (e.name === "page.tsx") pages.push(prefix)
      }
    }
    for (const group of ["(dashboard)", "(system-admin)", "(blog-admin)"]) walkPages(path.join(ROOT, "app", group), "")
    let pageList = pages.filter(Boolean)
    if (ESLESME) pageList = pageList.filter((p) => ESLESME.test(p))
    const pageJobs = []
    for (const pg of pageList) {
      let url = pg
      const segs = [...pg.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
      let skip = null
      for (const s of segs) {
        const map = PAGE_SEGMENT_MAP.find(([re]) => re.test(pg))?.[1]
        const key = map?.[s]
        const val = key === "outline" ? "outline" : key ? fixtures[key] : null
        if (!val) { skip = `${s}→${key ?? "?"}`; break }
        url = url.replace(`[${s}]`, val)
      }
      if (skip) { uncovered.push({ path: `sayfa ${pg}`, methods: ["GET"], reason: `fikstür yok: ${skip}` }); continue }
      const isAdminGroup = pg.startsWith("system-admin") || pg.startsWith("blog-admin")
      const full = `/${url}?company=${FIRMA_A}`
      pageJobs.push({ page: pg, identity: "anon", url: full, expect: "redirect" })
      pageJobs.push({ page: pg, identity: "adminA", url: full, expect: isAdminGroup ? "redirect" : "200" })
      if (!isAdminGroup) {
        pageJobs.push({ page: pg, identity: "adminB", url: full, expect: "noMarker" })
        pageJobs.push({ page: pg, identity: "viewerA", url: full, expect: "not500" })
      } else if (superS) pageJobs.push({ page: pg, identity: "super", url: full, expect: "200" })
    }
    const pagePending = pageJobs.filter((j) => !doneKeys.has(`${j.identity} GET ${j.url}`))
    log(`Sayfa sondası: ${pagePending.length}${DEVAM ? ` (toplam ${pageJobs.length})` : ""}`)
    await pool(pagePending, async (j) => {
      const res = await http(sessions[j.identity], "GET", j.url)
      const errorMarker = /Application error|__next_error__|Internal Server Error|Unhandled Runtime Error/.test(res.text)
      const p = { ...j, status: res.status, ms: res.ms, bytes: res.bytes, location: res.location, errorMarker }
      pageResults.push(p)
      fs.appendFileSync(JSONL, JSON.stringify({ t: "sayfa", ...p }) + "\n")
      if (res.status >= 500 || (res.status === 200 && errorMarker)) {
        finding("yuksek", "sayfa-500", `sayfa /${j.page}`, `${j.identity}: ${res.status}${errorMarker ? " + hata işareti" : ""}`, { ...p, method: "GET" })
        return
      }
      if (j.expect === "redirect" && !(res.status >= 300 && res.status < 400)) {
        if (res.status === 200) finding(j.identity === "anon" ? "kritik" : "yuksek", "sayfa-acik", `sayfa /${j.page}`, `${j.identity} yönlendirilmeden 200 aldı`, { ...p, method: "GET" })
        return
      }
      if (j.expect === "200" && res.status !== 200) {
        finding("orta", "sayfa-4xx", `sayfa /${j.page}`, `${j.identity}: ${res.status} → ${res.location ?? ""}`, { ...p, method: "GET" })
      }
      if (j.expect === "noMarker" && res.status === 200) {
        // Firma id'si URL'de (`?company=`) taşındığı için HTML'de link olarak geri
        // yankılanır — sızıntı değildir; yalnız ad/VKN/kayıt id'leri sayılır.
        const hit = containsMarker(res.text, { ...markers, texts: markers.texts.filter((t) => t !== FIRMA_A) })
        if (hit) finding("kritik", "sayfa-sizintisi", `sayfa /${j.page}`, `adminB HTML'inde A işareti: ${hit.slice(0, 40)}`, { ...p, method: "GET" })
      }
      if (j.identity === "adminA" && res.status === 200 && res.ms > 4000) finding("dusuk", "sayfa-yavas", `sayfa /${j.page}`, `${res.ms} ms (dev derlemesi dahil)`, { ...p, method: "GET" })
    }, 3)
  }

  // -------------------------------------------------------------------------
  // 3) Yan etki denetimi + temizlik
  // -------------------------------------------------------------------------
  const after = await snapshot(FIRMA_A)
  const diffs = []
  for (const t of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[t] ?? 0) !== (after[t] ?? 0)) diffs.push({ table: t, before: before[t] ?? 0, after: after[t] ?? 0, log: LOG_TABLES.has(t) })
  }
  for (const d of diffs) {
    if (d.log) finding("bilgi", "yan-etki-log", d.table, `${d.before} → ${d.after} (kayıt tablosu, beklenen)`)
    else finding("kritik", "veri-degisti", d.table, `A firmasında satır sayısı ${d.before} → ${d.after}: bir olumsuz sonda YAZDI`)
  }

  const scanCompanies = await deleteScanCompanies(new Date(started))
  if (scanCompanies) finding("bilgi", "tarama-firmasi-silindi", "POST companies", `${scanCompanies} OTO-TARAMA firması açılmıştı (yeni-hesap akışı herkese açık, tasarım gereği); silindi`)
  await prisma.userCompany.deleteMany({ where: { userId: viewerA.userId, companyId: FIRMA_A } })
  await prisma.user.delete({ where: { id: viewerA.userId } }).catch(() => {})

  // -------------------------------------------------------------------------
  // 4) Rapor
  // -------------------------------------------------------------------------
  const order = { kritik: 0, yuksek: 1, orta: 2, dusuk: 3, bilgi: 4 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || a.where.localeCompare(b.where))
  const outJson = path.join(ROOT, "scripts", "uctan-uca", "sonuc.json")
  fs.writeFileSync(outJson, JSON.stringify({ base: BASE, firmaA: FIRMA_A, firmaB: FIRMA_B, date: new Date().toISOString(), findings, uncovered, probes, pageResults, diffs, fixtures }, null, 1))

  const counts = Object.fromEntries(Object.keys(order).map((k) => [k, findings.filter((f) => f.severity === k).length]))
  const byKind = {}
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1
  const slowest = probes.filter((p) => p.probeKind === "positive").sort((a, b) => b.ms - a.ms).slice(0, 25)
  const biggest = probes.filter((p) => p.probeKind === "positive").sort((a, b) => b.bytes - a.bytes).slice(0, 15)

  const md = []
  md.push(`# Uçtan uca tarama — ${new Date().toISOString().slice(0, 10)}`)
  md.push(``, `Sunucu: \`${BASE}\` · A: **${companyA?.name}** (\`${FIRMA_A}\`) · B: **${companyB?.name}** (\`${FIRMA_B}\`)`)
  md.push(`Uç: ${routes.length} · API sondası: ${probes.length} · sayfa sondası: ${pageResults.length} · süre: ${Math.round((Date.now() - started) / 1000)} sn`)
  md.push(``, `Üretim: \`node scripts/uctan-uca/tarama.mjs\` (ayrıntı: scripts/uctan-uca/sonuc.json)`)
  md.push(``, `## Özet`, ``, `| Önem | Adet |`, `|---|---|`)
  for (const [k, v] of Object.entries(counts)) md.push(`| ${k} | ${v} |`)
  md.push(``, `Türe göre: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  md.push(``, `## Bulgular`, ``)
  for (const sev of Object.keys(order)) {
    const list = findings.filter((f) => f.severity === sev)
    if (!list.length) continue
    md.push(`### ${sev} (${list.length})`, ``)
    for (const f of list) md.push(`- **${f.kind}** \`${f.where}\` — ${f.detail}${f.status != null ? ` _(${f.identity ?? ""} ${f.status}, ${f.ms} ms)_` : ""}`)
    md.push(``)
  }
  md.push(`## Kapsanmayan (${uncovered.length})`, ``)
  for (const u of uncovered) md.push(`- \`${u.path}\` ${u.methods.join(",")} — ${u.reason}`)
  md.push(``, `## En yavaş 25 (adminA, olumlu)`, ``, `| ms | bayt | uç |`, `|---|---|---|`)
  for (const p of slowest) md.push(`| ${p.ms} | ${p.bytes} | ${p.method} ${p.route} |`)
  md.push(``, `## En büyük 15 yanıt`, ``, `| bayt | ms | uç |`, `|---|---|---|`)
  for (const p of biggest) md.push(`| ${p.bytes} | ${p.ms} | ${p.method} ${p.route} |`)
  md.push(``, `## Satır sayısı farkı (A)`, ``)
  md.push(diffs.length ? diffs.map((d) => `- ${d.table}: ${d.before} → ${d.after}${d.log ? " (kayıt tablosu)" : " **VERİ DEĞİŞTİ**"}`).join("\n") : `Fark yok.`)
  const outMd = path.join(ROOT, "docs", "denetim", "UCTAN-UCA-TARAMA-SONUC.md")
  fs.writeFileSync(outMd, md.join("\n") + "\n")

  log(`\nBulgu: ${JSON.stringify(counts)}`)
  log(`Rapor: ${path.relative(ROOT, outMd)}  Ayrıntı: ${path.relative(ROOT, outJson)}`)
  for (const f of findings.filter((f) => f.severity === "kritik" || f.severity === "yuksek")) log(`  [${f.severity}] ${f.kind} ${f.where} — ${f.detail}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    // Tarama yarıda kalsa da viewer hesabı kalmasın.
    try {
      await deleteScanCompanies(new Date(started)).catch(() => {})
      const u = await prisma.user.findUnique({ where: { email: VIEWER_EMAIL } })
      if (u) {
        await prisma.userCompany.deleteMany({ where: { userId: u.id } })
        await prisma.user.delete({ where: { id: u.id } })
      }
    } catch {}
    await prisma.$disconnect()
    // Havuzdaki işçiler hata sonrası da koşmaya devam eder (Promise.all ilk hatada
    // döner, döngüler durmaz) — süreç açıkça kapatılmazsa "bitti" görünen tarama
    // arka planda saatlerce istek atar.
    process.exit(process.exitCode ?? 0)
  })
