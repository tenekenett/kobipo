#!/usr/bin/env node

// Fiş OCR sağlayıcı karşılaştırma tezgâhı.
//
// NEDEN VAR: "hangi model fişlerimizi daha iyi okuyor" sorusunun cevabı
// benchmark tablolarında YOK. OCRBench İngilizce/Çince belgelerle ölçüyor;
// bizim girdimiz Türkçe yazarkasa fişi — soluk termal baskı, kıvrık kenar,
// standart olmayan kalem adları ("DMTS PYNR" = domates püresi). Tek geçerli
// ölçüm kendi fişlerinle yapılandır.
//
// ŞEMA/PROMPT İKİZİ: uygulama tarafındaki kopya `lib/fis-ocr/schema.ts`'te yaşıyor
// (bu dosya bilerek uygulamadan bağımsız kalıyor, TS modülü import edemiyor).
// BİRİNİ DEĞİŞTİREN ÖTEKİNİ DE DEĞİŞTİRMELİ — ayrışırlarsa ölçtüğün prompt ile
// üretimde koşan prompt farklılaşır ve buradaki sayılar yalan söylemeye başlar.
//
// Aynı görsel + aynı prompt ile N modeli koşturur, sonucu ve GERÇEK maliyeti
// yan yana basar. Uygulamaya hiç bağlı değil (Prisma/Next import etmez) —
// sağlayıcı kararı vermeden önce çalışsın diye.
//
// Kullanım:
//   node scripts/ai-fis-test.mjs --dir ./fis-ornekleri
//   node scripts/ai-fis-test.mjs --dir ./fis-ornekleri \
//     --model qwen/qwen2.5-vl-72b-instruct,google/gemini-2.5-flash-lite
//
// Doğruluk ölçümü: bir görselin yanına <isim>.dogru.json koyarsan (elle
// doldurulmuş gerçek değerler) script alan alan karşılaştırıp yüzde verir.
// Bu dosya olmadan da çalışır; o zaman yalnız çıktıyı ve maliyeti gösterir.

import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })
dotenv.config()

const API = "https://openrouter.ai/api/v1/chat/completions"
// ÖLÇÜMLE seçildi (2026-09-02, üç fişli kare): Gemini ailesi rakamları kusursuz
// okudu; Qwen2.5-VL ise KDV'yi KDV-dahil toplamın ÜSTÜNE ekledi (525,58 -> 613,18),
// POS slipinin markasını ("Ödeal") kalem sandı ve bir TCKN'yi tümden kaçırdı.
// Varsayılan, ölçümün kazananı olmalı — aksi halde "hızlıca bir koştur" diyen
// herkes en kötü modelle ölçer.
const VARSAYILAN_MODEL = "google/gemini-2.5-flash"

// ---------------------------------------------------------------- argümanlar

function argv(ad, varsayilan = null) {
  const i = process.argv.indexOf("--" + ad)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan
}

const dizin = argv("dir", "./fis-ornekleri")
const modeller = argv("model", VARSAYILAN_MODEL).split(",").map((m) => m.trim())
const uzunKenar = Number(argv("px", "1568"))
const cikti = argv("out", "./fis-test-sonuc")
// Düşünme seviyesi. Gemini 3.x ailesinde akıl yürütme ZORUNLU (kapatılamıyor:
// "Reasoning is mandatory for this endpoint"), ama seviyesi kısılabiliyor ve
// düşünme tokenları ÇIKTI olarak faturalanıyor — 3.7-flash'ta varsayılan ayar
// maliyetin yarısından fazlasını buraya yakıyor. Veri çıkarma akıl yürütme işi
// olmadığı için kısmanın bedava olması beklenir; beklenti değil ÖLÇÜM karar versin.
const akil = argv("akil", null) // low | medium | high

// -------------------------------------------------------------------- şema

