/**
 * BELGE → TASLAK YEVMİYE FİŞİ — kural motoru. Saf modül (Prisma yok), testli.
 *
 * Plan: `docs/muhasebe/MOTOR-PLAN.md`. Motor fişin SATIRLARINI kurar; kaydetmek,
 * hesabı firmanın planında çözmek ve onay muhasebe motorunun 2. fazındadır.
 *
 * ── İlkeler ─────────────────────────────────────────────────────────────────
 * - Fiş belgenin muhasebe karşılığıdır: tutar belgeden gelir, motor vergi
 *   HESAPLAMAZ. Kalem değerleri belgedeki hâliyle okunur — fatura altı iskonto
 *   satırlara dağıtılmış (`belgedekiKalem`, KDV raporuyla aynı kural).
 * - Hangi belge fişe girer: KDV'ye giren belgeyle AYNI küme (`kdvyeGirerMi`) —
 *   iptal, faturaya dönüşmüş fiş ve GİB'e gitmemiş e-belge taslağı girmez.
 * - Fiş her zaman DENGELİDİR: cari satırı diğer satırların farkıdır. Belgenin
 *   kendi toplamıyla farkı `belgeFarki`nda bilgi olarak döner (kuruş).
 * - Hesap bilinmiyorsa satır HESAPSIZ kalır (`hesapKodu: null`) ve `oneriKodu`
 *   taşır; fiş onaylanamaz. Sessizce yanlış hesaba yazılmaz.
 * - Öğrenilen eşleşmeler motorun GİRDİSİDİR (`HesapEslesmeleri`): satışta ürüne,
 *   alışta ürüne, ürünsüz kalemde cari + KDV oranına göre. Her satır, hesabı
 *   değiştirilirse neyin öğrenileceğini `anahtarlar`da taşır.
 *
 * ── Hesaplar ────────────────────────────────────────────────────────────────
 *   Satış:  120 B (toplam) · 600 A (matrah) · 391 A (KDV − alıcının tevkif ettiği)
 *           · 360 A (ÖTV ve matraha giren/girmeyen diğer vergiler: ÖİV, GEKAP…)
 *   Alış:   153 B stoklu ürün / 770 B hizmet ve serbest kalem (maliyet: matrah +
 *           ÖTV + diğer vergi — indirilemez vergiler maliyete girer)
 *           · 191 B (KDV'nin TAMAMI) · 320 A (toplam) · 360 A (bizim tevkif
 *           ettiğimiz KDV, KDV-2 ile ödenir)
 *   İade:   aynı fişin tersi; satış iadesinde gelir yerine 610 Satıştan İadeler.
 *   Yuvarlama (fişlerin faturaya birleşmesi): lehimize 649, aleyhimize 659.
 */

import { kdvyeGirerMi } from "@/lib/raporlar/kdv-kural"
import { belgedekiKalem, faturaAltiCarpani, type KayitliKalem } from "@/lib/raporlar/fatura-alti"
import {
  satirEminMi,
  type FisSatiri,
  type HazirFis,
  type HesapEslesmeleri,
  type SatirRolu,
  type Taraf,
} from "@/lib/muhasebe/fis"

export type { FisSatiri, HesapEslesmeleri, HesapKaynagi, SatirRolu, Taraf } from "@/lib/muhasebe/fis"

export type FisKalemi = KayitliKalem & {
  productId?: string | null
  /** Ürün kartı hizmet mi; kartsız (serbest) kalemde null. */
  urunHizmetMi?: boolean | null
  exciseAmount?: unknown
}

export type FisBelgesi = {
  id: string
  no: string
  tarih: Date | string
  type: string
  returnKind?: string | null
  isReceipt: boolean
  status: string
  invoiceType: string
  currency?: string | null
  exchangeRate?: unknown
  globalDiscountAmount?: unknown
  globalChargeAmount?: unknown
  payableRoundingAmount?: unknown
  totalAmount: unknown
  /** Satışta müşteri, alışta tedarikçi; carisiz (perakende) belgede null. */
  /**
   * `tur` verilirse cari o türdür: karşı yönlü (mahsup) belgede — müşteriye kesilen alış,
   * tedarikçiye kesilen satış — cari bakiyesi belgeyi DOLU olan carinin hesabına yazar
   * (lib/cari/bakiye-asof.ts); fiş de oraya yazmalı.
   */
  cari: { id: string; ad: string; tur?: "musteri" | "tedarikci" } | null
  kalemler: FisKalemi[]
}

export type FisTaslagi =
  | (HazirFis & {
      belgeId: string
      /** Cari satırı − belgenin TL toplamı (kuruş yuvarlaması; bilgi). */
      belgeFarki: number
    })
  | { durum: "fise-girmez"; sebep: string }
  | { durum: "kur-yok"; sebep: string }

