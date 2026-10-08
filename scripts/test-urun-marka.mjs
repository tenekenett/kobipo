/**
 * ÜRÜN MARKASI — uçtan uca. Model: lib/stock/product-group.ts (kategoriyle aynı:
 * ürünün `brand` metni + CompanyDefinition type=PRODUCT_BRAND öneri listesi).
 *
 * Çalıştırma:
 *   1) Migrasyon uygulanmış olmalı: 20261008000001_product_brand.sql
 *   2) npm run dev            (ayrı terminalde)
 *   3) TEST_BASE_URL=http://localhost:3000 node scripts/test-urun-marka.mjs
 *
 * Reypo Medya (test firması) üzerinde çalışır: marka tanımı açar, iki ürüne yazar,
 * süzgeç / Türkçe duyarsız arama / kısmi PUT / toplu yeniden adlandırma / silme /
 * dışa aktarımı sınar. Açtığı her şey (tanımlar, ürünler) sonda silinir — test
 * yarıda patlasa da.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const R = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı
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
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: res.status, body: json, text }
  }
}

const ts = Date.now().toString(36).toUpperCase()
// Türkçe büyük harf: arama küçük harfle ("ışık") yapılacak — trFold sınaması.
const BRAND_A = `TEST IŞIK Marka ${ts}`
const BRAND_B = `TEST Yeni Marka ${ts}`
const CATEGORY = `TEST-KAT-${ts}`

async function main() {
  const api = client(await tokenFor(R, "ADMIN"))
  const created = { definitionIds: [], productIds: [] }

  try {
    console.log("\n1) Marka tanımı")
    let r = await api("POST", "/api/company/definitions", { companyId: R, type: "PRODUCT_BRAND", label: BRAND_A })
    check("PRODUCT_BRAND tanımı açılır", r.status === 201 && r.body?.type === "PRODUCT_BRAND", `${r.status}`)
    if (r.body?.id) created.definitionIds.push(r.body.id)

    r = await api("GET", `/api/company/definitions?companyId=${R}&type=PRODUCT_BRAND`)
    check("marka listesinde görünür", Array.isArray(r.body) && r.body.some((d) => d.label === BRAND_A))
    r = await api("GET", `/api/company/definitions?companyId=${R}&type=PRODUCT_CATEGORY`)
    check("kategori listesine KARIŞMAZ", Array.isArray(r.body) && !r.body.some((d) => d.label === BRAND_A))

    console.log("\n2) Ürüne marka yazma")
    r = await api("POST", "/api/stok/products", {
      companyId: R,
      name: `TEST Ürün A ${ts}`,
      category: CATEGORY,
      brand: `  ${BRAND_A}  `,
      unit: "ADET",
      vatRate: "20",
      salePrice: "100",
      stockQuantity: "0",
      isService: false,
    })
    check("ürün markayla açılır (kırpılmış)", r.status === 201 && r.body?.brand === BRAND_A, `${r.status} ${r.body?.brand}`)
    const p1 = r.body?.id
    if (p1) created.productIds.push(p1)

    r = await api("POST", "/api/stok/products", {
      companyId: R,
      name: `TEST Ürün B ${ts}`,
      category: CATEGORY,
      brand: "   ",
      unit: "ADET",
      vatRate: "20",
      stockQuantity: "0",
      isService: false,
    })
    check("boş marka NULL yazılır", r.status === 201 && r.body?.brand === null, `${r.status} ${JSON.stringify(r.body?.brand)}`)
    const p2 = r.body?.id
    if (p2) created.productIds.push(p2)

    console.log("\n3) Liste süzgeci ve arama")
    r = await api("GET", `/api/stok/products?companyId=${R}&brand=${encodeURIComponent(BRAND_A)}`)
    check(
      "brand süzgeci yalnız o markayı döndürür",
      Array.isArray(r.body) && r.body.length === 1 && r.body[0].id === p1,
      `${r.body?.length} kayıt`
    )
    const search = `test ışık marka ${ts.toLowerCase()}`
    r = await api("GET", `/api/stok/products?companyId=${R}&search=${encodeURIComponent(search)}`)
    check(
      "arama markayı Türkçe duyarsız bulur (ad markayı içermiyor)",
      Array.isArray(r.body) && r.body.some((p) => p.id === p1) && !r.body.some((p) => p.id === p2),
      `${r.body?.length} kayıt`
    )
    r = await api("GET", `/api/stok/products/${p1}?companyId=${R}`)
    check("ürün detayı markayı döndürür", r.body?.brand === BRAND_A, r.body?.brand)

    console.log("\n4) Kısmi PUT markayı silmez, boş gönderim siler")
    r = await api("PUT", `/api/stok/products/${p1}?companyId=${R}`, { companyId: R, name: `TEST Ürün A ${ts}`, salePrice: "120" })
    check("brand alanı GÖNDERİLMEYEN PUT markaya dokunmaz", r.status === 200 && r.body?.brand === BRAND_A, `${r.status} ${r.body?.brand}`)
    r = await api("PUT", `/api/stok/products/${p1}?companyId=${R}`, { companyId: R, brand: "" })
    check("brand:\"\" markayı boşaltır", r.status === 200 && r.body?.brand === null, `${r.status} ${JSON.stringify(r.body?.brand)}`)
    r = await api("PUT", `/api/stok/products/${p1}?companyId=${R}`, { companyId: R, brand: BRAND_A })
    check("markayı geri yazar", r.status === 200 && r.body?.brand === BRAND_A)
    check("kategori PUT'larda korunur", r.body?.category === CATEGORY, r.body?.category)

    console.log("\n5) Sayım ve toplu yeniden adlandırma (field=brand)")
    r = await api("GET", `/api/stok/products/category?companyId=${R}&field=brand`)
    const countA = Array.isArray(r.body) ? r.body.find((c) => c.category === BRAND_A)?.count : undefined
    check("marka sayımı 1", countA === 1, `${countA}`)
    r = await api("GET", `/api/stok/products/category?companyId=${R}`)
    check(
      "field'siz sayım kategori sayar (eski çağıran)",
      Array.isArray(r.body) && r.body.find((c) => c.category === CATEGORY)?.count === 2 && !r.body.some((c) => c.category === BRAND_A)
    )
    r = await api("GET", `/api/stok/products/category?companyId=${R}&field=name`)
    check("bilinmeyen field 400", r.status === 400, `${r.status}`)
    r = await api("PATCH", "/api/stok/products/category", { companyId: R, field: "name", from: "x", to: "y" })
    check("PATCH bilinmeyen field 400", r.status === 400, `${r.status}`)

    r = await api("PATCH", "/api/stok/products/category", { companyId: R, field: "brand", from: BRAND_A, to: BRAND_B })
    check("marka yeniden adlandırılır", r.status === 200 && r.body?.updated === 1, `${r.status} ${JSON.stringify(r.body)}`)
    const after = await prisma.product.findUnique({ where: { id: p1 }, select: { brand: true, category: true } })
    check("ürünün markası yeni ad, kategorisi aynı", after?.brand === BRAND_B && after?.category === CATEGORY, JSON.stringify(after))

    console.log("\n6) Dışa aktarım")
    r = await api("GET", `/api/export/products?companyId=${R}&format=csv&brand=${encodeURIComponent(BRAND_B)}`)
    check("CSV 200", r.status === 200, `${r.status}`)
    check("CSV'de Marka sütunu ve değeri", r.text.includes("Marka") && r.text.includes(BRAND_B))
    check("CSV marka süzgecine uyar", r.text.includes(`TEST Ürün A ${ts}`) && !r.text.includes(`TEST Ürün B ${ts}`))

    // "Markasız" rozeti — ekran, liste ucu ve dışa aktarım aynı sabiti tanır.
    const NONE = "__none__"
    r = await api("GET", `/api/stok/products?companyId=${R}&brand=${NONE}&search=${encodeURIComponent(ts)}`)
    check(
      "liste ucu: Markasız yalnız markası boş ürünü döndürür",
      Array.isArray(r.body) && r.body.length === 1 && r.body[0].id === p2,
      `${r.body?.length} kayıt`
    )
    r = await api("GET", `/api/export/products?companyId=${R}&format=csv&brand=${NONE}&search=${encodeURIComponent(ts)}`)
    check(
      "CSV: Markasız süzgeci",
      r.status === 200 && r.text.includes(`TEST Ürün B ${ts}`) && !r.text.includes(`TEST Ürün A ${ts}`),
      `${r.status}`
    )

    console.log("\n7) Marka silme ürünün markasını boşaltır")
    r = await api("PATCH", "/api/stok/products/category", { companyId: R, field: "brand", from: BRAND_B, to: null })
    check("toplu boşaltma", r.status === 200 && r.body?.updated === 1, `${r.status} ${JSON.stringify(r.body)}`)
    const cleared = await prisma.product.findUnique({ where: { id: p1 }, select: { brand: true, category: true } })
    check("marka NULL, kategori duruyor", cleared?.brand === null && cleared?.category === CATEGORY, JSON.stringify(cleared))

    console.log("\n8) Kategori ucu gerilemesi (field'siz)")
    r = await api("PATCH", "/api/stok/products/category", { companyId: R, from: CATEGORY, to: null })
    check("kategori toplu boşaltma hâlâ çalışır", r.status === 200 && r.body?.updated === 2, `${r.status} ${JSON.stringify(r.body)}`)
  } finally {
    console.log("\nTemizlik")
    for (const id of created.productIds) {
      const r = await api("DELETE", `/api/stok/products/${id}?companyId=${R}`)
      check(`ürün silindi ${id}`, r.status === 200, `${r.status}`)
    }
    for (const id of created.definitionIds) {
      const r = await api("DELETE", `/api/company/definitions/${id}`)
      check(`tanım silindi ${id}`, r.status === 200, `${r.status}`)
    }
    const leftovers = await prisma.product.count({ where: { companyId: R, name: { contains: ts } } })
    const leftoverDefs = await prisma.companyDefinition.count({ where: { companyId: R, label: { contains: ts } } })
    check("artık kalmadı", leftovers === 0 && leftoverDefs === 0, `${leftovers} ürün, ${leftoverDefs} tanım`)
  }

  console.log(`\n${pass} geçti, ${fail} kaldı${failures.length ? `: ${failures.join(" | ")}` : ""}`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