// Fişten çıkarılacak alanlar. Sağlayıcı json_schema destekliyorsa şema olarak
// gider (parse garantisi); desteklemiyorsa şemasız tekrar denenir.
//
// DİZİ olmasının sebebi: kullanıcı fişleri masaya dizip tek kare çekiyor
// (gerçek örnek: bir fotoğrafta akaryakıt fişi + restoran fişi). Tek fiş
// dönen şema bu girdide ya birini kaybeder ya ikisini birbirine karıştırır.
const FIS_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "saticiUnvan", "vknTckn", "tarih", "fisNo",
    "kalemler", "araToplam", "kdvToplam", "genelToplam", "guven",
  ],
  properties: {
    saticiUnvan: { type: ["string", "null"] },
    vknTckn: {
      type: ["string", "null"],
      description: "10 hane VKN veya 11 hane TCKN, yalnız rakam",
    },
    tarih: { type: ["string", "null"], description: "YYYY-MM-DD" },
    fisNo: { type: ["string", "null"] },
    kalemler: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ad", "miktar", "birimFiyat", "kdvOrani", "tutar"],
        properties: {
          ad: { type: "string" },
          miktar: { type: ["number", "null"] },
          birimFiyat: { type: ["number", "null"] },
          kdvOrani: { type: ["number", "null"], description: "1, 10 veya 20" },
          tutar: { type: ["number", "null"], description: "KDV dahil satır toplamı" },
        },
      },
    },
    araToplam: { type: ["number", "null"] },
    kdvToplam: { type: ["number", "null"] },
    genelToplam: { type: ["number", "null"] },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["satici", "tarih", "toplam", "kalemler"],
      properties: {
        satici: { type: "number" },
        tarih: { type: "number" },
        toplam: { type: "number" },
        kalemler: { type: "number" },
      },
    },
  },
}

const SEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fisler"],
  properties: { fisler: { type: "array", items: FIS_SEMA } },
}

