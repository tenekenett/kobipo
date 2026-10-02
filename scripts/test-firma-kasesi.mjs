/**
 * FİRMA KAŞESİ — uçtan uca. Kural: CLAUDE.md "Makbuz kaşesi: iki kaynak, seçim tek yerde".
 *
 * Çalıştırma:
 *   1) Migrasyon uygulanmış olmalı: 20261002000001_company_stamps.sql
 *   2) npm run dev            (ayrı terminalde)
 *   3) TEST_BASE_URL=http://localhost:3000 node scripts/test-firma-kasesi.mjs
 *      KASE_PDF_DIR=<klasör> verilirse kaşeli makbuz PDF'leri oraya yazılır (gözle bakmak için).
 *
 * Reypo Medya (test firması) ve şubesi "test farklı polatlı" üzerinde çalışır: ayar kaşesi
 * yükler, şablondan alır, boyutu değiştirir, kaldırır; her adımda makbuz PDF'indeki gömülü
 * görselin ölçüsünü okur. İki firmada da başta ayar kaşesi VARSA çalışmaz (gerçek kaşeyi
 * ezmesin). Açtığı her şey (ayar kaşeleri, geçici virman fişi) sonda silinir.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"
import sharp from "sharp"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const PDF_DIR = process.env.KASE_PDF_DIR || null
const R = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı
const S = "cmtyhp55k000ovhzrpte5ctxu" // şubesi: test farklı polatlı (kendi şablonu yok)
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

async function tokenFor(companyId, role) {
  const m = await prisma.userCompany.findFirst({
    where: { companyId, role },
    select: { userId: true, user: { select: { email: true } } },
  })
  if (!m) return null
  const token = await encode({
    token: {
      id: m.userId,
      email: m.user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
      defaultCompanyId: companyId,
      defaultRole: role,
    },
    secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
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
    const buf = Buffer.from(await res.arrayBuffer())
    let json = null
    if ((res.headers.get("content-type") || "").includes("json")) {
      try {
        json = JSON.parse(buf.toString("utf8"))
      } catch {}
    }
    return { status: res.status, body: json, buf }
  }
}

/** PDF'e gömülü görsellerin ölçüleri (pdfkit sözlükleri düz metindir; SMask de görseldir). */
function pdfImages(buf) {
  const s = buf.toString("latin1")
  const out = []
  const re = /\/Subtype \/Image[\s\S]{0,200}?\/Width (\d+)[\s\S]{0,40}?\/Height (\d+)/g
  let m
  while ((m = re.exec(s))) out.push(`${m[1]}x${m[2]}`)
  return out
}

async function dims(dataUri) {
  const meta = await sharp(Buffer.from(dataUri.split(",")[1], "base64")).metadata()
  return { w: meta.width, h: meta.height, format: meta.format }
}

