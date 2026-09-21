#!/usr/bin/env node
// Menü tarama UÇLARININ uçtan uca sınaması — dev sunucu açıkken (npm run dev).
//
//   node scripts/test-menu-tarama.mjs --dir ./menu-ornekleri [--firma reypo] [--kaydet] [--geri-al]
//
// Ekranın yaptığı akışı aynen yürütür: dosyaları AYNI oturuma POST eder →
// oturum GET (fark listesi) → (--kaydet) YENİ satırları /api/stok/products +
// /api/restoran/urun-secenekleri ile yazar, hedef izini işler, oturumu tamamlar →
// (--geri-al) geri alma ucunu çağırır ve ürünlerin silindiğini DB'den doğrular.
//
// PARA HARCAR (model çağrısı) ve --kaydet ile firmaya GERÇEK ürün yazar; --geri-al
// ile temizlenir. Oturum, firmanın ADMIN üyesi adına next-auth JWT ile açılır
// (scripts/test-fatura-kurus.mjs deseni) — NEXTAUTH_SECRET .env.local'den.

import "dotenv/config"
import { config as loadEnv } from "dotenv"
import fs from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: false })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const prisma = new PrismaClient()

function argv(ad, varsayilan = null) {
  const i = process.argv.indexOf("--" + ad)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : varsayilan
}
const bayrak = (ad) => process.argv.includes("--" + ad)

const dizin = argv("dir", "./menu-ornekleri")
const firmaSlug = argv("firma", "reypo")
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" }

