/**
 * GELEN E-FATURA GİZLEME — uçtan uca. Kural: CLAUDE.md "Gelen e-fatura gizleme".
 *
 * Çalıştırma:
 *   1) Migrasyon uygulanmış olmalı: 20261010000001_gelen_fatura_gizleme.sql
 *   2) npm run dev            (ayrı terminalde; migrasyondan SONRA başlatılmış olmalı)
 *   3) TEST_BASE_URL=http://localhost:3000 npx tsx scripts/test-gelen-gizleme.ts
 *
 * Reypo Medya'nın (test firması) KABUL edilmiş, alışa aktarılmamış iki TL gelen
 * faturasını gizler, her yüzeyde (liste, özet, gizlenenler görünümü, detay, birleşik
 * fatura listesi, dışa aktarım, "işlenmemiş fatura" kartı, KDV kontrol listesi)
 * düştüğünü ölçer, sonra geri açar. Başta gizli olan faturaya dokunmaz; sonda iki
 * faturayı her durumda gizlenmemiş hâle getirir. Mysoft'a/GİB'e hiçbir şey gitmez.
 *
 * Ayrıca profil ucunun telefon standardını (geçersiz numara → 400, yazmadan) sınar.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { encode } from "next-auth/jwt"
import { prisma } from "@/lib/db/prisma"
import { islenmemisFaturaOzeti, GECIKME_GUN, PENCERE_GUN } from "@/lib/otomasyon/veri/islenmemis-fatura"
import { gunOnce } from "@/lib/asistan/veri/temel"
import { aktarilmamisGelenFaturalar } from "@/lib/raporlar/vergiler"
import { TR_PHONE_ERROR } from "@/lib/text/tr-phone"

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const R = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı

let pass = 0
let fail = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail?: unknown) {
  const d = detail === undefined ? "" : ` → ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
  if (ok) {
    pass++
    console.log(`  ✓ ${label}${d}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ✗ ${label}${d}`)
  }
}

async function adminCookie() {
  const m = await prisma.userCompany.findFirst({
    where: { companyId: R, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true, name: true } } },
  })
  if (!m) throw new Error("Reypo'da ADMIN üye yok")
  const token = await encode({
    token: {
      id: m.userId,
      email: m.user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
      defaultCompanyId: R,
      defaultRole: "ADMIN",
    },
    secret: (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET)!,
  })
  return { cookie: `next-auth.session-token=${token}`, userName: m.user.name || m.user.email }
}

type Res = { status: number; json: any; text: string }
function client(cookie: string) {
  return async (method: string, path: string, body?: unknown): Promise<Res> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: res.status, json, text }
  }
}

async function main() {
  // Aday: KABUL, alışa aktarılmamış, TL, gizli değil, "işlenmemiş fatura" penceresinde.
  const adaylar = await prisma.incomingInvoice.findMany({
    where: {
      companyId: R,
      status: "KABUL",
      isLinkedToPurchase: false,
      isArchived: false,
      hiddenAt: null,
      OR: [{ currencyCode: null }, { currencyCode: "TRY" }],
      docDate: { lte: gunOnce(GECIKME_GUN), gte: gunOnce(PENCERE_GUN) },
    },
    select: { uuid: true, invoiceNo: true, docDate: true },
    orderBy: { docDate: "desc" },
    take: 2,
  })
  if (adaylar.length < 2 || !adaylar.every((a) => a.invoiceNo && a.docDate)) {
    throw new Error("Reypo'da uygun iki gelen fatura yok (KABUL, aktarılmamış, TL, 7–90 gün)")
  }
  const [a, b] = adaylar
  const uuids = [a.uuid, b.uuid]
  console.log(`Adaylar: ${a.invoiceNo} (${a.uuid}), ${b.invoiceNo} (${b.uuid})`)

  const { cookie, userName } = await adminCookie()
  const api = client(cookie)

  // Aralık: iki faturanın ayının başından bugüne.
  const enEski = adaylar.reduce((m, x) => (x.docDate! < m ? x.docDate! : m), a.docDate!)
  const start = new Date(Date.UTC(enEski.getUTCFullYear(), enEski.getUTCMonth() - 1, 1))
  const end = new Date()
  const q = (extra = "") =>
    `/api/e-donusum/inbox?companyId=${R}&source=db&dateField=docDate&pageSize=500&startDate=${start.toISOString()}&endDate=${end.toISOString()}${extra}`

  // KDV kontrol listesi: faturanın İstanbul ayı (docDate İstanbul gece yarısıdır).
  const ayBas = (d: Date) => {
    const ist = new Date(d.getTime() + 3 * 3600 * 1000)
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1))
  }
  const ayBasA = ayBas(a.docDate!)
  const aySonA = new Date(Date.UTC(ayBasA.getUTCFullYear(), ayBasA.getUTCMonth() + 1, 1))
  const ayniAy = ayBas(b.docDate!).getTime() === ayBasA.getTime()

  try {
    console.log("\n1) Başlangıç")
    const l0 = await api("GET", q())
    check("liste 200", l0.status === 200, l0.status === 200 ? undefined : l0.text.slice(0, 300))
    if (l0.status !== 200) throw new Error("Liste ucu çalışmıyor — dev sunucusu migrasyondan sonra yeniden başlatıldı mı?")
    const T = l0.json.total as number
    const H = l0.json.hiddenCount as number
    const sum0 = l0.json.stats.total.sum as number
    check("adaylar listede", uuids.every((u) => l0.json.data.some((r: any) => r.uuid === u)))
    const isl0 = await islenmemisFaturaOzeti(R)
    const kdv0 = await aktarilmamisGelenFaturalar({ companyId: R, bas: ayBasA, sonHaric: aySonA })
    const birlesik = (no: string) =>
      api(
        "GET",
        `/api/faturalar?companyId=${R}&direction=incoming&startDate=${start.toISOString()}&endDate=${end.toISOString()}&search=${encodeURIComponent(no)}`,
      )
    const bl0 = await birlesik(a.invoiceNo!)
    check("birleşik listede var", bl0.status === 200 && bl0.text.includes(a.uuid), bl0.status)
    console.log(`   toplam ${T}, gizli ${H}, işlenmemiş kart ${isl0?.adet ?? 0}, KDV ayı aktarılmamış ${kdv0.adet}`)

    console.log("\n2) Doğrulama")
    const v1 = await api("POST", "/api/e-donusum/inbox/hide", { companyId: R, uuids })
    check("hidden yoksa 400", v1.status === 400, v1.json?.error)
    const v2 = await api("POST", "/api/e-donusum/inbox/hide", { companyId: R, uuids: [], hidden: true })
    check("boş seçim 400", v2.status === 400, v2.json?.error)
    const v3 = await api("GET", "/api/e-donusum/inbox/hide")
    check("GET yok (405)", v3.status === 405, v3.status)

    console.log("\n3) Gizle")
    const h1 = await api("POST", "/api/e-donusum/inbox/hide", { companyId: R, uuids, hidden: true })
    check("gizle 200, 2 satır", h1.status === 200 && h1.json?.updated === 2, h1.json)

    const l1 = await api("GET", q())
    check("liste toplamı 2 azaldı", l1.json.total === T - 2, `${T} → ${l1.json.total}`)
    check("hiddenCount 2 arttı", l1.json.hiddenCount === H + 2, `${H} → ${l1.json.hiddenCount}`)
    check("adaylar listede yok", uuids.every((u) => !l1.json.data.some((r: any) => r.uuid === u)))
    check("özet tutar düştü", l1.json.stats.total.sum < sum0, `${sum0} → ${l1.json.stats.total.sum}`)

    const lh = await api("GET", q("&hidden=only"))
    const satirA = lh.json.data.find((r: any) => r.uuid === a.uuid)
    check("gizlenenler görünümü: toplam = hiddenCount", lh.json.total === H + 2 && lh.json.hiddenCount === H + 2, {
      total: lh.json.total,
      hiddenCount: lh.json.hiddenCount,
    })
    check("gizlenenlerde adaylar var", uuids.every((u) => lh.json.data.some((r: any) => r.uuid === u)))
    check("satırda gizleyen ve tarih", !!satirA?.hiddenAt && satirA?.hiddenBy === userName, {
      hiddenAt: satirA?.hiddenAt,
      hiddenBy: satirA?.hiddenBy,
    })

    const ilkAn = satirA?.hiddenAt
    const h2 = await api("POST", "/api/e-donusum/inbox/hide", { companyId: R, uuids: [a.uuid], hidden: true })
    check("tekrar gizleme dokunmaz (0 satır)", h2.status === 200 && h2.json?.updated === 0, h2.json)
    const dA = await api("GET", `/api/e-donusum/inbox/${encodeURIComponent(a.uuid)}?companyId=${R}`)
    check("detay: hiddenAt ilk gizleme anı korunur", dA.json?.hiddenAt === ilkAn, {
      ilk: ilkAn,
      simdi: dA.json?.hiddenAt,
    })
    check("detay: hiddenBy", dA.json?.hiddenBy === userName, dA.json?.hiddenBy)

    const bl1 = await birlesik(a.invoiceNo!)
    check("birleşik listeden düştü", bl1.status === 200 && !bl1.text.includes(a.uuid), bl1.status)

    const ex = (extra = "") =>
      api(
        "GET",
        `/api/export/gelen-e-faturalar?companyId=${R}&format=csv&dateField=docDate&startDate=${start.toISOString()}&endDate=${end.toISOString()}${extra}`,
      )
    const e1 = await ex()
    check("dışa aktarım (varsayılan) gizleneni içermez", e1.status === 200 && !e1.text.includes(a.invoiceNo!), e1.status)
    const e2 = await ex("&hidden=only")
    // Filtre özeti ("Yalnız listede gizlenen faturalar") Excel/PDF başlığına yazılır, CSV'ye
    // değil — o metin incoming-list-query.test.ts'te ölçülüyor.
    check("dışa aktarım (gizlenenler) içerir", e2.status === 200 && e2.text.includes(a.invoiceNo!), e2.status)

    const isl1 = await islenmemisFaturaOzeti(R)
    check("işlenmemiş fatura kartı 2 azaldı", (isl1?.adet ?? 0) === (isl0?.adet ?? 0) - 2, `${isl0?.adet} → ${isl1?.adet ?? 0}`)
    const kdv1 = await aktarilmamisGelenFaturalar({ companyId: R, bas: ayBasA, sonHaric: aySonA })
    const beklenen = kdv0.adet - (ayniAy ? 2 : 1)
    check("KDV kontrol listesi düştü", kdv1.adet === beklenen, `${kdv0.adet} → ${kdv1.adet} (beklenen ${beklenen})`)

    console.log("\n4) Listede göster")
    const u1 = await api("POST", "/api/e-donusum/inbox/hide", { companyId: R, uuids, hidden: false })
    check("göster 200, 2 satır", u1.status === 200 && u1.json?.updated === 2, u1.json)
    const l2 = await api("GET", q())
    check("liste toplamı eski hâline döndü", l2.json.total === T && l2.json.hiddenCount === H, {
      total: l2.json.total,
      hiddenCount: l2.json.hiddenCount,
    })
    check("özet tutar eski hâline döndü", l2.json.stats.total.sum === sum0, `${sum0} → ${l2.json.stats.total.sum}`)
    const dA2 = await api("GET", `/api/e-donusum/inbox/${encodeURIComponent(a.uuid)}?companyId=${R}`)
    check("detay: hiddenAt temizlendi", dA2.json?.hiddenAt === null && dA2.json?.hiddenBy === null)
    const isl2 = await islenmemisFaturaOzeti(R)
    check("işlenmemiş fatura kartı geri geldi", (isl2?.adet ?? 0) === (isl0?.adet ?? 0))

    console.log("\n5) Profil telefonu")
    const prof = await api("GET", "/api/auth/profile")
    const p1 = await api("PUT", "/api/auth/profile", {
      name: prof.json.name,
      email: prof.json.email,
      phone: "123",
      twoFactorEnabled: prof.json.twoFactorEnabled,
    })
    check("geçersiz (değişen) numara 400", p1.status === 400 && p1.json?.error === TR_PHONE_ERROR, p1.json?.error)
    const prof2 = await api("GET", "/api/auth/profile")
    check("400'de telefon yazılmadı", prof2.json.phone === prof.json.phone)
  } finally {
    // Her durumda adayları gizlenmemiş bırak.
    await prisma.incomingInvoice.updateMany({
      where: { companyId: R, uuid: { in: uuids } },
      data: { hiddenAt: null, hiddenById: null },
    })
  }

  console.log(`\n${pass} geçti, ${fail} kaldı${fail ? `: ${failures.join(" · ")}` : ""}`)
  if (fail) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