/** Saydam zeminde 260×130'luk "TEST KAŞESİ" — kenarında 170/135 px boşluk var, kırpılmalı. */
async function testStampPng() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
    <rect x="170" y="135" width="260" height="130" rx="14" fill="none" stroke="#1d3fbf" stroke-width="8"/>
    <text x="300" y="215" font-family="Arial" font-size="34" font-weight="bold" fill="#1d3fbf" text-anchor="middle">TEST KAŞESİ</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function main() {
  const existing = await prisma.companyStamp.findMany({ where: { companyId: { in: [R, S] } }, select: { companyId: true } })
  if (existing.length) throw new Error(`Ayar kaşesi zaten var (${existing.map((e) => e.companyId)}); gerçek kaşeyi ezmemek için durdu.`)

  const admin = client(await tokenFor(R, "ADMIN"))
  const created = { virmanId: null }
  const savePdf = (name, buf) => {
    if (!PDF_DIR) return
    mkdirSync(PDF_DIR, { recursive: true })
    writeFileSync(join(PDF_DIR, name), buf)
  }

  const tahsilat = await prisma.transaction.findFirst({ where: { companyId: R, customerId: { not: null } }, select: { id: true }, orderBy: { date: "desc" } })
  const odeme = await prisma.transaction.findFirst({ where: { companyId: R, supplierId: { not: null } }, select: { id: true }, orderBy: { date: "desc" } })
  const cek = await prisma.check.findFirst({ where: { companyId: R }, select: { id: true } })

  try {
    console.log("\n1) Başlangıç: ayarlarda kaşe yok, makbuz şablon kaşesini basıyor")
    let r = await admin("GET", `/api/firma-kasesi?companyId=${R}`)
    check("GET 200", r.status === 200, `${r.status}`)
    check("ayar kaşesi yok", r.body?.stamp === null)
    check("şablon kaşeleri listelendi (tekil)", r.body?.templateStamps?.length >= 1, `${r.body?.templateStamps?.length} kaşe`)
    check("makbuzda şablon kaşesi", r.body?.effective?.kind === "template" && !r.body.effective.fromParent, JSON.stringify(r.body?.effective))
    const templateStamps = r.body?.templateStamps ?? []

    r = await admin("GET", `/api/firma-kasesi?companyId=${S}`)
    check("şube: ana firmanın şablon kaşesi", r.body?.effective?.kind === "template" && r.body.effective.fromParent === true, JSON.stringify(r.body?.effective))

    const before = await admin("GET", `/api/finans/transactions/${tahsilat.id}/makbuz`)
    const beforeImgs = pdfImages(before.buf)
    check("tahsilat makbuzu (önce) görsel içeriyor", before.status === 200 && beforeImgs.length > 0, beforeImgs.join(", "))

    console.log("\n2) Bilgisayardan yükleme")
    const png = await testStampPng()
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, dataUri: `data:image/png;base64,${png.toString("base64")}`, widthMm: 40 })
    check("PUT yükleme 200", r.status === 200, `${r.status} ${r.body?.error ?? ""}`)
    const up = await dims(r.body.stamp.dataUri)
    check("PNG'ye çevrildi", up.format === "png")
    check("kenar boşluğu kırpıldı (600×400 → ~268×138)", up.w < 300 && up.h < 160 && up.w > 250, `${up.w}x${up.h}`)
    check("genişlik 40 mm", r.body.stamp.widthMm === 40)
    check("makbuzda ayar kaşesi", r.body.effective?.kind === "settings" && !r.body.effective.fromParent)

    r = await admin("GET", `/api/firma-kasesi?companyId=${S}`)
    check("şube: ana firmanın AYAR kaşesine geçti", r.body?.effective?.kind === "settings" && r.body.effective.fromParent === true, JSON.stringify(r.body?.effective))

    console.log("\n3) Basım genişliği")
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, widthMm: 999 })
    check("999 → 60'a çekildi", r.status === 200 && r.body.stamp.widthMm === 60, `${r.body?.stamp?.widthMm}`)
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, widthMm: 55 })
    check("55 mm kaydedildi", r.body?.stamp?.widthMm === 55)

    console.log("\n4) Makbuzlar ayar kaşesini basıyor")
    const want = `${up.w}x${up.h}`
    for (const [name, path] of [
      ["tahsilat", `/api/finans/transactions/${tahsilat.id}/makbuz`],
      ["odeme", odeme && `/api/finans/transactions/${odeme.id}/makbuz`],
      ["cek", cek && `/api/cek-senet/${cek.id}/makbuz?type=CHECK`],
    ]) {
      if (!path) {
        console.log(`  – ${name}: kayıt yok, atlandı`)
        continue
      }
      const pdf = await admin("GET", path)
      const imgs = pdfImages(pdf.buf)
      check(`${name} makbuzunda yüklenen kaşe (${want})`, pdf.status === 200 && imgs.includes(want), imgs.join(", "))
      savePdf(`${name}.pdf`, pdf.buf)
    }

    // Virman: firmada fiş yok — geçici bir fiş açılır, makbuzu alınır, silinir.
    const customers = await prisma.customer.findMany({ where: { companyId: R, archivedAt: null }, select: { id: true }, take: 2 })
    if (customers.length === 2) {
      r = await admin("POST", "/api/cari/virman", {
        companyId: R,
        party: { kind: "customer", id: customers[0].id },
        side: "CREDIT",
        counterparty: { kind: "customer", id: customers[1].id },
        amount: 1,
        description: "TEST firma kaşesi — silinecek",
      })
      check("geçici virman açıldı", r.status === 201, `${r.status} ${r.body?.error ?? ""}`)
      created.virmanId = r.body?.id ?? null
      if (created.virmanId) {
        const pdf = await admin("GET", `/api/cari/virman/${created.virmanId}/makbuz`)
        const imgs = pdfImages(pdf.buf)
        check(`virman makbuzunda yüklenen kaşe (${want})`, pdf.status === 200 && imgs.includes(want), imgs.join(", "))
        savePdf("virman.pdf", pdf.buf)
      }
    } else {
      console.log("  – virman: iki müşteri yok, atlandı")
    }

    console.log("\n5) Şablondan al")
    const own = templateStamps.find((t) => !t.fromParent)
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, templateId: own.templateId, widthMm: 40 })
    check("PUT şablondan 200", r.status === 200, `${r.status} ${r.body?.error ?? ""}`)
    const fromTpl = await dims(r.body.stamp.dataUri)
    check("kaşe değişti (şablonun görseli)", `${fromTpl.w}x${fromTpl.h}` !== want, `${fromTpl.w}x${fromTpl.h} · ${own.xsltName}`)
    check("makbuzda ayar kaşesi", r.body.effective?.kind === "settings")

    const foreign = await prisma.$queryRaw`
      SELECT id FROM einvoice_templates
      WHERE "companyId" NOT IN (${R}, ${S}) AND COALESCE(options->>'stampDataUri', '') <> '' LIMIT 1`
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, templateId: foreign[0].id })
    check("BAŞKA firmanın şablonu reddedildi", r.status === 400 && r.body?.error === "Şablon bulunamadı.", `${r.status} ${r.body?.error}`)
    const hidden = await prisma.eInvoiceTemplate.findFirst({ where: { companyId: R, hidden: true }, select: { id: true } })
    if (hidden) {
      r = await admin("PUT", "/api/firma-kasesi", { companyId: R, templateId: hidden.id })
      check("gizlenmiş şablon reddedildi", r.status === 400, `${r.status} ${r.body?.error}`)
    }

    console.log("\n6) Geçersiz girdi")
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64")
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, dataUri: `data:image/png;base64,${svg}` })
    check("PNG diye gönderilen SVG reddedildi", r.status === 400, `${r.status} ${r.body?.error}`)
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, dataUri: "data:image/png;base64,QUJD" })
    check("bozuk görsel reddedildi", r.status === 400, `${r.status} ${r.body?.error}`)
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, dataUri: "x".repeat(4_000_001) })
    check("4 MB üstü reddedildi", r.status === 400, `${r.status} ${r.body?.error}`)
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R })
    check("boş gövde reddedildi", r.status === 400, `${r.status} ${r.body?.error}`)

    console.log("\n7) Yetki")
    const custom = await tokenFor(R, "CUSTOM")
    if (custom) {
      const c = client(custom)
      r = await c("PUT", "/api/firma-kasesi", { companyId: R, widthMm: 30 })
      check("özel rollü üye yazamaz", r.status === 403, `${r.status} ${r.body?.error}`)
      r = await c("DELETE", `/api/firma-kasesi?companyId=${R}`)
      check("özel rollü üye silemez", r.status === 403, `${r.status} ${r.body?.error}`)
    }
    const other = await prisma.company.findFirst({
      where: { id: { notIn: [R, S] }, users: { none: { user: { companies: { some: { companyId: R, role: "ADMIN" } } } } } },
      select: { id: true },
    })
    r = await admin("GET", `/api/firma-kasesi?companyId=${other.id}`)
    check("üyesi olmadığı firmanın kaşesi okunamaz", r.status === 403, `${r.status}`)
    r = await admin("PUT", "/api/firma-kasesi", { companyId: other.id, widthMm: 30 })
    check("üyesi olmadığı firmaya yazamaz", r.status === 403, `${r.status}`)

    console.log("\n8) Şubenin kendi kaşesi")
    r = await admin("PUT", "/api/firma-kasesi", { companyId: S, dataUri: `data:image/png;base64,${png.toString("base64")}` })
    check("şubeye yüklendi", r.status === 200, `${r.status} ${r.body?.error ?? ""}`)
    check("şubede kendi kaşesi", r.body?.effective?.kind === "settings" && !r.body.effective.fromParent)
    check("şube listesinde ana firmanın şablon kaşeleri var", r.body?.templateStamps?.every((t) => t.fromParent))
    r = await admin("DELETE", `/api/firma-kasesi?companyId=${S}`)
    check("şube kaşesi kaldırıldı → ana firmanın ayar kaşesi", r.body?.stamp === null && r.body?.effective?.fromParent === true, JSON.stringify(r.body?.effective))

    console.log("\n9) Kaldır")
    r = await admin("DELETE", `/api/firma-kasesi?companyId=${R}`)
    check("DELETE 200, kaşe yok", r.status === 200 && r.body?.stamp === null)
    check("makbuz şablon kaşesine döndü", r.body?.effective?.kind === "template")
    r = await admin("PUT", "/api/firma-kasesi", { companyId: R, widthMm: 50 })
    check("kaşe yokken yalnız genişlik 400", r.status === 400, `${r.status} ${r.body?.error}`)
    const after = await admin("GET", `/api/finans/transactions/${tahsilat.id}/makbuz`)
    const afterImgs = pdfImages(after.buf)
    check("tahsilat makbuzu yine şablon kaşesini basıyor", afterImgs.join() === beforeImgs.join(), afterImgs.join(", "))
  } finally {
    if (created.virmanId) {
      const r = await admin("DELETE", `/api/cari/virman/${created.virmanId}`)
      console.log(`\n  temizlik: geçici virman silindi (${r.status})`)
    }
    const left = await prisma.companyStamp.deleteMany({ where: { companyId: { in: [R, S] } } })
    if (left.count) console.log(`  temizlik: ${left.count} ayar kaşesi silindi`)
  }

  console.log(`\n${pass} geçti, ${fail} kaldı${fail ? `: ${failures.join(" | ")}` : ""}`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