const VARSAYILAN = {
  musteri: "120",
  tedarikci: "320",
  satis: "600",
  satisIade: "610",
  stokluAlis: "153",
  giderAlis: "770",
  hesaplananKdv: "391",
  indirilecekKdv: "191",
  odenecekVergi: "360",
  yuvarlamaGelir: "649",
  yuvarlamaGider: "659",
} as const

const ROL_SIRASI: SatirRolu[] = [
  "CARI",
  "SATIS",
  "SATIS_IADE",
  "ALIS",
  "KDV_HESAPLANAN",
  "KDV_INDIRILECEK",
  "TEVKIFAT",
  "OTV",
  "DIGER_VERGI",
  "YUVARLAMA",
]

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100
const ters = (t: Taraf): Taraf => (t === "B" ? "A" : "B")

/** Oranı anahtara yazarken "20", "20.00", 20 aynı anahtar olsun. */
const oranAnahtari = (oran: unknown) => String(num(oran))

type HamSatir = Omit<FisSatiri, "tutar"> & { tutar: number }

export function belgeFisTaslagi(belge: FisBelgesi, eslesme: HesapEslesmeleri): FisTaslagi {
  if (
    !kdvyeGirerMi({
      type: belge.type,
      returnKind: belge.returnKind,
      status: belge.status,
      invoiceType: belge.invoiceType,
    })
  ) {
    return {
      durum: "fise-girmez",
      sebep: "İptal edilmiş, faturaya dönüşmüş ya da GİB'e gönderilmemiş belge fişe girmez.",
    }
  }

  const tip = String(belge.type || "").toUpperCase()
  const iade = tip === "RETURN"
  const alis = tip === "PURCHASE" || (iade && String(belge.returnKind || "").toUpperCase() === "PURCHASE")

  const paraBirimi = String(belge.currency || "TRY").toUpperCase()
  const kur = paraBirimi === "TRY" ? 1 : num(belge.exchangeRate)
  if (!(kur > 0)) {
    return { durum: "kur-yok", sebep: `${paraBirimi} belgenin kuru girilmemiş; TL karşılığı bilinmeden fiş kurulamaz.` }
  }

  // Satırlar (rol, taraf, hesap, açıklama) bazında birleşir; her kalem ayrı satır
  // olsaydı 30 kalemli fatura 30 satış satırı üretirdi. Açıklama anahtarda: KDV
  // oranları ("%20", "%10") aynı 391'e düşse de AYRI satır kalır — birleşseydi
  // satırın hesabını değiştiren kullanıcı iki orana birden öğretirdi (müşavirlerin
  // çoğu oran başına alt hesap açar).
  //
  // EKSİ tutar ATILMAZ: kullanıcılar indirimi eksi fiyatlı bir kalemle girebiliyor
  // ("İNDİRİM", −100). Aynı satırdaki artıyla netleşir; net eksi kalırsa satır
  // aşağıda karşı tarafa geçer. (Atılsaydı fiş belgeden indirim kadar sapıyordu —
  // canlıda FS-ALI-2026-0009, 100 TL.)
  const birlesik = new Map<string, HamSatir>()
  const ekle = (s: Omit<HamSatir, "tutar"> & { tutar: number }) => {
    if (Math.abs(s.tutar) < 0.000001) return
    const anahtar = `${s.rol}|${s.taraf}|${s.hesapKodu ?? "∅"}|${s.oneriKodu}|${s.aciklama}`
    const mevcut = birlesik.get(anahtar)
    if (mevcut) {
      mevcut.tutar += s.tutar
      for (const a of s.anahtarlar) if (!mevcut.anahtarlar.includes(a)) mevcut.anahtarlar.push(a)
    } else {
      birlesik.set(anahtar, { ...s, anahtarlar: [...s.anahtarlar] })
    }
  }

  /** Öğrenilmiş hesap varsa o, yoksa varsayılan. */
  const coz = (anahtarlar: string[], varsayilan: string) => {
    for (const a of anahtarlar) {
      const kod = eslesme.ogrenilen[a]
      if (kod) return { hesapKodu: kod, kaynak: "ogrenilen" as const }
    }
    return { hesapKodu: varsayilan, kaynak: "varsayilan" as const }
  }

  const carpan = faturaAltiCarpani(belge.kalemler, belge)
  for (const k of belge.kalemler) {
    const b = belgedekiKalem(k, carpan)
    const otv = num(k.exciseAmount) * carpan
    // Toplamdaki KDV dışı vergiler (ÖTV + diğer vergi + GEKAP): toplam = net +
    // vergiler + KDV − tevkifat.
    const vergiler = b.toplam - b.net - b.kdv + b.tevkifat
    const digerVergi = vergiler - otv
    const oran = oranAnahtari(k.vatRate)

    if (!alis) {
      const urunAnahtari = k.productId ? [`${iade ? "satis-iade" : "satis"}:urun:${k.productId}`] : []
      ekle({
        taraf: "A",
        tutar: b.net,
        rol: iade ? "SATIS_IADE" : "SATIS",
        ...coz(urunAnahtari, iade ? VARSAYILAN.satisIade : VARSAYILAN.satis),
        oneriKodu: iade ? VARSAYILAN.satisIade : VARSAYILAN.satis,
        anahtarlar: urunAnahtari,
        aciklama: iade ? "Satıştan iade" : "Satış",
      })
      const kdvAnahtari = [`satis:kdv:${oran}`]
      ekle({
        taraf: "A",
        // Alıcının tevkif ettiği kısım satıcının 391'ine girmez (alıcı KDV-2 ile öder).
        tutar: b.kdv - b.tevkifat,
        rol: "KDV_HESAPLANAN",
        ...coz(kdvAnahtari, VARSAYILAN.hesaplananKdv),
        oneriKodu: VARSAYILAN.hesaplananKdv,
        anahtarlar: kdvAnahtari,
        aciklama: `Hesaplanan KDV %${oran}`,
      })
      ekle({
        taraf: "A",
        tutar: otv,
        rol: "OTV",
        ...coz(["satis:otv"], VARSAYILAN.odenecekVergi),
        oneriKodu: VARSAYILAN.odenecekVergi,
        anahtarlar: ["satis:otv"],
        aciklama: "ÖTV",
      })
      ekle({
        taraf: "A",
        tutar: digerVergi,
        rol: "DIGER_VERGI",
        ...coz(["satis:diger-vergi"], VARSAYILAN.odenecekVergi),
        oneriKodu: VARSAYILAN.odenecekVergi,
        anahtarlar: ["satis:diger-vergi"],
        aciklama: "Diğer vergiler",
      })
    } else {
      // En özel anahtar öğrenilir: ürün kartı varsa ürün, yoksa cari + KDV oranı.
      const ogrenme = k.productId
        ? [`alis:urun:${k.productId}`]
        : belge.cari
          ? [`alis:cari-kdv:${belge.cari.id}:${oran}`]
          : []
      // Ürünlü kalemde de cari + oran eşleşmesi yedek olarak sorulur.
      const arama = k.productId && belge.cari ? [...ogrenme, `alis:cari-kdv:${belge.cari.id}:${oran}`] : ogrenme
      const varsayilan = k.productId && k.urunHizmetMi === false ? VARSAYILAN.stokluAlis : VARSAYILAN.giderAlis
      ekle({
        taraf: "B",
        // İndirilemeyen vergiler (ÖTV, ÖİV, GEKAP…) alışta maliyete girer.
        tutar: b.net + vergiler,
        rol: "ALIS",
        ...coz(arama, varsayilan),
        oneriKodu: varsayilan,
        anahtarlar: ogrenme,
        aciklama: varsayilan === VARSAYILAN.stokluAlis ? "Mal alışı" : "Gider / hizmet alışı",
      })
      const kdvAnahtari = [`alis:kdv:${oran}`]
      ekle({
        taraf: "B",
        // İndirilecek KDV faturadaki KDV'nin TAMAMIdır (kdv-kural ile aynı).
        tutar: b.kdv,
        rol: "KDV_INDIRILECEK",
        ...coz(kdvAnahtari, VARSAYILAN.indirilecekKdv),
        oneriKodu: VARSAYILAN.indirilecekKdv,
        anahtarlar: kdvAnahtari,
        aciklama: `İndirilecek KDV %${oran}`,
      })
      ekle({
        taraf: "A",
        tutar: b.tevkifat,
        rol: "TEVKIFAT",
        ...coz(["alis:tevkifat"], VARSAYILAN.odenecekVergi),
        oneriKodu: VARSAYILAN.odenecekVergi,
        anahtarlar: ["alis:tevkifat"],
        aciklama: "Sorumlu sıfatıyla ödenecek KDV (tevkifat)",
      })
    }
  }

  // Belge yuvarlaması (fişler faturaya birleşirken): tahsil/ödenen tutarı değiştirir,
  // KDV'ye dokunmaz. Satışta artı = lehimize gelir; alışta artı = aleyhimize gider.
  const yuvarlama = num(belge.payableRoundingAmount)
  if (Math.abs(yuvarlama) > 0.000001) {
    const lehimize = alis ? yuvarlama < 0 : yuvarlama > 0
    const kod = lehimize ? VARSAYILAN.yuvarlamaGelir : VARSAYILAN.yuvarlamaGider
    ekle({
      // Gelir (649) alacağa, gider (659) borca; iadede fiş sonra tümden döner.
      taraf: lehimize ? "A" : "B",
      tutar: Math.abs(yuvarlama),
      rol: "YUVARLAMA",
      ...coz([], kod),
      oneriKodu: kod,
      anahtarlar: [],
      aciklama: "Belge yuvarlaması",
    })
  }

  // TL'ye çevir, kuruşa yuvarla; net eksi satır karşı tarafa, iadede taraflar döner.
  const satirlar: FisSatiri[] = []
  for (const s of birlesik.values()) {
    const tutar = r2(s.tutar * kur)
    if (tutar === 0) continue
    const taraf = tutar < 0 ? ters(s.taraf) : s.taraf
    satirlar.push({ ...s, tutar: Math.abs(tutar), taraf: iade ? ters(taraf) : taraf })
  }

  // Cari satırı fişi dengeler ve BELGE TOPLAMIDIR: cari bakiyesi ve ödemeler o tutarı
  // kapatır. Satırların kuruşa yuvarlanmış toplamı belgeden kuruş sapabilir (belge her
  // kalemi ayrı yuvarlar; fiş KDV oranı bazında birleştirir): sapma en büyük gelir/gider
  // satırına katılır, KDV'ye dokunulmaz — KDV raporuyla aynı kalsın. Canlı ölçüm
  // (2026-10-04): 1.091 fişte 4 cari 1–3 kuruş sapıyordu.
  const toplam = (t: Taraf) => satirlar.filter((s) => s.taraf === t).reduce((a, s) => a + s.tutar, 0)
  let fark = r2(toplam("A") - toplam("B"))
  const belgeToplami = r2(num(belge.totalAmount) * kur)
  const sapma = r2(belgeToplami - Math.abs(fark))
  if (fark !== 0 && sapma !== 0 && Math.abs(sapma) <= Math.max(0.05, 0.01 * belge.kalemler.length)) {
    const cariTaraf: Taraf = fark > 0 ? "B" : "A"
    const hedef = satirlar
      .filter((s) => s.taraf !== cariTaraf && (s.rol === "SATIS" || s.rol === "SATIS_IADE" || s.rol === "ALIS"))
      .sort((a, b) => b.tutar - a.tutar)[0]
    if (hedef && hedef.tutar + sapma > 0) {
      hedef.tutar = r2(hedef.tutar + sapma)
      fark = r2(toplam("A") - toplam("B"))
    }
  }
  const cariTuru = belge.cari?.tur ?? (alis ? "tedarikci" : "musteri")
  const cariHesabi = belge.cari ? eslesme.cariHesaplari[belge.cari.id] ?? null : null
  const cariOneri = cariTuru === "tedarikci" ? VARSAYILAN.tedarikci : VARSAYILAN.musteri
  if (fark !== 0) {
    satirlar.push({
      taraf: fark > 0 ? "B" : "A",
      tutar: Math.abs(fark),
      rol: "CARI",
      hesapKodu: cariHesabi,
      oneriKodu: cariOneri,
      kaynak: cariHesabi ? "cari" : "yok",
      anahtarlar: [],
      aciklama: belge.cari ? belge.cari.ad : alis ? "Tedarikçi (cari yok)" : "Perakende (cari yok)",
      // Çözüm katmanı cari alt hesabını buradan açar/bulur; carisiz belge ortak
      // "perakende / diğer satıcılar" alt hesabına yazılır.
      alt: {
        tur: cariTuru,
        id: belge.cari?.id ?? null,
        ad: belge.cari?.ad ?? (alis ? "Diğer Satıcılar" : "Perakende Müşteriler"),
      },
    })
  }

  satirlar.sort(
    (a, b) =>
      (a.taraf === b.taraf ? 0 : a.taraf === "B" ? -1 : 1) || ROL_SIRASI.indexOf(a.rol) - ROL_SIRASI.indexOf(b.rol),
  )

  const cariSatiri = satirlar.find((s) => s.rol === "CARI")
  const turAdi = iade ? (alis ? "alış iadesi" : "satış iadesi") : alis ? "alış" : belge.isReceipt ? "satış fişi" : "satış"

  return {
    durum: "hazir",
    belgeId: belge.id,
    tarih: new Date(belge.tarih),
    aciklama: [belge.no, turAdi, belge.cari?.ad].filter(Boolean).join(" · "),
    tur: "MAHSUP",
    satirlar,
    borcToplami: r2(toplam("B")),
    alacakToplami: r2(toplam("A")),
    // Cari satırı hesabı çözülmemişse (alt hesap henüz açılmadıysa) çözüm katmanı
    // açar; burada yalnız hesabı belli olmayan ya da riskli varsayılan satır engeller.
    emin: satirlar.every((s) => (s.rol === "CARI" && s.hesapKodu === null ? true : satirEminMi(s))),
    belgeFarki: r2((cariSatiri?.tutar ?? 0) - belgeToplami),
  }
}
