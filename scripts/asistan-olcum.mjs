#!/usr/bin/env node

// İşletme asistanı model karşılaştırma tezgâhı.
//
// NEDEN VAR: "hangi model işletme verisi üzerine daha iyi konuşur" sorusunun
// cevabı hazır benchmark'larda YOK. Ölçülen şey ne genel zekâ ne kodlama:
// (1) aracın döndürdüğü rakamı DEĞİŞTİRMEDEN söylemek, (2) veri olmadığında
// susmak, (3) doğru aracı doğru parametreyle çağırmak. Üçü de bu uygulamanın
// kendi araç kümesine ve kendi verisine bağlı.
//
// FİŞ TARAMA TEZGÂHINDAN FARKI: orada girdi bir görseldi ve script uygulamadan
// bağımsız koşabiliyordu. Burada girdi CANLI FİRMA VERİSİ — araçlar Prisma'ya,
// yetki kapısına ve yaşlandırma raporuna bağlı. Bu yüzden script modeli doğrudan
// çağırmaz; çalışan uygulamanın kendi ucuna (`/api/asistan/sohbet`) `model`
// parametresiyle gider. Ölçülen şey böylece ÜRETİMDE KOŞAN yol oluyor.
//
// OTOMATİK ÖLÇÜT — "kaynaksız sayı":
//   Cevaptaki her sayı, o sohbette çağrılan araçların çıktısında ya da brifing
//   sinyallerinde geçmeli. Geçmiyorsa işaretlenir.
//
//   DİKKAT, BU BİR SKOR DEĞİL İPUCUDUR. Meşru olduğu hâlde işaretlenen sayılar
//   var: "90 gün"ü "3 ay" diye yazmak, iki rakamı toplayıp "toplam 5 ürün"
//   demek, yüzdeyi kendi hesaplaması. Liste İNSAN OKUSUN diye basılıyor;
//   otomatik olarak "şu model %92 doğru" demek yanıltıcı olurdu.
//
// Kullanım:
//   node scripts/asistan-olcum.mjs --company ornek-market --email a@b.c --password ***
//   node scripts/asistan-olcum.mjs --company ornek-market --email ... --password ... \
//     --model anthropic/claude-opus-5,google/gemini-3.7-flash
//
// Sunucu varsayılan olarak http://localhost:3000; --base ile değiştirilir.
// Sorular --sorular ile ayrı bir JSON dosyasından da verilebilir.

import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })
dotenv.config()

// ---------------------------------------------------------------- argümanlar

function argv(ad, varsayilan = null) {
  const i = process.argv.indexOf("--" + ad)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan
}

const base = (argv("base", "http://localhost:3000") || "").replace(/\/$/, "")
const company = argv("company")
const email = argv("email", process.env.OLCUM_EMAIL)
const password = argv("password", process.env.OLCUM_PASSWORD)
const ciktiDizin = argv("out", "./asistan-olcum-sonuc")

// Katalogla AYNI listede tutulmalı (`lib/asistan/modeller.ts`). Ayrışırsa burada
// ölçülen model üretimde seçilemez, üretimdeki model hiç ölçülmemiş olur.
const VARSAYILAN_MODELLER = [
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "google/gemini-3.7-flash",
  "google/gemini-2.5-flash",
]

const modeller = (argv("model") || VARSAYILAN_MODELLER.join(","))
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean)

if (!company || !email || !password) {
  console.error(
    "Eksik argüman.\n" +
      "  node scripts/asistan-olcum.mjs --company <slug|id> --email <e-posta> --password <parola>\n" +
      "E-posta/parola OLCUM_EMAIL / OLCUM_PASSWORD ortam değişkenlerinden de okunur."
  )
  process.exit(1)
}

// ------------------------------------------------------------------- sorular
//
// Set bilerek karışık: ikisi brifingden doğrudan cevaplanabilir (araç
// çağırmadan), ikisi tek araç ister, ikisi iki araç ister, biri de CEVAPSIZ
// olmalı — "bilmiyorum" diyebilen model, her soruya bir şey uyduran modelden
// iyidir ve bunu ölçmenin tek yolu cevabı olmayan bir soru sormaktır.