const ok = (kosul, mesaj) => {
  console.log(`${kosul ? "  ✓" : "  ✗"} ${mesaj}`)
  if (!kosul) process.exitCode = 1
}

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET bulunamadı (.env / .env.local)")

  const company = await prisma.company.findFirst({ where: { slug: firmaSlug }, select: { id: true, name: true, slug: true } })
  if (!company) throw new Error(`Firma bulunamadı: ${firmaSlug}`)
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, role: true, user: { select: { email: true, isSuperAdmin: true } } },
  })
  if (!membership) throw new Error("Firmada ADMIN üye yok")
  console.log(`Firma: ${company.name} (${company.slug}) · Kullanıcı: ${membership.user.email} · ${BASE}\n`)

  const token = await encode({
    token: { id: membership.userId, email: membership.user.email, isSuperAdmin: membership.user.isSuperAdmin || false, isBlogEditor: false, defaultCompanyId: company.id, defaultRole: membership.role },
    secret,
  })
  const cookie = `next-auth.session-token=${token}`
  const api = async (method, yol, govde, form) => {
    const res = await fetch(`${BASE}${yol}`, {
      method,
      headers: { cookie, ...(govde ? { "Content-Type": "application/json" } : {}) },
      body: form ?? (govde ? JSON.stringify(govde) : undefined),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 300) }
    }
    return { status: res.status, json }
  }

  // ---------------------------------------------------------------- 1. yükleme
  const dosyalar = fs.readdirSync(dizin).filter((f) => MIME[path.extname(f).toLowerCase()]).sort()
  if (dosyalar.length === 0) throw new Error(`Dizinde dosya yok: ${dizin}`)
  console.log(`1) Yükleme — ${dosyalar.length} dosya, tek oturum`)
  let sessionId = null
  for (const ad of dosyalar) {
    const fd = new FormData()
    fd.append("file", new Blob([fs.readFileSync(path.join(dizin, ad))], { type: MIME[path.extname(ad).toLowerCase()] }), ad)
    fd.append("companyId", company.id)
    fd.append("kdv", "10")
    fd.append("tamami", "1")
    fd.append("force", "1")
    if (sessionId) fd.append("sessionId", sessionId)
    const t0 = Date.now()
    const r = await api("POST", "/api/restoran/menu-tarama", null, fd)
    ok(r.status === 200, `${ad} → ${r.status} ${r.json?.error ?? ""} (${r.json?.kalem ?? "?"} kalem, ${r.json?.yol}, ${((Date.now() - t0) / 1000).toFixed(1)} sn, $${r.json?.costUsd ?? "?"})`)
    if (r.status !== 200) continue
    if (!sessionId) sessionId = r.json.sessionId
    ok(r.json.sessionId === sessionId, `oturum korundu: ${sessionId}`)
  }
  if (!sessionId) throw new Error("Hiç dosya okunamadı")

  // ---------------------------------------------------------------- 2. gelen kutusu
  console.log(`\n2) Gelen kutusu`)
  const kutu = await api("GET", `/api/restoran/menu-tarama?companyId=${company.id}`)
  const oturum = Array.isArray(kutu.json) ? kutu.json.find((o) => o.sessionId === sessionId) : null
  ok(Boolean(oturum), `oturum listede: ${oturum?.status} · ${oturum?.dosyalar.length} dosya · ${oturum?.kalem} kalem · tamMenu=${oturum?.tamMenu}`)
  const belgeKutu = await api("GET", `/api/alis/belge-tarama?companyId=${company.id}`)
  const sizinti = Array.isArray(belgeKutu.json) && belgeKutu.json.some((s) => dosyalar.includes(s.fileName) && Date.now() - new Date(s.createdAt).getTime() < 5 * 60 * 1000)
  ok(!sizinti, "menü satırları ALIŞ gelen kutusunda görünmüyor (kind süzgeci)")

  // ---------------------------------------------------------------- 3. fark listesi
  console.log(`\n3) Fark listesi`)
  const d = await api("GET", `/api/restoran/menu-tarama/oturum/${sessionId}?companyId=${company.id}`)
  ok(d.status === 200, `oturum GET ${d.status} ${d.json?.error ?? ""}`)
  const detay = d.json
  ok(detay.menuyeBenziyor === true, `menüye benziyor · ${detay.kalemler?.length} kalem · ${detay.bolumler?.length} bölüm`)
  console.log(`   kovalar: ${JSON.stringify(detay.kovalar)}`)
  for (const x of detay.denetimler ?? []) console.log(`   [${x.durum}] ${x.etiket}: ${x.aciklama}`)
  for (const f of detay.fark ?? []) {
    if (f.kova === "MENUDE_YOK") continue
    const fiy = f.kalem.fiyatlar.map((p) => (p.etiket ? `${p.etiket} ${p.fiyat}` : p.fiyat)).join("/")
    const ek = f.kova === "YENI" ? `%${f.oneri.kdvOrani} net ${f.oneri.net}${f.oneri.secenekGrubu ? ` [${f.oneri.secenekGrubu.ad}: ${f.oneri.secenekGrubu.secenekler.map((s) => s.ad + (s.priceDelta ? "+" + s.priceDelta : "")).join(", ")}]` : ""}` : f.kova === "FIYAT_DEGISMIS" ? `${f.eskiBrut} → ${f.yeniBrut} (%${f.kdvOrani}, net ${f.yeniNet})` : ""
    console.log(`   ${f.kova.padEnd(15)} ${f.kalem.ad.padEnd(28)} ${String(fiy).padEnd(26)} ${ek}`)
  }
  const menudeYok = (detay.fark ?? []).filter((f) => f.kova === "MENUDE_YOK")
  console.log(`   MENÜDE YOK: ${menudeYok.length} ürün (yalnız listelenir, yazılmaz)`)

  if (!bayrak("kaydet")) {
    console.log(`\n--kaydet verilmedi; yazma adımı atlandı. Oturum kutuda AWAITING_APPROVAL kaldı: ${sessionId}`)
    return
  }

  // ---------------------------------------------------------------- 4. kayıt (ekranın döngüsü)
  console.log(`\n4) Kayıt — YENİ + FİYAT DEĞİŞMİŞ satırları (menüde-yok DOKUNULMAZ)`)
  const hedef = (h) => api("PATCH", `/api/restoran/menu-tarama/oturum/${sessionId}`, { companyId: company.id, action: "hedef", ...h })
  let yazilan = 0
  for (const f of detay.fark) {
    if (f.kova === "YENI") {
      const u = await api("POST", "/api/stok/products", { companyId: company.id, name: f.kalem.ad, category: f.oneri.kategori, unit: "ADET", vatRate: f.oneri.kdvOrani, salePrice: f.oneri.brut, salePriceVatIncluded: true, isSellable: true })
      ok(u.status === 201, `ürün ${f.kalem.ad} → ${u.status} ${u.json?.error ?? ""} net=${u.json?.salePrice}`)
      if (u.status !== 201) continue
      // Uç net'e çevirdi mi? brüt / (1+oran) ≈ salePrice
      ok(Math.abs(Number(u.json.salePrice) - f.oneri.net) < 0.000002, `   net doğru (${u.json.salePrice} ≈ ${f.oneri.net})`)
      const h1 = await hedef({ anahtar: f.anahtar, type: "PRODUCT", id: u.json.id, no: u.json.name })
      ok(h1.status === 200, `   hedef PRODUCT ${h1.status}`)
      if (f.oneri.secenekGrubu) {
        const g = await api("POST", "/api/restoran/urun-secenekleri", { companyId: company.id, productId: u.json.id, name: f.oneri.secenekGrubu.ad, isRequired: true, options: f.oneri.secenekGrubu.secenekler.map((s) => ({ name: s.ad, priceDelta: s.priceDelta, isDefault: s.isDefault })) })
        ok(g.status === 201, `   seçenek grubu ${g.json?.name} → ${g.status} ${g.json?.error ?? ""} (${g.json?.options?.map((o) => `${o.name}:${o.priceDelta}`).join(", ")})`)
        if (g.status === 201) await hedef({ anahtar: f.anahtar, type: "OPTION_GROUP", id: g.json.id, no: u.json.name })
      }
      yazilan++
    } else if (f.kova === "FIYAT_DEGISMIS") {
      const p = await api("PATCH", `/api/stok/products/${f.urun.id}?companyId=${company.id}`, { salePrice: f.yeniBrut, salePriceVatIncluded: true })
      ok(p.status === 200, `fiyat ${f.kalem.ad} ${f.eskiBrut} → ${f.yeniBrut} → ${p.status} ${p.json?.error ?? ""} net=${p.json?.salePrice}`)
      if (p.status === 200) {
        ok(Math.abs(Number(p.json.salePrice) - f.yeniNet) < 0.000002, `   net doğru (${p.json.salePrice} ≈ ${f.yeniNet})`)
        await hedef({ anahtar: f.anahtar, type: "PRICE", id: f.urun.id, no: f.urun.name })
        yazilan++
      }
    }
  }
  const yazilanSatir = detay.fark.find((f) => f.kova === "YENI" || f.kova === "FIYAT_DEGISMIS")
  if (yazilanSatir) {
    const tekrar = await hedef({ anahtar: yazilanSatir.anahtar, type: yazilanSatir.kova === "YENI" ? "PRODUCT" : "PRICE", id: "yeniden" })
    ok(tekrar.status === 409, `aynı satır ikinci kez bağlanamıyor (${tekrar.status})`)
  }
  const tamam = await api("PATCH", `/api/restoran/menu-tarama/oturum/${sessionId}`, { companyId: company.id, action: "tamamla" })
  ok(tamam.status === 200 && tamam.json.status === "SAVED", `oturum tamamlandı → ${tamam.json?.status}`)

  // İkinci okuma: yazılanlar artık AYNI kovasına düşmeli (fark listesi o anki ürünlere karşı).
  const d2 = await api("GET", `/api/restoran/menu-tarama/oturum/${sessionId}?companyId=${company.id}`)
  console.log(`   yeniden kurulan kovalar: ${JSON.stringify(d2.json.kovalar)} · hedef izi: ${d2.json.hedefler.length}`)
  ok(d2.json.kovalar.YENI === 0 && d2.json.kovalar.FIYAT_DEGISMIS === 0, `${yazilan} satır yazıldı; fark listesinde YENİ/FİYAT kalmadı`)

  const yazilanUrunler = await prisma.product.findMany({ where: { companyId: company.id, id: { in: d2.json.hedefler.filter((h) => h.type === "PRODUCT").map((h) => h.id) } }, select: { id: true, name: true, salePrice: true, vatRate: true, salePriceVatIncluded: true, isSellable: true, category: true, _count: { select: { optionGroups: true } } } })
  console.log(`   DB: ${yazilanUrunler.length} ürün`)
  for (const u of yazilanUrunler) console.log(`     ${u.name.padEnd(28)} net ${String(u.salePrice).padEnd(12)} %${u.vatRate} dahil=${u.salePriceVatIncluded} sellable=${u.isSellable} kat=${u.category} grup=${u._count.optionGroups}`)

  if (!bayrak("geri-al")) {
    console.log(`\n--geri-al verilmedi; ürünler firmada KALDI. Temizlemek için --geri-al ile yeniden koşun ya da ekrandan "Bu taramayı geri al".`)
    return
  }

  // ---------------------------------------------------------------- 5. geri alma
  console.log(`\n5) Geri alma`)
  const g = await api("POST", `/api/restoran/menu-tarama/oturum/${sessionId}/geri-al`, { companyId: company.id })
  ok(g.status === 200, `geri-al ${g.status} ${JSON.stringify(g.json?.ozet)}`)
  const kalan = await prisma.product.count({ where: { id: { in: yazilanUrunler.map((u) => u.id) } } })
  ok(kalan === 0, `satılmamış ürünlerin hepsi silindi (kalan ${kalan})`)
  const g2 = await api("POST", `/api/restoran/menu-tarama/oturum/${sessionId}/geri-al`, { companyId: company.id })
  ok(g2.status === 200 && Object.values(g2.json.ozet).every((n) => n === 0), `ikinci geri-al hiçbir şeye dokunmadı`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
