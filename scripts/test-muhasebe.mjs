/**
 * MUHASEBE MODÜLÜ — uçtan uca (2. + 3. + 4. faz). Plan: docs/muhasebe/MOTOR-PLAN.md
 *
 * Çalıştırma:
 *   1) Migrasyon uygulanmış olmalı: supabase/migrations/20261004000001_muhasebe_2faz.sql
 *   2) npm run dev            (ayrı terminalde)
 *   3) TEST_BASE_URL=http://localhost:3000 node scripts/test-muhasebe.mjs
 *      MUHASEBE_BIRAK=1 verilirse sonda temizlik YAPILMAZ (ekranda bakmak için).
 *      MUHASEBE_SIFIRLA=1 verilirse önceki bir BIRAK koşusunun kurulumu başta silinir ve
 *      modül kapalı duruma getirilir (yalnız Reypo Medya — test firması).
 *
 * Reypo Medya (test firması) üzerinde çalışır. Başta muhasebe kurulu ise ÇALIŞMAZ
 * (gerçek bir kurulumu ezmesin). Modülü firmaya bedelsiz verir, kurar, belgelerin
 * fişlerini üretir; hesap seçimi + öğrenme, toplu onay, elle fiş, açılış farkını
 * dağıtma, mizan/yevmiye/kebir/mali tablolar, fatura yazınca anında fiş, şubede modül
 * kapalı, kapanış ön izlemesini dener. Sonda açtığı her şeyi siler ve modül
 * durumunu eski hâline getirir (önceden var olan hesap planı satırları korunur).
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"
import { Agent, setGlobalDispatcher } from "undici"

// Mutabakat/toplu onay uzak veritabanında dakikalar sürebilir; Node fetch'in 300 sn'lik
// başlık zaman aşımı isteği kesip testi düşürüyor, sunucu ise yazmaya devam ediyordu.
setGlobalDispatcher(new Agent({ headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000 }))

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const BIRAK = process.env.MUHASEBE_BIRAK === "1"
const SIFIRLA = process.env.MUHASEBE_SIFIRLA === "1"
const R = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const failures = []
function check(label, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}${detail !== undefined ? ` → ${detail}` : ""}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ✗ ${label}${detail !== undefined ? ` → ${detail}` : ""}`)
  }
}
const r2 = (n) => Math.round(Number(n) * 100) / 100

/** İstemci tarafı kopan bir istek sunucuda sürüyor olabilir: temizlikten önce yazma durulsun. */
let kopanIstek = false
async function sunucuDurulsun() {
  let onceki = -1
  for (let i = 0; i < 60; i++) {
    const n = await prisma.journalVoucher.count({ where: { companyId: R } })
    if (n === onceki) return
    onceki = n
    await new Promise((r) => setTimeout(r, 5000))
  }
  console.log("  ! sunucu 5 dk içinde durulmadı — temizlik yine de yapılıyor")
}

async function oturum(companyId) {
  const m = await prisma.userCompany.findFirst({
    where: { companyId, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  })
  if (!m) throw new Error("ADMIN üyelik yok")
  const token = await encode({
    token: { id: m.userId, email: m.user.email, isSuperAdmin: false, isBlogEditor: false, defaultCompanyId: companyId, defaultRole: "ADMIN" },
    secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  })
  const cookie = `next-auth.session-token=${token}`
  return async (method, path, body) => {
    let res
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      kopanIstek = true
      throw e
    }
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 300) }
    }
    return { status: res.status, body: json }
  }
}