const PROMPT = [
  "Sen Türkçe yazarkasa fişi ve perakende satış fişi okuyan bir veri çıkarma aracısın.",
  "",
  "Görselde BİRDEN FAZLA fiş olabilir (masaya yan yana dizilmiş). Her mali fiş için",
  '"fisler" dizisine ayrı bir nesne ekle. Tek fiş varsa dizi tek elemanlı olur.',
  "",
  "BANKA SLİPİNİ AYRI BELGE SAY: mali fişin altında çoğu zaman POS slipi basılıdır",
  "(TERMİNAL NO, ONAY KODU, REFERANS NO, KART TURU, SATIS, banka logosu). Bu slip",
  "AYRI bir fiş DEĞİLDİR ve içindeki TUTAR satırı bir kalem DEĞİLDİR — tamamen yok say.",
  "Ödeme bilgisi zaten mali fişin kendisinde yazıyor.",
  "",
  "VKN'Yİ MERSIS NUMARASIYLA KARIŞTIRMA: fişte çoğu zaman ikisi de yazar ve MERSIS",
  "numarası VKN'yi İÇİNDE barındırır (MERSIS 0660004943800011 -> VKN 6600049438).",
  '"VKN/TCKN" veya "VD"/"VERGİ DAİRESİ" satırındaki numarayı al; MERSIS satırından',
  "hane sayarak VKN türetmeye çalışma.",
  "",
  "Kurallar:",
  "- SADECE fişte GÖRÜNEN veriyi çıkar. Okuyamadığın alana null yaz, TAHMİN ETME.",
  '- Tutarlar sayı olsun: "1.234,56" -> 1234.56 (Türkçe binlik nokta, ondalık virgül).',
  '- Tarih YYYY-MM-DD olsun, saat EKLEME. İki haneli yıl 26 -> 2026.',
  '- KDV oranı Türkiye\'de 1, 10 veya 20\'dir. Fişte "%08" gibi eski oran varsa olduğu gibi yaz.',
  "- TOPKDV ve TOPLAM'ı KARIŞTIRMA. Yazarkasa fişlerinde tutar, etiketinin bir üst",
  "  satırında basılabilir. Kontrol et: TOPKDV = TOPLAM x oran / (100 + oran).",
  "  Tutmuyorsa satırları yanlış eşlemişsindir, yeniden bak.",
  "- Kalem adlarını fişteki KISALTILMIŞ haliyle bırak, açmaya çalışma.",
  "- İskonto/promosyon satırlarını da kalem olarak yaz (tutarı negatif).",
  '- "guven" alanına her grup için 0-1 arası kendi güvenini yaz. Okunaksızsa düşük ver;',
  "  bu skor insan kontrolüne yönlendirmek için kullanılıyor, iyimser olma.",
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

// --------------------------------------------------------------- yardımcılar

const PARA = (n) => (n == null ? "—" : "$" + n.toFixed(5))
const say = (s, n) => String(s).padEnd(n).slice(0, n)

function jsonAyikla(metin) {
  // Model bazen kod bloğuyla sarar, bazen başına cümle ekler, bazen de şemayı
  // yok sayıp düz DİZİ döner. Bu yüzden hem {...} hem [...] denenir: yalnız
  // {...} aramak diziyi "{...},{...}" diye kesip geçersiz JSON üretiyordu.
  const adaylar = []
  const ilkObj = metin.indexOf("{")
  const sonObj = metin.lastIndexOf("}")
  const ilkDizi = metin.indexOf("[")
  const sonDizi = metin.lastIndexOf("]")
  // Dizi önce gelmişse önce onu dene (obje, dizinin elemanı olabilir).
  if (ilkDizi !== -1 && sonDizi > ilkDizi && (ilkObj === -1 || ilkDizi < ilkObj)) {
    adaylar.push(metin.slice(ilkDizi, sonDizi + 1))
  }
  if (ilkObj !== -1 && sonObj > ilkObj) adaylar.push(metin.slice(ilkObj, sonObj + 1))

  for (const aday of adaylar) {
    try {
      return JSON.parse(aday)
    } catch {
      /* sıradaki adayı dene */
    }
  }
  throw new Error("yanıt JSON'a çevrilemedi")
}

async function modeleSor(model, b64, mime, semaKullan = true, deneme = 0) {
  const govde = {
    model,
    messages: [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:" + mime + ";base64," + b64 } },
          { type: "text", text: "Bu fişi çıkar." },
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0,
    // OpenRouter gerçek maliyeti döndürsün — kendi fiyat tablomu tutmaktan iyi;
    // sağlayıcı fiyatı değiştirdiğinde script yalan söylemez.
    usage: { include: true },
  }
  if (akil) govde.reasoning = { effort: akil }
  if (semaKullan) {
    govde.response_format = {
      type: "json_schema",
      json_schema: { name: "fis", strict: true, schema: SEMA },
    }
    // OpenRouter yalnız response_format'ı GERÇEKTEN destekleyen sağlayıcıya
    // yönlendirsin. Bu bayrak olmadan desteklemeyen sağlayıcı 400 dönmüyor,
    // şemayı SESSİZCE yok sayıyor: model kendi uydurduğu alan adlarıyla
    // ("fis_no", "urunler"...) cevap veriyor ve hata ancak parse'ta ortaya
    // çıkıyor. Gerçek koşumda tam olarak bu oldu (sağlayıcı: Nebius).
    govde.provider = { require_parameters: true }
  }

  const r = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
      "Content-Type": "application/json",
      "X-Title": "Kobipo fis OCR testi",
    },
    body: JSON.stringify(govde),
  })

  if (!r.ok) {
    const hata = await r.text()
    // Üstteki sağlayıcının geçici tıkanması. Açık model sağlayıcıları birinci
    // taraf API'lerden belirgin şekilde kırılgan — ilk gerçek koşumda Parasail
    // 429, Nebius 504 verdi. Üretimde de bu döngü gerekecek.
    if ([429, 500, 502, 503, 504].includes(r.status) && deneme < 2) {
      await new Promise((c) => setTimeout(c, 3000 * (deneme + 1)))
      return modeleSor(model, b64, mime, semaKullan, deneme + 1)
    }
    // Şema isteyip sağlayıcı bulunamazsa (require_parameters) ya da model
    // şemayı reddederse şemasız dene: amaç modeli elemek değil, ham okuma
    // kalitesini yine de ölçebilmek.
    if ((r.status === 400 || r.status === 404) && semaKullan) {
      return modeleSor(model, b64, mime, false, deneme)
    }
    throw new Error(r.status + " " + hata.slice(0, 200))
  }

  const j = await r.json()
  const metin = j.choices?.[0]?.message?.content ?? ""

  let ham
  try {
    ham = jsonAyikla(metin)
  } catch (e) {
    // Ham yanıtı hataya iliştir: parse hatasının sebebi ancak modelin ne
    // döndürdüğüne bakarak anlaşılıyor (şema yok sayılmış mı, kesilmiş mi).
    const err = new Error(e.message + " [finish=" + j.choices?.[0]?.finish_reason + "]")
    err.ham = metin
    throw err
  }

  // Şemayı yok sayan sağlayıcı düz dizi ya da tek fiş dönebilir; tek biçime indir.
  const veri = Array.isArray(ham)
    ? { fisler: ham }
    : Array.isArray(ham.fisler)
      ? ham
      : { fisler: [ham] }

  return { veri, usage: j.usage ?? {}, semaliydi: semaKullan, saglayici: j.provider ?? "?" }
}

// ----------------------------------------------------------- doğruluk ölçümü

