/**
 * FATURA E-POSTASI — saf kurallar (istemcide de okunur).
 *
 *   GİDEN  → GİB'e giden e-Fatura / e-Arşiv, carinin kartındaki e-postaya PDF + XML ekli.
 *            Fatura başına TEK otomatik mail; elle "yeniden gönder" her zaman mümkün.
 *   GELEN  → Gelen her e-fatura, hesabı açan kişinin giriş e-postasına AYRI bir mail.
 *
 * Yan kod: giden.server.ts, gelen.server.ts (yazma), cron uç
 * app/api/e-donusum/cron/fatura-eposta (zamanlanmış tarama).
 */

/**
 * OTOMATİK MAİLİN BAŞLANGICI (kullanıcı kararı, 2026-10-06): bu andan ÖNCE kesilmiş ya da
 * gelmiş hiçbir fatura otomatik mail ALMAZ — geçmiş faturalar müşteriye/kurucuya dökülmez.
 *
 * Migrasyonun BASLANGIC işareti tek başına yetmiyordu: (1) migrasyon ile yayın arasında
 * eski kodla kesilen giden belgeler işaretsiz kalıyordu ve taramanın "hiç denenmemiş" yolu
 * onlara mail atardı; (2) ilk tarama Mysoft'tan son 72 saati çeker, o güne kadar hiç
 * senkronlanmamış gelen faturalar "yeni" satır olarak açılıp bildirilirdi.
 *
 * Elle gönderim bu sınıra bakmaz. Belge GİB'e gittiği an tetiklenen otomatik gönderim de
 * bakmaz: o yol ancak yeni kodla, yani bu andan sonra çalışır.
 */
export const OTOMATIK_EPOSTA_BASLANGIC = new Date("2026-10-06T20:50:00+03:00")

/** Gelen faturanın bildirilebileceği en uzun süre (geliş → bildirim). */
export const GELEN_TAZELIK_SAAT = 72
/** Bir mail için en çok deneme; sonra HATA olarak kapanır (sessiz değil: kayıtta durur). */
export const MAX_DENEME = 5
/** Sahiplenilip (GONDERILIYOR) bırakılmış satır bu süreden sonra yeniden denenir. */
export const SAHIPLENME_ZAMAN_ASIMI_DK = 15

const EPOSTA_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>".]{2,}$/

/**
 * Var olmayan alan adları: RFC 2606/6761 ayrılmış uzantılar + test kayıtlarının
 * `.kobipo` uzantısı (canlıda 10 test carisi bu biçimde, 2026-10-06 ölçümü). Bunlara
 * giden mail geri döner; geri dönen her mail gönderen alan adının itibarını düşürür.
 */
const GECERSIZ_UZANTI = new Set(["test", "example", "invalid", "localhost", "local", "kobipo"])
const ORNEK_ALAN = /(^|\.)example\.(com|net|org)$/

function gercekAlanMi(adres: string): boolean {
  const alan = adres.split("@")[1] || ""
  const uzanti = alan.split(".").pop() || ""
  return !GECERSIZ_UZANTI.has(uzanti) && !ORNEK_ALAN.test(alan)
}

export type AdresSonucu =
  | { ok: true; adresler: string[] }
  | { ok: false; sebep: "YOK" | "GECERSIZ" | "GIB_PK" }

/**
 * Carinin e-posta alanından gönderilebilir adresleri çıkarır.
 *
 * GİB posta kutusu etiketi (`urn:mail:defaultpk@…`) e-posta DEĞİLDİR: GİB'in e-Fatura
 * adresidir, arkasında okunan bir kutu yoktur. VKN sorgusu bu etiketleri döndürür ve cari
 * formu onları ayrı alana (eInvoiceAlias) yazar; yine de e-posta alanına elle
 * yapıştırılmış olabilir — mail oraya gitmez, "GIB_PK" sebebiyle durur.
 *
 * Alan birden çok adres taşıyabilir (`a@x.com; b@y.com`): geçerli olanların hepsine
 * gider (en çok 3). Tek bir geçersiz parça diğerlerini engellemez.
 */
export function faturaEpostaAdresi(ham: string | null | undefined): AdresSonucu {
  const metin = (ham || "").trim()
  if (!metin) return { ok: false, sebep: "YOK" }

  const parcalar = metin
    .split(/[,;\s]+/)
    .map((p) => p.trim().replace(/^mailto:/i, ""))
    .filter(Boolean)

  const adresler: string[] = []
  let pkVar = false
  for (const parca of parcalar) {
    if (gibPostaKutusuMu(parca)) {
      pkVar = true
      continue
    }
    if (!EPOSTA_RE.test(parca)) continue
    const kucuk = parca.toLowerCase()
    if (!gercekAlanMi(kucuk)) continue
    if (!adresler.includes(kucuk)) adresler.push(kucuk)
  }

  if (adresler.length > 0) return { ok: true, adresler: adresler.slice(0, 3) }
  return { ok: false, sebep: pkVar ? "GIB_PK" : "GECERSIZ" }
}

/** GİB posta kutusu / gönderici birim etiketi mi? (`urn:mail:…`, `defaultpk@…`, `defaultgb@…`) */
export function gibPostaKutusuMu(adres: string): boolean {
  const a = adres.trim().toLowerCase()
  if (a.startsWith("urn:")) return true
  const yerel = a.split("@")[0] || ""
  return /^default(pk|gb)$/.test(yerel)
}