const VARSAYILAN_SORULAR = [
  { soru: "Bugün nelere dikkat etmeliyim?", bekleme: "brifingi özetlemeli, uydurma rakam olmamalı" },
  { soru: "Bu ay geçen aya göre nasıl gidiyoruz?", bekleme: "donem_ozeti çağırmalı" },
  { soru: "En çok kazandıran ürünüm hangisi?", bekleme: "satis_siralamasi olcut=kar" },
  { soru: "6 aydır satılmayan ürünleri listele", bekleme: "hareketsiz_stok gun=180" },
  { soru: "Hangi müşterilerden alacağım gecikti?", bekleme: "vadesi_gecenler taraf=musteri" },
  {
    soru: "En çok satan ürünüm aynı zamanda en kârlısı mı?",
    bekleme: "iki kez satis_siralamasi (ciro + kar) çağırıp karşılaştırmalı",
  },
  {
    soru: "Önümüzdeki çeyrekte cirom ne olur?",
    bekleme: "TAHMİN YAPMAMALI — veriye dayanmayan öngörü sunmadığını söylemeli",
  },
]

const sorularDosyasi = argv("sorular")
const sorular = sorularDosyasi
  ? JSON.parse(fs.readFileSync(sorularDosyasi, "utf-8"))
  : VARSAYILAN_SORULAR

// -------------------------------------------------------------------- oturum
//
// Tarayıcının yaptığının aynısı: CSRF al, kimlik bilgisiyle POST et, çerezi
// sakla. Ölçüm için ayrı bir kimlik doğrulama kapısı AÇILMADI — açılsaydı
// üretim kodunda ölçüm amaçlı bir bypass yaşardı ve orada kalırdı.

const cerezler = new Map()

function cerezYaz(setCookie) {
  if (!setCookie) return
  const liste = Array.isArray(setCookie) ? setCookie : [setCookie]
  for (const satir of liste) {
    const [ciftler] = satir.split(";")
    const esit = ciftler.indexOf("=")
    if (esit === -1) continue
    cerezler.set(ciftler.slice(0, esit).trim(), ciftler.slice(esit + 1).trim())
  }
}

function cerezBasligi() {
  return Array.from(cerezler.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

async function istek(yol, secenek = {}) {
  const yanit = await fetch(base + yol, {
    ...secenek,
    headers: {
      ...(secenek.headers || {}),
      ...(cerezler.size > 0 ? { Cookie: cerezBasligi() } : {}),
    },
    redirect: "manual",
  })
  cerezYaz(yanit.headers.getSetCookie?.() ?? yanit.headers.get("set-cookie"))
  return yanit
}

async function girisYap() {
  const csrfYanit = await istek("/api/auth/csrf")
  const { csrfToken } = await csrfYanit.json()

  const govde = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: base + "/dashboard",
    json: "true",
  })

  const yanit = await istek("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: govde.toString(),
  })

  const oturumVar = Array.from(cerezler.keys()).some((k) => k.includes("session-token"))
  if (!oturumVar) {
    throw new Error(
      `Giriş başarısız (HTTP ${yanit.status}). E-posta/parolayı ve sunucunun ayakta olduğunu kontrol edin.`
    )
  }
}

// ------------------------------------------------------------------ sayı işi

/** JSON ağacındaki tüm sayıları toplar (araç çıktısı derin iç içe olabilir). */
function sayilariTopla(deger, kume = new Set()) {
  if (typeof deger === "number" && Number.isFinite(deger)) {
    kume.add(deger)
  } else if (typeof deger === "string") {
    for (const s of metindenSayilar(deger)) kume.add(s)
  } else if (Array.isArray(deger)) {
    for (const e of deger) sayilariTopla(e, kume)
  } else if (deger && typeof deger === "object") {
    for (const e of Object.values(deger)) sayilariTopla(e, kume)
  }
  return kume
}

/**
 * Türkçe biçimli sayıları metinden çeker: "42.800,50", "%23,9", "118".
 *
 * Tarih parçaları (2026, 09, 03) elenmiyor — eleseydik "2026 TL" gibi meşru
 * tutarları da kaçırırdık. İnsan okurken ayırt ediyor.
 */
function metindenSayilar(metin) {
  const bulunan = []
  const kalip = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g
  for (const eslesme of String(metin).matchAll(kalip)) {
    const ham = eslesme[0]
    const sayi = Number(ham.replace(/\./g, "").replace(",", "."))
    if (Number.isFinite(sayi)) bulunan.push(sayi)
  }
  return bulunan
}

/** İki sayı "aynı" mı? Yuvarlama ve yüzde hassasiyeti için pay bırakılır. */
function ayniMi(a, b) {
  if (a === b) return true
  if (Math.round(a) === Math.round(b)) return true
  const buyuk = Math.max(Math.abs(a), Math.abs(b))
  if (buyuk === 0) return false
  return Math.abs(a - b) / buyuk < 0.01
}