// Türkçe harfleri KATLAR (ö->o, ş->s, ı->i ...). Sebebi: model termal baskıda
// aksanı sık düşürüyor ("ÖNDER" -> "ONDER") ama bu, tedarikçi eşleştirmesini
// bozmayan zararsız bir sapma — gerçek eşleştirme de bulanık yapılacak.
// Katlamazsak ölçüm bu sapmayı ciddi hatalarla aynı kefeye koyup yanıltır.
const TR_KATLA = { ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c", â: "a", î: "i", û: "u" }
const sadeMetin = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[ğüşıöçâîû]/g, (h) => TR_KATLA[h])
    .replace(/[^a-z0-9]/g, "")

// KDV aritmetiği kendini tutar: TOPKDV = TOPLAM x oran / (100 + oran).
//
// NEDEN ÖNEMLİ: bu, GERÇEK DEĞER DOSYASI OLMADAN çalışan tek doğrulama. Modelin
// bu belge türündeki en sık hatası "etiket/değer kayması" — yazarkasa tutarı
// etiketinin bir üst satırına basıyor, satır satır okuyan model TOPKDV yerine
// TOPLAM'ı alıyor. Aritmetik bunu yakalar. Üretimde de aynı kural geçerli:
// tutmuyorsa modelin güven skoru ne derse desin fişi insana sor.
function kdvTutarliMi(fis) {
  const toplam = Number(fis.genelToplam)
  const kdv = Number(fis.kdvToplam)
  if (!Number.isFinite(toplam) || !Number.isFinite(kdv) || toplam === 0) return null
  const oranlar = [
    ...new Set((fis.kalemler ?? []).map((k) => Number(k.kdvOrani)).filter(Boolean)),
  ]
  // Karma oranlı fişte tek formül geçmez; o fişi bu yolla doğrulayamayız.
  if (oranlar.length !== 1) return null
  const beklenen = (toplam * oranlar[0]) / (100 + oranlar[0])
  return Math.abs(beklenen - kdv) < 0.05
}

// Çıkan fişi gerçek değerle EŞLEŞTİR — sırayla değil.
//
// NEDEN: model, karedeki fişleri hangi sırayla döndüreceğini garanti etmiyor
// (soldan sağa, tutara göre, rastgele). İndeksle eşlersen KUSURSUZ bir okuma bile
// üç fişlik karede %0 alabilir; tezgâh o zaman okuma kalitesini değil sıralamayı
// ölçer ve model seçimini yanlış yönlendirir. Önce VKN (fişteki tek benzersiz
// anahtar), tutmazsa genel toplam, ikisi de yoksa eşleşmemiş say.
function dogruEsle(fis, dogruFisler, kullanilan) {
  const bos = (i) => !kullanilan.has(i)
  const rakam = (v) => String(v ?? "").replace(/\D/g, "")

  const vkn = rakam(fis.vknTckn)
  if (vkn) {
    const i = dogruFisler.findIndex((d, i) => bos(i) && rakam(d.vknTckn) === vkn)
    if (i !== -1) return i
  }

  const toplam = Number(fis.genelToplam)
  if (Number.isFinite(toplam)) {
    const i = dogruFisler.findIndex(
      (d, i) => bos(i) && Math.abs(Number(d.genelToplam) - toplam) < 0.01
    )
    if (i !== -1) return i
  }

  return -1
}

// Model tarihi bazen ISO datetime döndürüyor ("2026-08-27T21:57:00"). GÜN doğru
// okunmuştur; saat eki üretimde tek satırlık normalizasyonla düşer. Bunu hata
// saymak modeli okuma kalitesi yüzünden değil BİÇİM yüzünden cezalandırır ve
// sıralamayı bozar: ilk koşumda Qwen3-VL tam da bu yüzden %47 görünüyordu,
// oysa üç fişin de tarihini doğru okumuştu. Ham fiş biçimi ("27-08-2026") ise
// kısalmadan kalır ve hata sayılmaya devam eder — orada gerçekten uymamıştır.
const tarihSade = (t) => (typeof t === "string" ? t.slice(0, 10) : t)