export const ADRES_SEBEP_METNI: Record<"YOK" | "GECERSIZ" | "GIB_PK", string> = {
  YOK: "Carinin kartında e-posta adresi yok.",
  GECERSIZ: "Carinin kartındaki e-posta adresi geçerli değil.",
  GIB_PK:
    "Carinin kartındaki adres bir GİB posta kutusu etiketi (ör. defaultpk@…); e-posta adresi değildir.",
}

// ---------------------------------------------------------------------------
// GİDEN
// ---------------------------------------------------------------------------

export type GidenBelge = {
  type: string
  invoiceType: string
  status: string
  uuid: string | null
  isReceipt: boolean
}

/**
 * Bu belge alıcısına e-postayla gönderilebilir mi? (otomatik ve elle aynı kapı)
 *
 * Yalnız BİZİM düzenlediğimiz ve GİB'e gitmiş e-belge: alış faturası (PURCHASE) satıcının
 * belgesidir, ona geri mail atılmaz; GİB taslağı / Kayıtlı belge henüz kesilmemiştir.
 */
export function gidenGonderilebilir(b: GidenBelge): { ok: true } | { ok: false; sebep: string } {
  if (b.type === "PURCHASE") return { ok: false, sebep: "Alış faturası bizim düzenlediğimiz belge değildir." }
  if (b.isReceipt) return { ok: false, sebep: "Fiş e-postayla gönderilmez." }
  if (b.invoiceType !== "E_INVOICE" && b.invoiceType !== "E_ARCHIVE") {
    return { ok: false, sebep: "Yalnız e-Fatura ve e-Arşiv belgeleri e-postayla gönderilir." }
  }
  if (b.status !== "SENT" || !b.uuid) {
    return { ok: false, sebep: "Belge henüz GİB'e gönderilmedi; resmî PDF'i yok." }
  }
  return { ok: true }
}

export function belgeTuruAdi(invoiceType: string, type?: string): string {
  const iade = type === "RETURN"
  if (invoiceType === "E_INVOICE") return iade ? "e-Fatura (İade)" : "e-Fatura"
  if (invoiceType === "E_ARCHIVE") return iade ? "e-Arşiv Fatura (İade)" : "e-Arşiv Fatura"
  return "Fatura"
}

// ---------------------------------------------------------------------------
// GELEN
// ---------------------------------------------------------------------------

/** Faturanın bize ulaştığı an: gönderilme (zarf) tarihi; yoksa belge tarihi; o da yoksa ilk görüldüğü an. */
export function gelisZamani(r: { sentDate: Date | null; docDate: Date | null; createdAt: Date }): Date {
  return r.sentDate ?? r.docDate ?? r.createdAt
}

export type GelenKarar = "GONDER" | "ESKI" | "HATA_SON"

/**
 * Gelen fatura için bildirim kararı.
 *
 * TAZELİK neden var: gelen kutusu elle "son 1 yıl" diye senkronlanabilir ya da yeni
 * bağlanan firmanın ilk senkronu yüzlerce eski faturayı birden getirir. Bunlar "yeni
 * fatura geldi" değildir; mail olarak dökülmeleri bildirimin kendisini değersizleştirir.
 * Ölçü geliş anıdır (Mysoft'un dönem filtresi de gönderim tarihine göre çalışır).
 *
 * Denenmiş ama gidememiş bir bildirim tazeliği aşınca ESKI değil HATA_SON olur: başarısız
 * gönderim "eski fatura" diye sessizce kaybolmasın.
 *
 * `baslangic` = OTOMATIK_EPOSTA_BASLANGIC (sunucu verir; testler kendi anını verir).
 */
export function gelenBildirimKarari(p: {
  gelis: Date
  simdi: Date
  deneme: number
  baslangic: Date
}): GelenKarar {
  if (p.deneme >= MAX_DENEME) return "HATA_SON"
  if (p.gelis < gelenBildirimSiniri(p.simdi, p.baslangic)) return p.deneme > 0 ? "HATA_SON" : "ESKI"
  return "GONDER"
}

/** Bu andan önce gelmiş fatura bildirilmez: tazelik sınırı ile başlangıçtan GEÇ olanı. */
export function gelenBildirimSiniri(simdi: Date, baslangic: Date): Date {
  const taze = new Date(simdi.getTime() - GELEN_TAZELIK_SAAT * 3_600_000)
  return taze > baslangic ? taze : baslangic
}

export type Uyelik = {
  userId: string
  email: string | null
  createdAt: Date
  isSuperAdmin: boolean
}

/**
 * HESABI AÇAN KİŞİ: hesap kök firmasındaki EN ESKİ yönetici üyeliği.
 *
 * Firmada "sahip" kolonu yok; kurucu üyeliği firma açılışında yazılır
 * (lib/company/create-company.ts). Süper-admin müşteri adına kabuk açtığında üyelik
 * almaz, ilk davet edilen müşteri kurucu olur. Süper-admin (Kobipo/bayi personeli) sonradan
 * yönetici eklenmiş olsa da kurucu sayılmaz: müşterinin faturası personelin kutusuna düşmesin.
 * Kurucu üyeliği kaldırılmışsa sıradaki en eski yönetici devralır.
 */
export function hesapKurucusu(uyelikler: Uyelik[]): Uyelik | null {
  const adaylar = uyelikler
    .filter((u) => !u.isSuperAdmin && (u.email || "").trim())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return adaylar[0] ?? null
}

export function profilAdi(profile: string | null | undefined): string | null {
  const p = (profile || "").toUpperCase()
  if (p === "TICARIFATURA") return "Ticari"
  if (p === "TEMELFATURA") return "Temel"
  if (p === "KAMU") return "Kamu"
  if (p === "IHRACAT") return "İhracat"
  return profile || null
}