async function main() {
  if (SIFIRLA) {
    // Önceki koşunun bıraktığı kurulum: fişler, öğrenmeler, ayar; modül kapalı (migrasyonun
    // bütün firmalara yazdığı başlangıç durumu). Hesap planı satırları korunur.
    await prisma.journalVoucher.deleteMany({ where: { companyId: R } })
    await prisma.accountMappingRule.deleteMany({ where: { companyId: R } })
    await prisma.accountingSettings.deleteMany({ where: { companyId: R } })
    const f = await prisma.company.findUnique({ where: { id: R }, select: { disabledModules: true, grantedModules: true } })
    await prisma.company.update({
      where: { id: R },
      data: {
        grantedModules: (f.grantedModules ?? []).filter((m) => m !== "accounting"),
        disabledModules: [...new Set([...(f.disabledModules ?? []), "accounting"])],
      },
    })
    console.log("MUHASEBE_SIFIRLA=1 — önceki test kurulumu silindi, modül kapatıldı.\n")
  }
  const firma = await prisma.company.findUnique({
    where: { id: R },
    select: { id: true, name: true, disabledModules: true, grantedModules: true, branches: { select: { id: true, name: true } } },
  })
  if (!firma) throw new Error("Reypo Medya bulunamadı")
  const mevcutAyar = await prisma.accountingSettings.findUnique({ where: { companyId: R } })
  if (mevcutAyar) throw new Error("Reypo Medya'da muhasebe zaten kurulu — gerçek kurulumu ezmemek için durdum.")
  const oncekiHesaplar = new Set((await prisma.accountPlan.findMany({ where: { companyId: R }, select: { id: true } })).map((h) => h.id))
  const oncekiModul = { disabledModules: firma.disabledModules, grantedModules: firma.grantedModules }
  const api = await oturum(R)
  const q = `companyId=${R}`
  let manuelFaturaId = null

  console.log(`Firma : ${firma.name}\nSunucu: ${BASE}\n`)
  try {
    // ── Modül kapalıyken kapı ────────────────────────────────────────────────
    console.log("0) Modül kapalıyken uçlar MODULE_LOCKED")
    const kapali = await api("GET", `/api/muhasebe/ayarlar?${q}`)
    check("modül kapalı → 403 MODULE_LOCKED", kapali.status === 403 && kapali.body?.code === "MODULE_LOCKED", kapali.status)

    // Bedelsiz ver (sistem-admin kartının yaptığı: grantedModules + disabledModules'tan çıkar).
    await prisma.company.update({
      where: { id: R },
      data: {
        grantedModules: [...new Set([...(firma.grantedModules ?? []), "accounting"])],
        disabledModules: (firma.disabledModules ?? []).filter((m) => m !== "accounting"),
      },
    })

    // ── 1. Kurulum ───────────────────────────────────────────────────────────
    console.log("\n1) Kurulum")
    const once = await api("GET", `/api/muhasebe/ayarlar?${q}`)
    check("ayarlar okunur, kurulu değil", once.status === 200 && once.body.kurulu === false, once.status)
    const fisYok = await api("GET", `/api/muhasebe/fisler?${q}`)
    check("kurulumsuz fiş listesi 409 KURULUM_YOK", fisYok.status === 409 && fisYok.body?.code === "KURULUM_YOK", fisYok.status)
    const kur = await api("PUT", "/api/muhasebe/ayarlar", { companyId: R, startDate: "2026-07-01" })
    check("kuruldu", kur.status === 200, JSON.stringify(kur.body).slice(0, 120))
    const sonra = await api("GET", `/api/muhasebe/ayarlar?${q}`)
    check("hesap planı yazıldı (≥ 321 Tekdüzen hesabı)", sonra.body.hesapSayisi >= 321, sonra.body.hesapSayisi)
    // Başlangıçta bakiye yoksa açılış fişi hiç açılmaz (satırsız taslak kapanışı kilitlerdi).
    check(
      "açılış fişi taslak (ya da bakiye yoksa hiç yok)",
      sonra.body.acilis == null || sonra.body.acilis.durum === "DRAFT",
      sonra.body.acilis?.durum ?? "yok",
    )

    // ── 2. Mutabakat ─────────────────────────────────────────────────────────
    console.log("\n2) Mutabakat — geçmiş belgelerin taslak fişleri")
    const kuru = await api("GET", `/api/muhasebe/mutabakat?${q}`)
    check("kuru sayım çalışır", kuru.status === 200, `açılacak ${kuru.body.acilan}`)
    let toplamAcilan = 0
    for (let i = 0; i < 50; i++) {
      const adim = await api("POST", "/api/muhasebe/mutabakat", { companyId: R, acilis: i === 0, limit: 200 })
      if (adim.status !== 200) {
        check("mutabakat adımı", false, JSON.stringify(adim.body).slice(0, 200))
        break
      }
      toplamAcilan += adim.body.acilan
      if (adim.body.kalan === 0) break
    }
    check("taslak fişler açıldı", toplamAcilan > 0 && toplamAcilan === kuru.body.acilan, `${toplamAcilan} fiş`)
    const ikinci = await api("POST", "/api/muhasebe/mutabakat", { companyId: R })
    check("ikinci tur hiçbir şey değiştirmez (idempotent)", ikinci.body.acilan + ikinci.body.yenilenen + ikinci.body.silinen === 0, JSON.stringify(ikinci.body).slice(0, 80))
    const dengesiz = await prisma.$queryRaw`
      SELECT v.id FROM journal_vouchers v JOIN journal_voucher_lines l ON l."voucherId" = v.id
      WHERE v."companyId" = ${R}
      GROUP BY v.id HAVING SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE -l.amount END) <> 0`
    check("her fiş dengeli", dengesiz.length === 0, `${dengesiz.length} dengesiz`)

    // ── 3. Liste, hesap seçimi, öğrenme ──────────────────────────────────────
    console.log("\n3) Gözden geçir → hesap seç → onayla → öğren")
    const gozden = await api("GET", `/api/muhasebe/fisler?${q}&sekme=gozden`)
    check("gözden geçir sekmesi", gozden.status === 200, `${gozden.body.sayilar?.gozden} gözden · ${gozden.body.sayilar?.emin} emin`)
    const hesaplar = (await api("GET", `/api/muhasebe/hesap-plani?${q}&yaprak=1`)).body.hesaplar
    const h770 = hesaplar.find((h) => h.kod === "770")
    // Önce "770.01 Test Gider" alt hesabı açılır → 770 yaprak olmaktan çıkar.
    const alt = await api("POST", "/api/muhasebe/hesap-plani", { companyId: R, ustKod: "770", ad: "TEST Muhasebe Gider" })
    // Sıradaki numara: önceki koşudan 770.01 kalmışsa 770.02 doğrudur.
    check("770 altına alt hesap açıldı", alt.status === 201 && /^770\.\d{2}$/.test(alt.body.hesap?.kod ?? ""), alt.body.hesap?.kod)
    // 770 varsayılanlı taslakta satır artık hesapsız olmalı.
    const tahminli = await prisma.journalVoucherLine.findFirst({
      where: { companyId: R, suggestedCode: "770", role: { in: ["ALIS", "GIDER"] }, learnKeys: { isEmpty: false }, voucher: { status: "DRAFT" } },
      select: { id: true, voucherId: true, accountId: true, learnKeys: true },
    })
    check("770'li taslak satır yeniden çözüldü (hesapsız)", tahminli && tahminli.accountId === null, tahminli ? "hesapsız" : "satır yok")
    if (tahminli) {
      const sec = await api("PUT", `/api/muhasebe/fisler/${tahminli.voucherId}`, {
        companyId: R,
        satirHesaplari: [{ satirId: tahminli.id, accountId: alt.body.hesap.id }],
      })
      check("hesap seçildi", sec.status === 200, sec.status)
      const detay = await api("GET", `/api/muhasebe/fisler/${tahminli.voucherId}?${q}&sekme=gozden`)
      const engel = detay.body.engel
      if (engel) {
        // Fişte başka hesapsız satır varsa onlara da varsayılan seçilir.
        const eksik = detay.body.satirlar.filter((s) => !s.hesap || !s.hesap.uygun)
        for (const s of eksik) {
          const aday = hesaplar.find((h) => h.kod === (s.oneriKodu || "").split(".")[0] && h.yaprak) ?? hesaplar.find((h) => h.kod === "689")
          if (aday) await api("PUT", `/api/muhasebe/fisler/${tahminli.voucherId}`, { companyId: R, satirHesaplari: [{ satirId: s.id, accountId: aday.id }] })
        }
      }
      const onay = await api("POST", `/api/muhasebe/fisler/${tahminli.voucherId}`, { companyId: R, islem: "onayla" })
      check("fiş onaylandı, eşleşme öğrenildi", onay.status === 200 && onay.body.ogrenilen >= 1, JSON.stringify(onay.body))
      const kural = await prisma.accountMappingRule.findFirst({ where: { companyId: R, key: tahminli.learnKeys[0] } })
      check("öğrenme kuralı yazıldı", kural?.accountId === alt.body.hesap.id, tahminli.learnKeys[0])
      const geriAl = await api("POST", `/api/muhasebe/fisler/${tahminli.voucherId}`, { companyId: R, islem: "geri-al" })
      check("onay geri alındı", geriAl.status === 200, geriAl.status)
    }
    void h770

    // ── 4. Toplu onay ────────────────────────────────────────────────────────
    console.log("\n4) Toplu onay (emin fişler)")
    const eminOnce = (await api("GET", `/api/muhasebe/fisler?${q}&sekme=emin`)).body.sayilar.emin
    const toplu = await api("POST", "/api/muhasebe/fisler/toplu-onay", { companyId: R })
    check("emin fişler onaylandı", toplu.status === 200 && toplu.body.onaylanan > 0, `${toplu.body.onaylanan}/${eminOnce}, atlanan ${toplu.body.atlanan?.length}`)

    // ── 5. Açılış farkı ──────────────────────────────────────────────────────
    console.log("\n5) Açılış fişi — farkı dağıt ve onayla")
    const ayar = (await api("GET", `/api/muhasebe/ayarlar?${q}`)).body
    if (ayar.acilis) {
      const acilis = (await api("GET", `/api/muhasebe/fisler/${ayar.acilis.id}?${q}`)).body
      const fark = acilis.satirlar.find((s) => s.rol === "ACILIS_FARK")
      const h500 = hesaplar.find((h) => h.kod === "500")
      if (fark) {
        const d = await api("PUT", `/api/muhasebe/fisler/${ayar.acilis.id}`, {
          companyId: R,
          elleSatirlar: [{ side: fark.taraf === "A" ? "CREDIT" : "DEBIT", amount: fark.tutar, accountId: h500.id, description: "TEST sermaye" }],
        })
        check("fark elle satırla dağıtıldı", d.status === 200, d.status)
        const yeni = (await api("GET", `/api/muhasebe/fisler/${ayar.acilis.id}?${q}`)).body
        check("fark satırı kalktı", !yeni.satirlar.some((s) => s.rol === "ACILIS_FARK"), yeni.satirlar.length)
      }
      const yeni = (await api("GET", `/api/muhasebe/fisler/${ayar.acilis.id}?${q}`)).body
      if (!yeni.engel) {
        const o = await api("POST", `/api/muhasebe/fisler/${ayar.acilis.id}`, { companyId: R, islem: "onayla" })
        check("açılış fişi onaylandı", o.status === 200, o.status)
      } else {
        check("açılış fişi onaya hazır", false, yeni.engel)
      }
    } else {
      check("açılış fişi yok (başlangıçta bakiye yok)", true)
    }

    // ── 6. Elle fiş ──────────────────────────────────────────────────────────
    console.log("\n6) Elle fiş")
    const h100 = hesaplar.find((h) => h.kod.startsWith("100.01.")) ?? hesaplar.find((h) => h.kod === "100")
    const dengesizElle = await api("POST", "/api/muhasebe/fisler", {
      companyId: R,
      tarih: "2026-09-30",
      aciklama: "TEST dengesiz",
      satirlar: [
        { side: "DEBIT", amount: 10, accountId: alt.body.hesap.id },
        { side: "CREDIT", amount: 9, accountId: h100.id },
      ],
    })
    check("dengesiz elle fiş reddedilir", dengesizElle.status === 400, dengesizElle.body.error)
    const elle = await api("POST", "/api/muhasebe/fisler", {
      companyId: R,
      tarih: "2026-09-30",
      aciklama: "TEST elle fiş",
      satirlar: [
        { side: "DEBIT", amount: 123.45, accountId: alt.body.hesap.id, description: "TEST" },
        { side: "CREDIT", amount: 123.45, accountId: h100.id },
      ],
    })
    check("elle fiş açıldı (taslak)", elle.status === 201, elle.body.id)
    const elleOnay = await api("POST", `/api/muhasebe/fisler/${elle.body.id}`, { companyId: R, islem: "onayla" })
    check("elle fiş onaylandı", elleOnay.status === 200, elleOnay.status)
    const silOnayli = await api("DELETE", `/api/muhasebe/fisler/${elle.body.id}?${q}`)
    check("onaylı elle fiş silinmez", silOnayli.status === 400, silOnayli.body.error)
    await api("POST", `/api/muhasebe/fisler/${elle.body.id}`, { companyId: R, islem: "geri-al" })
    const sil = await api("DELETE", `/api/muhasebe/fisler/${elle.body.id}?${q}`)
    check("taslak elle fiş silindi", sil.status === 200, sil.status)

    // ── 7. Defterler ve mali tablolar ────────────────────────────────────────
    console.log("\n7) Mizan, yevmiye, kebir, mali tablolar")
    const mz = await api("GET", `/api/muhasebe/mizan?${q}&bas=2026-01-01&bit=2026-12-31`)
    const t3 = mz.body.toplamlar?.["3"]
    check("mizan borç = alacak", mz.status === 200 && t3 && r2(t3.toplamBorc) === r2(t3.toplamAlacak), t3 ? `${t3.toplamBorc} / ${t3.toplamAlacak}` : mz.status)
    const mzT = await api("GET", `/api/muhasebe/mizan?${q}&bas=2026-01-01&bit=2026-12-31&taslak=1`)
    const t3T = mzT.body.toplamlar?.["3"]
    // Hesabı seçilmemiş taslak satırlar mizana girmez; denge onlarla birlikte tutar.
    const hz = mzT.body.hesapsiz ?? { borc: 0, alacak: 0, fisSayisi: 0 }
    check(
      "taslaklar dahil mizan + hesapsız satırlar dengeli",
      t3T && r2(t3T.toplamBorc + hz.borc) === r2(t3T.toplamAlacak + hz.alacak),
      `${t3T?.toplamBorc} + ${hz.borc} / ${t3T?.toplamAlacak} + ${hz.alacak} (${hz.fisSayisi} fiş)`,
    )
    const yv = await api("GET", `/api/muhasebe/yevmiye?${q}&bas=2026-01-01&bit=2026-12-31`)
    check("yevmiye maddeleri", yv.status === 200 && yv.body.toplam > 0 && r2(yv.body.borc) === r2(yv.body.alacak), `${yv.body.toplam} madde`)
    const kb = await api("GET", `/api/muhasebe/kebir?${q}&hesap=120&bas=2026-01-01&bit=2026-12-31`)
    check("kebir 120 (alt hesaplarla)", kb.status === 200, `${kb.body.satirlar?.length} hareket`)
    const mt = await api("GET", `/api/muhasebe/mali-tablolar?${q}&bas=2026-01-01&bit=2026-12-31`)
    check(
      "bilanço denk (aktif = pasif)",
      mt.status === 200 && Math.abs(mt.body.bilanco.aktifToplam - mt.body.bilanco.pasifToplam) < 0.01,
      mt.body.bilanco ? `${mt.body.bilanco.aktifToplam} / ${mt.body.bilanco.pasifToplam}` : mt.status,
    )
    check("gelir tablosu net kâr = bilançodaki kapanmamış sonuç", r2(mt.body.gelirTablosu?.netKar) === r2(mt.body.bilanco?.kapanmamisSonuc), `${mt.body.gelirTablosu?.netKar} / ${mt.body.bilanco?.kapanmamisSonuc}`)

    // ── 8. Belge yazınca anında fiş ──────────────────────────────────────────
    console.log("\n8) Fatura yazılınca fiş anında doğar, silinince kalkar")
    const musteri = await prisma.customer.findFirst({ where: { companyId: R }, select: { id: true } })
    const fat = await api("POST", "/api/e-donusum/invoices", {
      companyId: R,
      type: "SALES",
      invoiceType: "MANUAL",
      customerId: musteri.id,
      date: "2026-10-02",
      currency: "TRY",
      notes: "TEST muhasebe senkronu",
      items: [{ description: "TEST Muhasebe kalemi", quantity: 2, unitPrice: 150, vatRate: 20 }],
    })
    check("fatura kaydedildi", fat.status === 201, fat.status)
    manuelFaturaId = fat.body?.id
    const fisi = await prisma.journalVoucher.findFirst({
      where: { companyId: R, sourceType: "INVOICE", sourceId: manuelFaturaId },
      select: { id: true, status: true, lines: { select: { side: true, amount: true, role: true } } },
    })
    check("faturanın taslak fişi anında açıldı", fisi?.status === "DRAFT", fisi ? `${fisi.lines.length} satır` : "fiş yok")
    const cari = fisi?.lines.find((l) => l.role === "CARI")
    check("cari satırı belge toplamı (360)", cari && r2(cari.amount) === 360, cari?.amount)
    // Kaynak değişince taslak fiş YENİLENİR (toplu yenileme yolu): tarih fişe taşınmalı.
    await prisma.invoice.update({ where: { id: manuelFaturaId }, data: { date: new Date("2026-10-03T00:00:00Z") } })
    const yen = await api("POST", "/api/muhasebe/mutabakat", { companyId: R })
    const yenFis = await prisma.journalVoucher.findFirst({
      where: { companyId: R, sourceType: "INVOICE", sourceId: manuelFaturaId },
      select: { date: true, isConfident: true, lines: { select: { amount: true, side: true } } },
    })
    const yenBorc = r2((yenFis?.lines ?? []).filter((l) => l.side === "DEBIT").reduce((a, l) => a + Number(l.amount), 0))
    const yenAlacak = r2((yenFis?.lines ?? []).filter((l) => l.side === "CREDIT").reduce((a, l) => a + Number(l.amount), 0))
    check(
      "kaynak değişti → taslak fiş yenilendi (yeni tarih, dengeli)",
      yen.status === 200 && yen.body.yenilenen >= 1 && yenFis?.date.toISOString().startsWith("2026-10-03") && yenBorc === yenAlacak && yenBorc === 360,
      `yenilenen ${yen.body.yenilenen} · ${yenFis?.date.toISOString().slice(0, 10)} · ${yenBorc}/${yenAlacak}`,
    )
    const del = await api("DELETE", `/api/e-donusum/invoices/${manuelFaturaId}?${q}`)
    check("fatura silindi", del.status === 200, del.status)
    manuelFaturaId = null
    const kalan = await prisma.journalVoucher.findFirst({ where: { companyId: R, sourceType: "INVOICE", sourceId: fat.body?.id } })
    check("taslak fiş de kalktı", !kalan, kalan ? "duruyor" : "yok")

    // ── 9. Şube ──────────────────────────────────────────────────────────────
    console.log("\n9) Şubede modül kapalı (defter ana firmada)")
    for (const sube of firma.branches.slice(0, 1)) {
      const apiS = await oturum(sube.id).catch(() => null)
      if (!apiS) {
        check(`şube ${sube.name}: ADMIN üyelik yok, atlandı`, true)
        continue
      }
      const s = await apiS("GET", `/api/muhasebe/ayarlar?companyId=${sube.id}`)
      check(`şube ${sube.name} → 403 MODULE_LOCKED`, s.status === 403 && s.body?.code === "MODULE_LOCKED", s.status)
    }

    // ── 10. Kapanış ön izlemesi ──────────────────────────────────────────────
    console.log("\n10) Dönem kapanışı ön izlemesi")
    const kp = await api("GET", `/api/muhasebe/kapanis?${q}&yil=2026&stok=0`)
    check("ön izleme çalışır", kp.status === 200, `${kp.body.fisler?.length} fiş · net ${kp.body.netKar}`)
    check("taslak varken kapanış engellenir", kp.body.taslak === 0 || kp.body.engeller?.some((e) => e.includes("taslak")), kp.body.engeller?.[0])
  } finally {
    if (manuelFaturaId) await api("DELETE", `/api/e-donusum/invoices/${manuelFaturaId}?${q}`).catch(() => {})
    if (BIRAK) {
      console.log("\nMUHASEBE_BIRAK=1 — temizlik yapılmadı.")
    } else {
      console.log("\nTemizlik…")
      if (kopanIstek) {
        console.log("  bir istek koptu — sunucunun yazmayı bitirmesi bekleniyor")
        await sunucuDurulsun()
      }
      await prisma.journalVoucher.deleteMany({ where: { companyId: R } })
      await prisma.accountMappingRule.deleteMany({ where: { companyId: R } })
      await prisma.accountingSettings.deleteMany({ where: { companyId: R } })
      // Önceden var olan hesap planı satırları (eski accounting_entries bağlı) korunur.
      const yeniler = (await prisma.accountPlan.findMany({ where: { companyId: R }, select: { id: true, code: true } })).filter(
        (h) => !oncekiHesaplar.has(h.id),
      )
      // Çocuktan ebeveyne doğru sil (parentId SET NULL ama sıralı daha temiz).
      yeniler.sort((a, b) => b.code.length - a.code.length)
      for (let i = 0; i < yeniler.length; i += 500) {
        await prisma.accountPlan.deleteMany({ where: { id: { in: yeniler.slice(i, i + 500).map((h) => h.id) } } })
      }
      await prisma.company.update({ where: { id: R }, data: oncekiModul })
      console.log(`  ${yeniler.length} hesap, fişler ve ayar silindi; modül durumu geri yüklendi.`)
    }
  }
  console.log(`\n${pass} geçti, ${fail} kaldı${failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""}`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