function kaynaksizSayilar(cevap, kaynakKumesi) {
  const kaynaklar = Array.from(kaynakKumesi)
  return metindenSayilar(cevap).filter((s) => !kaynaklar.some((k) => ayniMi(k, s)))
}

// -------------------------------------------------------------------- koşum

async function soruSor(model, soru) {
  const t0 = Date.now()
  const yanit = await istek("/api/asistan/sohbet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: company, soru, model, olcum: true, gecmis: [] }),
  })

  const govde = await yanit.json().catch(() => null)
  if (!yanit.ok) {
    return { hata: govde?.error || `HTTP ${yanit.status}`, sureMs: Date.now() - t0 }
  }
  return { ...govde, sureMs: Date.now() - t0 }
}

async function main() {
  console.log(`Sunucu : ${base}`)
  console.log(`Firma  : ${company}`)
  console.log(`Modeller: ${modeller.join(", ")}`)
  console.log(`Soru sayısı: ${sorular.length}\n`)

  await girisYap()
  console.log("Giriş yapıldı.\n")

  fs.mkdirSync(ciktiDizin, { recursive: true })
  const rapor = []

  for (const model of modeller) {
    console.log(`\n=== ${model} ===`)
    const modelSonuc = { model, sorular: [], toplamMaliyet: 0, toplamSure: 0, hataSayisi: 0 }

    for (const { soru, bekleme } of sorular) {
      process.stdout.write(`  · ${soru.slice(0, 46).padEnd(48)}`)
      const sonuc = await soruSor(model, soru)

      if (sonuc.hata) {
        console.log(`HATA: ${sonuc.hata}`)
        modelSonuc.hataSayisi++
        modelSonuc.sorular.push({ soru, bekleme, hata: sonuc.hata })
        continue
      }

      const kaynak = sayilariTopla({
        araclar: (sonuc.araclar || []).map((a) => a.cikti),
        sinyaller: sonuc.brifingSinyalleri || [],
      })
      const kaynaksiz = kaynaksizSayilar(sonuc.cevap, kaynak)
      const maliyet = sonuc.kullanim?.maliyetUsd ?? 0

      modelSonuc.toplamMaliyet += maliyet
      modelSonuc.toplamSure += sonuc.sureMs
      modelSonuc.sorular.push({
        soru,
        bekleme,
        cevap: sonuc.cevap,
        araclar: (sonuc.araclar || []).map((a) => ({ ad: a.ad, girdi: a.girdi })),
        kaynaksizSayilar: kaynaksiz,
        kullanim: sonuc.kullanim,
      })

      const aracAdlari = (sonuc.araclar || []).map((a) => a.ad).join("+") || "araçsız"
      console.log(
        `${String(sonuc.sureMs).padStart(6)}ms  ${aracAdlari.padEnd(34)} ` +
          `${kaynaksiz.length > 0 ? `⚠ ${kaynaksiz.length} kaynaksız sayı` : "✓"}  ` +
          `$${maliyet.toFixed(4)}`
      )
    }

    rapor.push(modelSonuc)
  }

  // -------------------------------------------------------------- özet tablo

  console.log("\n\n=== ÖZET ===")
  console.log(
    "model".padEnd(34) +
      "süre/soru".padStart(11) +
      "maliyet".padStart(11) +
      "kaynaksız".padStart(11) +
      "hata".padStart(6)
  )
  for (const r of rapor) {
    const basarili = r.sorular.filter((s) => !s.hata)
    const kaynaksizToplam = basarili.reduce((t, s) => t + (s.kaynaksizSayilar?.length ?? 0), 0)
    console.log(
      r.model.padEnd(34) +
        `${Math.round(r.toplamSure / Math.max(basarili.length, 1))}ms`.padStart(11) +
        `$${r.toplamMaliyet.toFixed(4)}`.padStart(11) +
        String(kaynaksizToplam).padStart(11) +
        String(r.hataSayisi).padStart(6)
    )
  }

  const dosya = path.join(ciktiDizin, `olcum-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`)
  fs.writeFileSync(dosya, JSON.stringify({ base, company, tarih: new Date().toISOString(), rapor }, null, 2))
  console.log(`\nAyrıntılı sonuç: ${dosya}`)
  console.log(
    "\nKARARI SAYI VERMEZ. Cevapları dosyadan okuyun: tavsiye somut mu, uydurma\n" +
      "rakam var mı, cevabı olmayan soruda susabilmiş mi. 'Kaynaksız sayı' sütunu\n" +
      "yalnız nereye bakacağınızı gösterir — meşru olanları da işaretler."
  )
}

main().catch((e) => {
  console.error("\nÖlçüm başarısız:", e.message)
  process.exit(1)
})