function dogrulukOlc(cikan, dogru) {
  const esit = (a, b) => sadeMetin(a) === sadeMetin(b) && sadeMetin(a) !== ""
  const sayiEsit = (a, b) =>
    a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01

  // Ünvanın tek doğru cevabı olmayabilir: fişin başlığında işletme adı ("KULÜBE"),
  // VD satırında tüzel kişi ("OGUZCAN OGUZ") yazar. İkisi de DOĞRU okumadır.
  // Gerçek değer dosyasındaki "saticiUnvanAlt" listesi kabul edilenleri sayar;
  // liste yoksa davranış eskisiyle aynı. Bu olmadan tezgâh, modelin doğru okuduğu
  // bir alanı hata sayıp sıralamayı bozar.
  const unvanlar = [dogru.saticiUnvan, ...(dogru.saticiUnvanAlt ?? [])]

  const kontrol = [
    ["satici", unvanlar.some((u) => esit(cikan.saticiUnvan, u))],
    ["vkn", esit(cikan.vknTckn, dogru.vknTckn)],
    ["tarih", tarihSade(cikan.tarih) === tarihSade(dogru.tarih)],
    ["toplam", sayiEsit(cikan.genelToplam, dogru.genelToplam)],
    ["kdv", sayiEsit(cikan.kdvToplam, dogru.kdvToplam)],
    ["kalemSayisi", (cikan.kalemler?.length ?? 0) === (dogru.kalemler?.length ?? 0)],
  ]

  // Kalem adları küme olarak: sıra farkı hata sayılmasın, eksik/uydurma sayılsın.
  const cikanAd = new Set((cikan.kalemler ?? []).map((k) => sadeMetin(k.ad)))
  const dogruAd = new Set((dogru.kalemler ?? []).map((k) => sadeMetin(k.ad)))
  const kesisim = [...dogruAd].filter((a) => cikanAd.has(a)).length
  const kalemOran = dogruAd.size ? kesisim / dogruAd.size : 1

  const gecen = kontrol.filter(([, v]) => v).length
  return {
    kontrol,
    yuzde: Math.round(((gecen / kontrol.length) * 0.6 + kalemOran * 0.4) * 100),
  }
}

