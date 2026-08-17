/**
 * Satır açıklamasının (QuoteItem.note → InvoiceItem.note) uçtan uca testi.
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-teklif-satir-aciklamasi.mjs
 *
 * GERÇEK uçlara GERÇEK HTTP ile gider (mock yok). Oturum, NextAuth'un kendi
 * `encode`'uyla üretilen JWT çerezidir — giriş ekranına gerek kalmaz.
 *
 * Kalemler ÜRÜNSÜZ (serbest açıklama) girilir: faturaya dönüşüm stok hareketi
 * üretmez, test hiçbir ürünün stoğunu oynatmaz. Oluşturulan teklif + fatura
 * sonunda SİLİNİR.
 *
 * Kapsanan zincir:
 *   teklif POST/GET/PUT → teklif PDF → faturaya dönüştür → fatura kalemi
 *   → fatura önizleme PDF (GİB düzeni) → fatura PDF → editör önizleme PDF
 * Mysoft payload'ı (invoiceDetail.note) ayrı birim testte:
 *   lib/integrations/e-invoice/outgoing-line-note.test.ts
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
// Opsiyonel: üretilen PDF'leri buraya yaz (göz kontrolü için).
const SAVE_DIR = process.env.SAVE_PDF_DIR || ""
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

const NOTE_1 = "3 metre bakır boru + montaj işçiliği dahil"
const NOTE_1_UPDATED = "5 metre bakır boru dahil (revize)"
const NOTE_2 = "Teslim: 10 iş günü, adrese kadar"

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET bulunamadı (.env / .env.local)")

  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı (scripts/seed-multi-branch-demo.mjs)")

  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, role: true, user: { select: { email: true, isSuperAdmin: true } } },
  })
  if (!membership) throw new Error("Demo Firma'da ADMIN kullanıcı yok")

  const customer = await prisma.customer.findFirst({
    where: { companyId: company.id },
    select: { id: true, name: true },
  })
  if (!customer) throw new Error("Demo Firma'da müşteri yok (satış faturası için gerekli)")

  console.log(`Firma    : ${company.name} (${company.id})`)
  console.log(`Kullanıcı: ${membership.user.email} (${membership.role})`)
  console.log(`Müşteri  : ${customer.name}`)
  console.log(`Sunucu   : ${BASE}\n`)

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

  // PDF uçları: byte uzunluğu + %PDF imzası. SAVE_PDF_DIR verilirse üretilen PDF
  // diske de yazılır (göz kontrolü için) — testin sonucunu etkilemez.
  const pdf = async (method, path, body, saveAs) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const buf = Buffer.from(await res.arrayBuffer())
    if (SAVE_DIR && saveAs && buf.subarray(0, 4).toString() === "%PDF") {
      await writeFile(join(SAVE_DIR, saveAs), buf)
    }
    return { status: res.status, size: buf.length, isPdf: buf.subarray(0, 4).toString() === "%PDF" }
  }

  const ping = await api("GET", `/api/teklif?companyId=${company.id}&party=customer`)
  if (ping.status === 401) throw new Error("Oturum çerezi kabul edilmedi (NEXTAUTH_SECRET uyuşmuyor)")
  if (ping.status >= 500 || ping.body?.raw) {
    throw new Error(`Sunucuya ulaşılamadı (${ping.status}). 'npm run dev' çalışıyor mu?`)
  }

  let quoteId = null
  let invoiceId = null

  try {
    // ── 1. Teklif oluştur ───────────────────────────────────────────────────
    console.log("1) Teklif oluşturma (1. satır açıklamalı, 2. satır açıklamasız)")
    const created = await api("POST", "/api/teklif", {
      companyId: company.id,
      customerId: customer.id,
      currency: "TRY",
      date: new Date().toISOString().split("T")[0],
      notes: "TEST satır açıklaması",
      items: [
        { description: "TEST Klima montaj hizmeti", note: NOTE_1, quantity: 1, unitPrice: 1000, vatRate: 20 },
        { description: "TEST Filtre", quantity: 2, unitPrice: 50, vatRate: 20 },
      ],
    })
    check("teklif oluştu", created.status === 201, created.body?.quoteNo)
    quoteId = created.body?.id
    if (!quoteId) throw new Error("teklif id alınamadı: " + JSON.stringify(created.body).slice(0, 300))

    const c1 = created.body.items?.find((i) => i.description === "TEST Klima montaj hizmeti")
    const c2 = created.body.items?.find((i) => i.description === "TEST Filtre")
    check("POST yanıtında açıklama kayıtlı", c1?.note === NOTE_1, JSON.stringify(c1?.note))
    check("açıklamasız satırda note = null", c2?.note === null, JSON.stringify(c2?.note))
    check(
      "açıklama ürün adına KARIŞMADI",
      c1?.description === "TEST Klima montaj hizmeti" && !String(c1?.description).includes("bakır"),
      c1?.description,
    )

    // ── 2. GET ile okuma ────────────────────────────────────────────────────
    console.log("\n2) Teklif okuma (GET)")
    const fetched = await api("GET", `/api/teklif/${quoteId}?companyId=${company.id}`)
    const f1 = fetched.body.items?.[0]
    check("GET açıklamayı döndürüyor", fetched.status === 200 && f1?.note === NOTE_1, f1?.note)
    check("kalem sırası korunuyor", fetched.body.items?.[1]?.description === "TEST Filtre")

    // ── 3. PDF (açıklamalı vs açıklamasız byte farkı) ───────────────────────
    console.log("\n3) Teklif PDF'i")
    const pdfWith = await pdf("GET", `/api/teklif/${quoteId}/pdf?companyId=${company.id}`, null, "1-teklif-aciklamali.pdf")
    check("PDF üretildi", pdfWith.status === 200 && pdfWith.isPdf, `${pdfWith.size} bayt`)

    // Açıklamaları geçici olarak boşalt → PDF küçülmeli (metin gerçekten basılıyor).
    await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      items: [
        { description: "TEST Klima montaj hizmeti", quantity: 1, unitPrice: 1000, vatRate: 20 },
        { description: "TEST Filtre", quantity: 2, unitPrice: 50, vatRate: 20 },
      ],
    })
    const pdfWithout = await pdf("GET", `/api/teklif/${quoteId}/pdf?companyId=${company.id}`, null, "2-teklif-aciklamasiz.pdf")
    check(
      "açıklama PDF içeriğine giriyor (boşken PDF küçülüyor)",
      pdfWithout.status === 200 && pdfWithout.size < pdfWith.size,
      `${pdfWith.size} → ${pdfWithout.size} bayt`,
    )

    // ── 4. PUT ile güncelleme ───────────────────────────────────────────────
    console.log("\n4) Teklif güncelleme (PUT) — 1. satır revize, 2. satıra açıklama eklendi")
    const updated = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      items: [
        { description: "TEST Klima montaj hizmeti", note: NOTE_1_UPDATED, quantity: 1, unitPrice: 1000, vatRate: 20 },
        { description: "TEST Filtre", note: NOTE_2, quantity: 2, unitPrice: 50, vatRate: 20 },
      ],
    })
    const u1 = updated.body.items?.[0]
    const u2 = updated.body.items?.[1]
    check("1. satır açıklaması güncellendi", u1?.note === NOTE_1_UPDATED, u1?.note)
    check("2. satıra açıklama eklendi", u2?.note === NOTE_2, u2?.note)

    // Yalnız boşluk → null olmalı (kirli veri yazılmasın).
    const blank = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      items: [
        { description: "TEST Klima montaj hizmeti", note: "   ", quantity: 1, unitPrice: 1000, vatRate: 20 },
        { description: "TEST Filtre", note: NOTE_2, quantity: 2, unitPrice: 50, vatRate: 20 },
      ],
    })
    check("yalnız boşluk açıklaması null'a normalize edildi", blank.body.items?.[0]?.note === null)

    // Son durum: iki satır da açıklamalı (dönüşüm bunu taşıyacak).
    await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      items: [
        { description: "TEST Klima montaj hizmeti", note: NOTE_1_UPDATED, quantity: 1, unitPrice: 1000, vatRate: 20 },
        { description: "TEST Filtre", note: NOTE_2, quantity: 2, unitPrice: 50, vatRate: 20 },
      ],
    })

    // ── 5. Faturaya dönüştür ────────────────────────────────────────────────
    console.log("\n5) Faturaya dönüştürme")
    const conv = await api("POST", `/api/teklif/${quoteId}/faturaya-donustur`)
    check("fatura oluştu", conv.status === 201, conv.body?.invoiceNo)
    invoiceId = conv.body?.id
    if (!invoiceId) throw new Error("fatura id alınamadı: " + JSON.stringify(conv.body).slice(0, 300))

    const inv = await api("GET", `/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`)
    const i1 = inv.body.items?.find((i) => i.description === "TEST Klima montaj hizmeti")
    const i2 = inv.body.items?.find((i) => i.description === "TEST Filtre")
    check("1. kalem açıklaması faturaya taşındı", i1?.note === NOTE_1_UPDATED, i1?.note)
    check("2. kalem açıklaması faturaya taşındı", i2?.note === NOTE_2, i2?.note)
    check(
      "fatura kalem adı temiz (açıklama eklenmemiş)",
      i1?.description === "TEST Klima montaj hizmeti",
      i1?.description,
    )
    check("teklif CONVERTED oldu", (await api("GET", `/api/teklif/${quoteId}?companyId=${company.id}`)).body?.status === "CONVERTED")

    // ── 5b. Fatura DÜZENLEME (editörün PUT'u kalemleri silip yeniden kurar) ─
    // Kritik regresyon: PUT note'u geri yazmazsa tekliften taşınan açıklama
    // faturayı bir kez düzenlemekle sessizce KAYBOLUR.
    console.log("\n5b) Fatura düzenleme — açıklama PUT'tan sağ çıkıyor mu?")
    const editorItems = (withNoteOnFirst) =>
      inv.body.items.map((it) => ({
        productId: it.productId || undefined,
        description: it.description,
        ...(withNoteOnFirst || it.description !== "TEST Klima montaj hizmeti"
          ? { note: it.note || undefined }
          : {}),
        unit: it.unit || "ADET",
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
      }))
    const putBase = {
      companyId: company.id,
      customerId: customer.id,
      date: new Date(inv.body.date).toISOString().split("T")[0],
      invoiceNo: inv.body.invoiceNo,
      notes: inv.body.notes || "",
    }
    const kept = await api("PUT", `/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`, {
      ...putBase,
      items: editorItems(true),
    })
    const k1 = kept.body.items?.find((i) => i.description === "TEST Klima montaj hizmeti")
    check("düzenleme sonrası açıklama korundu", kept.status === 200 && k1?.note === NOTE_1_UPDATED, k1?.note)

    const cleared = await api("PUT", `/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`, {
      ...putBase,
      items: editorItems(false),
    })
    const cl1 = cleared.body.items?.find((i) => i.description === "TEST Klima montaj hizmeti")
    const cl2 = cleared.body.items?.find((i) => i.description === "TEST Filtre")
    check("açıklama kaldırılabiliyor (eklenti silinince null)", cl1?.note === null, JSON.stringify(cl1?.note))
    check("diğer satırın açıklaması etkilenmedi", cl2?.note === NOTE_2, cl2?.note)

    // Geri yaz (PDF adımları açıklamalı fatura görsün).
    await api("PUT", `/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`, {
      ...putBase,
      items: editorItems(true),
    })

    // ── 6. Fatura PDF'leri ──────────────────────────────────────────────────
    console.log("\n6) Fatura PDF'leri")
    const gibPdf = await pdf("GET", `/api/e-donusum/invoices/${invoiceId}/preview-pdf?companyId=${company.id}`, null, "3-fatura-gib-duzeni.pdf")
    check("GİB düzeni önizleme PDF'i üretildi", gibPdf.status === 200 && gibPdf.isPdf, `${gibPdf.size} bayt`)
    const classicPdf = await pdf("GET", `/api/faturalar/${invoiceId}/pdf?companyId=${company.id}`, null, "4-fatura-klasik.pdf")
    check("klasik fatura PDF'i üretildi", classicPdf.status === 200 && classicPdf.isPdf, `${classicPdf.size} bayt`)

    // ── 7. Editör (kaydedilmemiş) önizleme PDF'i — açıklamalı/açıklamasız fark
    console.log("\n7) Editör önizleme PDF'i (kaydedilmemiş kalemler)")
    const previewBody = (withNote) => ({
      companyId: company.id,
      type: "SALES",
      invoiceType: "MANUAL",
      invoiceNo: "TEST-ONIZLEME",
      customerId: customer.id,
      date: new Date().toISOString().split("T")[0],
      items: [
        {
          description: "TEST Klima montaj hizmeti",
          ...(withNote ? { note: NOTE_1_UPDATED } : {}),
          unit: "ADET",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 20,
        },
      ],
    })
    const prevWith = await pdf("POST", "/api/e-donusum/invoices/preview-pdf", previewBody(true), "5-editor-onizleme-aciklamali.pdf")
    const prevWithout = await pdf("POST", "/api/e-donusum/invoices/preview-pdf", previewBody(false), "6-editor-onizleme-aciklamasiz.pdf")
    check("önizleme PDF'i üretildi", prevWith.status === 200 && prevWith.isPdf, `${prevWith.size} bayt`)
    check(
      "açıklama önizleme PDF içeriğine giriyor",
      prevWithout.status === 200 && prevWith.size > prevWithout.size,
      `açıklamalı ${prevWith.size} > açıklamasız ${prevWithout.size} bayt`,
    )
  } finally {
    // ── Temizlik ────────────────────────────────────────────────────────────
    console.log("\n8) Temizlik")
    if (invoiceId) {
      const del = await fetch(`${BASE}/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`, {
        method: "DELETE",
        headers: { cookie },
      })
      check("test faturası silindi", del.ok, `HTTP ${del.status}`)
    }
    if (quoteId) {
      const del = await fetch(`${BASE}/api/teklif/${quoteId}?companyId=${company.id}`, {
        method: "DELETE",
        headers: { cookie },
      })
      check("test teklifi silindi", del.ok, `HTTP ${del.status}`)
    }
    const leftoverQuotes = await prisma.quote.count({
      where: { companyId: company.id, notes: "TEST satır açıklaması" },
    })
    const leftoverItems = await prisma.invoiceItem.count({
      where: { description: { startsWith: "TEST Klima montaj" } },
    })
    console.log(`  · kalan test teklifi: ${leftoverQuotes} · kalan test fatura kalemi: ${leftoverItems}`)
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
