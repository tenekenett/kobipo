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
  // 8b'nin gerçek modüllerde açtıkları — BIRAK olsa da silinir (test verisi Reypo'da kalmasın).
  const temizlik = { bordrolar: [], cekler: [], virmanlar: [], hareketler: [], hesaplar: [] }

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

    // ── 1a. Bakiyesiz başlangıç: açılış fişi elle satırlarla açılır ─────────
    // 1 Ocak'ta Reypo'nun Kobipo'da bakiyesi yok → açılış fişi kendiliğinden açılmaz;
    // müşavirin sermaye/demirbaş satırlarıyla açılır, mutabakat ona dokunmaz.
    console.log("\n1a) Bakiyesiz başlangıç — açılış fişi elle açılır")
    const kurOcak = await api("PUT", "/api/muhasebe/ayarlar", { companyId: R, startDate: "2026-01-01" })
    check("1 Ocak başlangıcıyla kuruldu", kurOcak.status === 200, JSON.stringify(kurOcak.body).slice(0, 120))
    const ocak = await api("GET", `/api/muhasebe/ayarlar?${q}`)
    if (ocak.body.acilis != null) {
      console.log("  ~ 1 Ocak'ta bakiye var (açılış fişi kendiliğinden açıldı) — bu adım atlandı")
    } else {
      const ocakHesaplar = (await api("GET", `/api/muhasebe/hesap-plani?${q}&yaprak=1`)).body.hesaplar
      const h255 = ocakHesaplar.find((h) => h.kod === "255")
      const h500 = ocakHesaplar.find((h) => h.kod === "500")
      // Bilerek dengesiz: 1000 borç, 600 alacak → 400'lük fark satırı eklenmeli.
      const elleSatirlar = [
        { side: "DEBIT", amount: 1000, accountId: h255?.id ?? null, description: "TEST demirbaş" },
        { side: "CREDIT", amount: 600, accountId: h500?.id ?? null, description: "TEST sermaye" },
      ]
      const ac = await api("POST", "/api/muhasebe/fisler", { companyId: R, acilis: true, elleSatirlar })
      check("açılış fişi elle satırlarla açıldı", ac.status === 201 && typeof ac.body.id === "string", JSON.stringify(ac.body).slice(0, 120))
      const acilisId = ac.body.id
      const tekrar = await api("POST", "/api/muhasebe/fisler", { companyId: R, acilis: true, elleSatirlar })
      check("ikinci kez açılmaz (409)", tekrar.status === 409, tekrar.status)
      const ayarOcak = await api("GET", `/api/muhasebe/ayarlar?${q}`)
      check("ayarlar açılış fişini gösterir", ayarOcak.body.acilis?.id === acilisId && ayarOcak.body.acilis?.durum === "DRAFT", ayarOcak.body.acilis?.id)
      const satirlarOnce = await prisma.journalVoucherLine.findMany({
        where: { voucherId: acilisId },
        select: { id: true, role: true, side: true, amount: true },
        orderBy: { order: "asc" },
      })
      const fark = satirlarOnce.find((s) => s.role === "ACILIS_FARK")
      check(
        "2 elle satır + 400'lük alacak fark satırı",
        satirlarOnce.filter((s) => s.role === "MANUEL").length === 2 && fark?.side === "CREDIT" && r2(fark.amount) === 400,
        satirlarOnce.map((s) => `${s.role}:${s.side}:${s.amount}`).join(" "),
      )
      // Fişler ekranının açılışta yaptığı: açılış senkronu + bir adım mutabakat.
      const mOcak = await api("POST", "/api/muhasebe/mutabakat", { companyId: R, acilis: true, limit: 1 })
      check("mutabakat adımı (açılış dahil)", mOcak.status === 200, mOcak.status)
      const satirlarSonra = await prisma.journalVoucherLine.findMany({ where: { voucherId: acilisId }, select: { id: true }, orderBy: { order: "asc" } })
      check(
        "mutabakat elle açılış fişine dokunmaz (satır id'leri aynı)",
        satirlarSonra.length === satirlarOnce.length && satirlarSonra.every((s, i) => s.id === satirlarOnce[i].id),
        `${satirlarOnce.length} → ${satirlarSonra.length} satır`,
      )
      const bosalt = await api("PUT", `/api/muhasebe/fisler/${acilisId}`, { companyId: R, elleSatirlar: [] })
      check("son elle satır silinince fiş kalkar", bosalt.status === 200 && bosalt.body.silindi === true, JSON.stringify(bosalt.body))
      const kalan = await prisma.journalVoucher.findUnique({ where: { id: acilisId }, select: { id: true } })
      const ayarBos = await prisma.accountingSettings.findUnique({ where: { companyId: R }, select: { openingVoucherId: true } })
      check("fiş ve ayardaki bağ temizlendi", !kalan && ayarBos?.openingVoucherId == null, kalan ? "fiş duruyor" : ayarBos?.openingVoucherId)
    }

    // Başlangıç 1 Temmuz'a alınır (açılış fişinin otomatik yolunu sınamak için — o gün bakiye var).
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

    // ── 3b. Toplu eşleme ─────────────────────────────────────────────────────
    console.log("\n3b) Toplu eşleme — grup başına bir hesap, öğrenme onayda")
    const esl = await api("GET", `/api/muhasebe/fisler/eslesme?${q}`)
    check("eşleme grupları okunur", esl.status === 200 && Array.isArray(esl.body.gruplar), `${esl.body.gruplar?.length} grup · ${esl.body.fisSayisi} fiş · ${esl.body.satirSayisi} satır`)
    const yapraklar = (await api("GET", `/api/muhasebe/hesap-plani?${q}&yaprak=1`)).body.hesaplar
    const hesapFor = (kod) => yapraklar.find((h) => h.kod.startsWith(`${kod}.`)) ?? yapraklar.find((h) => h.kod === kod)
    const grup = (esl.body.gruplar ?? []).find((g) => g.ogrenmeAnahtarlari.length > 0 && hesapFor(g.oneriKodu))
    if (!grup) {
      console.log("  ~ öğrenme anahtarlı grup yok — adım atlandı")
    } else {
      const hedefHesap = hesapFor(grup.oneriKodu)
      const uyg = await api("POST", "/api/muhasebe/fisler/eslesme", { companyId: R, atamalar: [{ anahtar: grup.anahtar, accountId: hedefHesap.id }] })
      check(
        `grup eşlendi (${grup.etiket} → ${hedefHesap.kod})`,
        uyg.status === 200 && uyg.body.satir === grup.satirSayisi && uyg.body.fis === grup.fisSayisi,
        JSON.stringify({ ...uyg.body, eminFisler: uyg.body.eminFisler?.length }),
      )
      const eslSonra = await api("GET", `/api/muhasebe/fisler/eslesme?${q}`)
      check("eşlenen grup listeden kalktı", !eslSonra.body.gruplar.some((g) => g.anahtar === grup.anahtar), `${eslSonra.body.gruplar.length} grup`)
      const userSatir = await prisma.journalVoucherLine.count({
        where: { companyId: R, accountId: hedefHesap.id, accountSource: "USER", role: grup.rol, voucher: { status: "DRAFT" } },
      })
      check("satırlar elle seçilmiş (USER) yazıldı", userSatir >= grup.satirSayisi, userSatir)
      const kuralOnce = await prisma.accountMappingRule.findFirst({ where: { companyId: R, key: grup.ogrenmeAnahtarlari[0] } })
      check("kural onaydan ÖNCE yazılmadı", !kuralOnce || kuralOnce.accountId !== hedefHesap.id, kuralOnce?.accountId ?? "kural yok")
      if (uyg.body.eminFisler?.length) {
        const ids = uyg.body.eminFisler.slice(0, 500)
        const ony = await api("POST", "/api/muhasebe/fisler/toplu-onay", { companyId: R, ids })
        check("eşlenen emin fişler onaylandı", ony.status === 200 && ony.body.onaylanan === ids.length, `${ony.body.onaylanan}/${ids.length}`)
        const kural = await prisma.accountMappingRule.findFirst({ where: { companyId: R, key: grup.ogrenmeAnahtarlari[0] } })
        check("onayla kural öğrenildi", kural?.accountId === hedefHesap.id, grup.ogrenmeAnahtarlari[0])
      } else {
        console.log("  ~ eşlenen fişlerde başka bekleyen satır var — onay adımı atlandı")
      }
    }

    // ── 3c. Onay kilidi ──────────────────────────────────────────────────────
    // Betik bir taslağın kilidini tutarken onay isteği gelir; kilit bırakılmadan önce satır
    // hesapsız yapılır. Onay kilidi beklemeli ve DEĞİŞMİŞ satırı sınamalı (eski kod satırları
    // kilitsiz okuyup sınadığı için hesapsız satırlı fişi onaylardı).
    console.log("\n3c) Onay kilidi — onay, satırı değiştiren yazmayı bekler")
    const kilitFisi = await prisma.journalVoucher.findFirst({
      where: { companyId: R, status: "DRAFT", isConfident: true },
      select: { id: true, lines: { select: { id: true, accountId: true, accountSource: true }, orderBy: { order: "asc" } } },
    })
    if (!kilitFisi) {
      console.log("  ~ emin taslak yok — adım atlandı")
    } else {
      const hedefSatir = kilitFisi.lines.find((l) => l.accountId)
      let onayIstegi
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM journal_vouchers WHERE id = ${kilitFisi.id} FOR UPDATE`
          onayIstegi = api("POST", `/api/muhasebe/fisler/${kilitFisi.id}`, { companyId: R, islem: "onayla" })
          await new Promise((r) => setTimeout(r, 8000)) // istek satırları okuyup kilide varsın
          await tx.journalVoucherLine.update({ where: { id: hedefSatir.id }, data: { accountId: null, accountSource: "NONE" } })
        },
        { timeout: 60_000, maxWait: 10_000 },
      )
      const kilitSonuc = await onayIstegi
      const kilitDurum = await prisma.journalVoucher.findUnique({ where: { id: kilitFisi.id }, select: { status: true } })
      check(
        "onay değişen satırı gördü, hesapsız fişi onaylamadı",
        kilitSonuc.status === 400 && kilitDurum?.status === "DRAFT",
        `${kilitSonuc.status} ${kilitSonuc.body?.error ?? ""} · ${kilitDurum?.status}`,
      )
      await prisma.journalVoucherLine.update({
        where: { id: hedefSatir.id },
        data: { accountId: hedefSatir.accountId, accountSource: hedefSatir.accountSource },
      })
    }

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

    // ── 8b. Veri modeli (migrasyon 20261005000001) ───────────────────────────
    console.log("\n8b) Veri modeli — işveren SGK, ciro tarihi, virman kimliği, döviz kuru")
    const fisOf = (tip, id) =>
      prisma.journalVoucher.findFirst({
        where: { companyId: R, sourceType: tip, sourceId: id },
        select: { id: true, date: true, sourceHash: true, description: true, lines: { select: { side: true, amount: true, role: true, description: true } } },
      })

    // İşveren SGK: boş = otomatik (teşviksiz), girilen tutar aynen; B gider · A 361 çifti.
    const personel = await prisma.employee.findFirst({ where: { companyId: R, status: "ACTIVE" }, select: { id: true } })
    if (!personel) {
      console.log("  ~ aktif personel yok — işveren SGK adımı atlandı")
    } else {
      const doluAylar = new Set(
        (await prisma.payrollRecord.findMany({ where: { employeeId: personel.id, periodYear: 2026 }, select: { periodMonth: true } })).map((p) => p.periodMonth),
      )
      const ay = [8, 9, 10, 11, 12].find((m) => !doluAylar.has(m))
      const pr = await api("POST", "/api/personel/payroll", {
        companyId: R, employeeId: personel.id, periodYear: 2026, periodMonth: ay,
        grossSalary: 40000, bonus: 0, sgkDeduction: 6000, taxDeduction: 3000, employerSgk: "",
      })
      check("bordro açıldı (işveren payı boş = otomatik)", pr.status === 201 && pr.body.employerSgk == null, pr.status)
      if (pr.body?.id) temizlik.bordrolar.push(pr.body.id)
      const bf = await fisOf("PAYROLL", pr.body?.id)
      const isv = (bf?.lines ?? []).filter((l) => l.description?.startsWith("SGK işveren payı"))
      check(
        "bordro fişinde işveren payı çifti (40.000 × %23,75 = 9.500), 'hesaplandı' notuyla",
        isv.length === 2 && isv.every((l) => r2(l.amount) === 9500 && l.description.includes("hesaplandı")),
        isv.map((l) => `${l.side} ${l.amount}`).join(" · ") || "satır yok",
      )
      await api("PUT", `/api/personel/payroll/${pr.body.id}`, { employerSgk: "7000" })
      const bf2 = await fisOf("PAYROLL", pr.body.id)
      const isv2 = (bf2?.lines ?? []).filter((l) => l.description?.startsWith("SGK işveren payı"))
      check(
        "girilen işveren payı fişe aynen (7.000), not yok",
        isv2.length === 2 && isv2.every((l) => r2(l.amount) === 7000 && !l.description.includes("hesaplandı")),
        isv2.map((l) => `${l.side} ${l.amount}`).join(" · "),
      )
      const bozuk = await api("PUT", `/api/personel/payroll/${pr.body.id}`, { employerSgk: "-5" })
      check("eksi işveren payı 400", bozuk.status === 400, bozuk.status)
    }

    // Ciro tarihi: fiş durum tarihiyle açılır; aynı günle yeniden kaydetmek fişi oynatmaz.
    const cekMusteri = await prisma.customer.findFirst({ where: { companyId: R }, select: { id: true } })
    const cek = await api("POST", "/api/cek-senet", {
      type: "CHECK", companyId: R, checkNo: "TEST-CIRO-1", bankName: "TEST Bank", amount: 1234, issueDate: "2026-09-01",
      dueDate: "2026-12-01", status: "CİRO_EDİLDİ", statusDate: "2026-09-15", direction: "RECEIVED", customerId: cekMusteri.id,
    })
    check("ciro edilmiş çek açıldı (durum tarihi 15 Eyl)", cek.status === 201 && String(cek.body.statusChangedAt).startsWith("2026-09-15"), cek.body?.statusChangedAt)
    if (cek.body?.id) temizlik.cekler.push(cek.body.id)
    const ciro1 = await fisOf("CHECK_ENDORSE", cek.body?.id)
    check("ciro fişi durum tarihiyle", ciro1?.date.toISOString().startsWith("2026-09-15"), ciro1?.date.toISOString().slice(0, 10) ?? "fiş yok")
    await api("PUT", `/api/cek-senet/${cek.body.id}`, { type: "CHECK", notes: "TEST not", status: "CİRO_EDİLDİ", statusDate: "2026-09-15" })
    const ciro2 = await fisOf("CHECK_ENDORSE", cek.body.id)
    check("not eklemek ciro fişini oynatmaz (tarih + iz aynı)", ciro2?.date.getTime() === ciro1?.date.getTime() && ciro2?.sourceHash === ciro1?.sourceHash, ciro2?.date.toISOString().slice(0, 10))
    await api("PUT", `/api/cek-senet/${cek.body.id}`, { type: "CHECK", status: "CİRO_EDİLDİ", statusDate: "2026-09-20" })
    const ciro3 = await fisOf("CHECK_ENDORSE", cek.body.id)
    check("durum tarihi düzeltilince fiş o güne taşınır", ciro3?.date.toISOString().startsWith("2026-09-20"), ciro3?.date.toISOString().slice(0, 10))

    // Virman: iki bacak ortak kimlik taşır, fiş karşı kasayı bulur.
    const tlHesaplar = await prisma.financialAccount.findMany({ where: { companyId: R, currency: "TRY", isActive: true }, select: { id: true }, take: 2 })
    if (tlHesaplar.length < 2) {
      console.log("  ~ iki TL hesap yok — virman adımı atlandı")
    } else {
      const [kaynakHesap, hedefHesap] = tlHesaplar
      const vir = await api("POST", "/api/finans/transactions", {
        companyId: R, accountId: kaynakHesap.id, transferAccountId: hedefHesap.id, type: "TRANSFER", amount: 10, date: "2026-10-04", description: "TEST virman",
      })
      const bacaklar = await prisma.transaction.findMany({
        where: { companyId: R, transferGroupId: vir.body?.transferGroupId ?? "-" },
        select: { id: true, accountId: true, type: true },
      })
      temizlik.virmanlar.push({ ids: bacaklar.map((b) => b.id), kaynak: kaynakHesap.id, hedef: hedefHesap.id, tutar: 10 })
      check("virmanın iki bacağı ortak kimlik taşır", vir.status === 201 && bacaklar.length === 2, `${vir.status} · ${bacaklar.length} bacak`)
      const vf = await fisOf("TRANSACTION", vir.body?.id)
      check(
        "virman fişi karşı kasaya yazılır (PARA + PARA_KARSI)",
        vf && vf.lines.some((l) => l.role === "PARA") && vf.lines.some((l) => l.role === "PARA_KARSI"),
        (vf?.lines ?? []).map((l) => l.role).join(","),
      )
    }

    // Döviz: hesabın para birimi geçer, kur fişi TL'ye çevirir; cari bağı ve kursuz geçmiş tarih reddedilir.
    const usd = await api("POST", "/api/finans/accounts", { companyId: R, name: "TEST USD Hesabı", type: "BANK", currency: "USD" })
    if (usd.body?.id) temizlik.hesaplar.push(usd.body.id)
    const bugun = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date())
    const dov = await api("POST", "/api/finans/transactions", {
      companyId: R, accountId: usd.body.id, type: "INCOME", amount: 100, currency: "TRY", exchangeRate: "34.5", date: bugun, description: "TEST döviz girişi",
    })
    check("dövizli hareket hesabın para birimiyle (USD) ve kuruyla yazıldı", dov.status === 201 && dov.body.currency === "USD" && Number(dov.body.exchangeRate) === 34.5, `${dov.status} ${dov.body?.currency} ${dov.body?.exchangeRate}`)
    if (dov.body?.id) temizlik.hareketler.push(dov.body.id)
    const df = await fisOf("TRANSACTION", dov.body?.id)
    const dPara = df?.lines.find((l) => l.role === "PARA")
    check("fiş TL karşılığıyla (100 × 34,5 = 3.450)", dPara && r2(dPara.amount) === 3450, dPara?.amount ?? "fiş yok")
    const dovCari = await api("POST", "/api/finans/transactions", {
      companyId: R, accountId: usd.body.id, type: "INCOME", amount: 5, exchangeRate: "34.5", customerId: cekMusteri.id, date: bugun,
    })
    check("dövizli hesapta cariye bağlı hareket 400", dovCari.status === 400, `${dovCari.status} ${dovCari.body?.error ?? ""}`)
    if (dovCari.body?.id) temizlik.hareketler.push(dovCari.body.id)
    const dovEski = await api("POST", "/api/finans/transactions", { companyId: R, accountId: usd.body.id, type: "INCOME", amount: 5, date: "2026-09-01" })
    check("kursuz geçmiş tarihli dövizli hareket 400", dovEski.status === 400, `${dovEski.status} ${dovEski.body?.error ?? ""}`)
    if (dovEski.body?.id) temizlik.hareketler.push(dovEski.body.id)

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
    for (const id of temizlik.bordrolar) await prisma.payrollRecord.deleteMany({ where: { id } })
    for (const id of temizlik.cekler) await prisma.check.deleteMany({ where: { id } })
    for (const v of temizlik.virmanlar) {
      // Virman uçtan silinemiyor: bacaklar silinir, iki kasanın bakiyesi geri alınır.
      const { count } = await prisma.transaction.deleteMany({ where: { id: { in: v.ids } } })
      if (count === 2) {
        await prisma.financialAccount.update({ where: { id: v.kaynak }, data: { balance: { increment: v.tutar } } })
        await prisma.financialAccount.update({ where: { id: v.hedef }, data: { balance: { decrement: v.tutar } } })
      }
    }
    for (const id of temizlik.hareketler) await prisma.transaction.deleteMany({ where: { id } })
    for (const id of temizlik.hesaplar) {
      await prisma.transaction.deleteMany({ where: { accountId: id } })
      await prisma.financialAccount.deleteMany({ where: { id } })
    }
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