// --------------------------------------------------------------------- ana

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("❌ OPENROUTER_API_KEY yok (.env.local)")
    process.exit(1)
  }
  if (!fs.existsSync(dizin)) {
    console.error("❌ Klasör yok: " + dizin)
    console.error("   Fiş fotoğraflarını bu klasöre koy ve tekrar çalıştır.")
    process.exit(1)
  }

  const gorseller = fs
    .readdirSync(dizin)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort()

  if (!gorseller.length) {
    console.error("❌ " + dizin + " içinde görsel yok")
    process.exit(1)
  }

  fs.mkdirSync(cikti, { recursive: true })
  console.log("\n" + gorseller.length + " fiş × " + modeller.length + " model\n")

  const ozet = []

  for (const model of modeller) {
    console.log("\n━━━ " + model)
    let toplamMaliyet = 0
    let toplamSure = 0
    let basarili = 0
    let toplamFis = 0
    let kdvHatali = 0
    const yuzdeler = []

    for (const dosya of gorseller) {
      // Küçültme testin PARÇASI, ön hazırlık değil: üretimde de küçülteceğiz
      // (ham telefon fotoğrafı ~14 kat fazla token). Modeli göndereceğimiz
      // gerçek girdiyle ölçmezsek ölçüm yalan olur.
      const buf = await sharp(path.join(dizin, dosya))
        .rotate()
        .resize({ width: uzunKenar, height: uzunKenar, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()

      const t0 = Date.now()
      const temelAd = path.parse(dosya).name + "__" + model.replace(/[/:]/g, "_")
      let sonuc = null
      let hata = null
      try {
        sonuc = await modeleSor(model, buf.toString("base64"), "image/jpeg")
      } catch (e) {
        hata = e.message
        // Ham yanıtı diske yaz — parse hatasının sebebi ancak buradan anlaşılır.
        if (e.ham) fs.writeFileSync(path.join(cikti, temelAd + ".HAM.txt"), e.ham)
      }
      const sure = (Date.now() - t0) / 1000
      toplamSure += sure

      if (hata) {
        console.log("  " + say(dosya, 26) + "❌ " + hata)
        continue
      }
      basarili++

      const maliyet = sonuc.usage.cost ?? null
      if (maliyet) toplamMaliyet += maliyet

      fs.writeFileSync(
        path.join(cikti, temelAd + ".json"),
        JSON.stringify(sonuc.veri, null, 2)
      )

      // Gerçek değer dosyası varsa doğruluk ölç. Tek fiş için düz nesne de kabul
      // edilir — elle doldururken her seferinde "fisler" sarmalamak zorunda kalma.
      const dogruYol = path.join(dizin, path.parse(dosya).name + ".dogru.json")
      let dogruFisler = null
      if (fs.existsSync(dogruYol)) {
        const ham = JSON.parse(fs.readFileSync(dogruYol, "utf8"))
        dogruFisler = ham.fisler ?? [ham]
      }

      const fisler = sonuc.veri.fisler ?? []
      toplamFis += fisler.length
      // Bir gerçek fiş yalnız bir kez eşleşsin: model aynı fişi iki kez döndürürse
      // (yan yana duran fişlerde oluyor) ikincisi kopya sayılıp %0 alsın.
      const kullanilanDogru = new Set()
      console.log(
        "  " + say(dosya, 26) +
          say(fisler.length + " fiş", 8) +
          say(sure.toFixed(1) + "s", 8) +
          say(PARA(maliyet), 11) +
          say(sonuc.saglayici, 12) +
          (sonuc.semaliydi ? "" : "⚠ şemasız")
      )

      fisler.forEach((fis) => {
        const guvenler = Object.values(fis.guven ?? {}).filter((v) => typeof v === "number")
        const enDusuk = guvenler.length ? Math.min(...guvenler) : null
        const kdvOk = kdvTutarliMi(fis)
        if (kdvOk === false) kdvHatali++

        let dogrulukEtiket = ""
        if (dogruFisler) {
          const eslesen = dogruEsle(fis, dogruFisler, kullanilanDogru)
          if (eslesen === -1) {
            // Uydurma ya da kopya fiş: ölçüye 0 girer. Sessizce atlarsak model
            // hayali fiş üretip ortalamayı yükseltebilirdi.
            yuzdeler.push(0)
            dogrulukEtiket = "%0 (eşleşmedi)"
          } else {
            kullanilanDogru.add(eslesen)
            const d = dogrulukOlc(fis, dogruFisler[eslesen])
            yuzdeler.push(d.yuzde)
            const hatalar = d.kontrol.filter(([, v]) => !v).map(([k]) => k)
            dogrulukEtiket = "%" + d.yuzde + (hatalar.length ? " (" + hatalar.join(",") + ")" : "")
          }
        }

        console.log(
          "      → " + say(fis.saticiUnvan ?? "?", 26) +
            say((fis.kalemler?.length ?? 0) + " kalem", 9) +
            say(fis.genelToplam != null ? Number(fis.genelToplam).toFixed(2) + " TL" : "—", 12) +
            say("güven " + (enDusuk != null ? enDusuk.toFixed(2) : "—"), 12) +
            say(kdvOk === null ? "kdv —" : kdvOk ? "kdv ✓" : "kdv ✗", 8) +
            dogrulukEtiket
        )
      })
    }

    ozet.push({
      model,
      toplamMaliyet,
      toplamSure,
      basarili,
      toplamFis,
      kdvHatali,
      adet: gorseller.length,
      ortDogruluk: yuzdeler.length
        ? Math.round(yuzdeler.reduce((a, b) => a + b, 0) / yuzdeler.length)
        : null,
    })
  }

  // ------------------------------------------------------------- özet tablo
  console.log("\n\n" + "═".repeat(88))
  console.log(
    say("MODEL", 34) + say("fiş başına", 12) + say("1000 fiş", 11) +
    say("süre/kare", 11) + say("bulunan", 9) + say("kdv✗", 7) + "doğruluk"
  )
  console.log("─".repeat(88))
  for (const o of ozet) {
    // Maliyet çağrı (=kare) başına oluşur; fiş başına maliyet için bulunan fiş
    // sayısına bölünür. Bir karede iki fiş varsa birim maliyet yarıya iner —
    // "fişleri tek karede çek" tavsiyesinin sayısal karşılığı budur.
    const birim = o.toplamFis ? o.toplamMaliyet / o.toplamFis : 0
    console.log(
      say(o.model, 34) +
        say(PARA(birim), 12) +
        say("$" + (birim * 1000).toFixed(2), 11) +
        say((o.toplamSure / o.adet).toFixed(1) + "s", 11) +
        say(o.toplamFis + " fiş", 9) +
        say(String(o.kdvHatali), 7) +
        (o.ortDogruluk != null ? "%" + o.ortDogruluk : "— (.dogru.json yok)")
    )
  }
  console.log("═".repeat(88))
  console.log("kdv✗ = TOPKDV aritmetiği tutmayan fiş sayısı (gerçek değer dosyası gerekmez)")
  console.log("Çıktılar: " + cikti + "/\n")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
