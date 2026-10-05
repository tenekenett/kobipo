/**
 * PARA HAREKETLERİ → TASLAK YEVMİYE FİŞİ — 3. faz kuralları. Saf modül (Prisma yok).
 *
 * Plan: `docs/muhasebe/MOTOR-PLAN.md` §3. Kaynakların hepsi cari bakiyesinin
 * kaynaklarıyla AYNIDIR (lib/cari/bakiye-asof.ts): fatura (fis-kurallari.ts),
 * kasaya bağlanmamış fatura ödemesi, cariye bağlı kasa hareketi, çek/senet, cari
 * virman fişi, açılış bakiyesi. Böylece mizandaki 120/320 alt hesap bakiyesi carinin
 * bakiyesine eşit kalır (canlı test ölçer).
 *
 *   Kasa/banka hareketi  giriş: B kasa · A karşı        çıkış: B karşı · A kasa
 *     karşı =  cari (120/320 alt hesabı) | çek/senet tahsili (101/121, 103/321)
 *              | personel (335, masraf iadesi / maaş ödemesi) | hesaplar arası virman
 *              (karşı kasa) | carisiz faturanın ödemesi (ortak perakende alt hesabı)
 *              | faturasız gelir 649 / gider 770 (kategoriye göre ÖĞRENİLİR)
 *   Kasasız ödeme        bakiye kapama (611 / 649), çalışan cebinden (335), eski kayıt
 *   Çek / senet          alınan: B 101/121 · A cari     verilen: B cari · A 103/321
 *   Çek cirosu           B tedarikçi (seçilir) · A 101
 *   Cari virman          B borç bacağı carisi · A alacak bacağı carisi
 *   Bordro (tahakkuk)    B 770 brüt · A 361 SGK · A 360 vergi · A 369 diğer · A 196 avans · A 335 net
 *   Açılış bakiyeleri    cari kartı / kasa hesabı başlangıçtan SONRA açıldıysa kendi tarihinde
 *
 * Döviz: kasa hareketinde kur tutulmuyor → TL dışı hareket fişe girmez ("kur-yok",
 * ekran sayar). Fatura ödemesi faturanın kuruyla çevrilir (fatura fişiyle aynı kur).
 */

import {
  altSatir,
  fisKur,
  hesapSec,
  istanbulGunu,
  num,
  r2,
  type AltHesapRef,
  type FisSatiri,
  type FisSonucu,
  type FisTuru,
  type HesapEslesmeleri,
  type Taraf,
} from "@/lib/muhasebe/fis"

type Kayit = { id: string; ad: string }
type FinansHesabi = { id: string; ad: string; tur: string }

const paraRef = (h: FinansHesabi): AltHesapRef => ({ tur: "finans", id: h.id, ad: h.ad, altTur: h.tur })
const paraKodu = (tur: string) => (tur === "CASH" ? "100" : tur === "CREDIT_CARD" ? "309" : "102")
const anahtarParcasi = (s: string | null | undefined) =>
  (s ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ") || "-"

const kurYok = (paraBirimi: string): FisSonucu => ({
  durum: "kur-yok",
  sebep: `${paraBirimi} hareketin kuru tutulmuyor; TL karşılığı bilinmeden fiş kurulamaz.`,
})

// ── Kasa / banka hareketi ────────────────────────────────────────────────────

export type HareketGirdisi = {
  id: string
  tarih: Date | string
  tip: string // INCOME | EXPENSE | TRANSFER
  tutar: unknown
  paraBirimi?: string | null
  /** Dövizli hareketin kuru (1 birim = ? TL); TRY'de yok. */
  kur?: unknown
  aciklama?: string | null
  kategori?: string | null
  hesap: FinansHesabi
  musteri?: Kayit | null
  tedarikci?: Kayit | null
  /** Carisiz bir faturanın ödemesi (perakende fiş tahsilatı): ortak alt hesaba. */
  carisizFaturaOdemesi?: { alis: boolean } | null
  /** CEK:/SENET: referanslı tahsil/ödeme. */
  kiymet?: { tur: "CEK" | "SENET"; yon: "RECEIVED" | "GIVEN"; no: string } | null
  /** Masraf iadesi (CALISAN:) ya da bordro ödemesi. */
  personel?: Kayit | null
  /** Hesaplar arası virman: kaynak bacağın hedef kasası (eşleşmişse). */
  virmanHedefi?: FinansHesabi | null
  /** Virmanın giriş bacağı ve kaynak bacağı bulundu → bu bacak fişe girmez. */
  virmanGirisBacagi?: boolean
  /** Eşleşmemiş giriş bacağının kaynak kasası (referanstan). */
  virmanKaynagi?: FinansHesabi | null
  /** Hareket virman bacağı mı (tip TRANSFER ya da TRANSFER: referanslı giriş). */
  virman?: boolean
  /**
   * Hareketin kasası BAŞKA bir firmanın (veri tutarsızlığı — canlıda 1 kayıt,
   * 2026-10-04). Kasa satırı o firmanın alt hesabına yazılamaz: hesapsız kalır ve
   * fiş "Gözden geçir"e düşer; sessizce atlanmaz.
   */
  yabanciKasa?: boolean
}

export function hareketFisi(h: HareketGirdisi, eslesme: HesapEslesmeleri): FisSonucu {
  const paraBirimi = String(h.paraBirimi || "TRY").toUpperCase()
  // Dövizli hareket TL karşılığıyla girer (kur hareketle yazılır — lib/finans/doviz-hareket.ts);
  // kuru olmayan eski/dış kayıt "kur yok" olarak mutabakatta görünür, sessizce atlanmaz.
  const kur = paraBirimi === "TRY" ? 1 : num(h.kur)
  if (!(kur > 0)) return kurYok(paraBirimi)
  const tutar = r2(num(h.tutar) * kur)
  const dovizNotu = paraBirimi === "TRY" ? "" : ` (${num(h.tutar).toLocaleString("tr-TR")} ${paraBirimi} × ${kur.toLocaleString("tr-TR")})`
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Tutarsız hareket." }
  if (h.virmanGirisBacagi) {
    return { durum: "fise-girmez", sebep: "Hesaplar arası virmanın giriş bacağı; virman kaynak bacağıyla tek fişte." }
  }

  const tip = String(h.tip || "").toUpperCase()
  const giris = tip === "INCOME"
  const paraTaraf: Taraf = giris ? "B" : "A"
  const karsiTaraf: Taraf = giris ? "A" : "B"
  const satirlar: FisSatiri[] = [
    h.yabanciKasa
      ? {
          taraf: paraTaraf,
          tutar,
          rol: "KARSI",
          hesapKodu: null,
          oneriKodu: paraKodu(h.hesap.tur),
          kaynak: "yok",
          anahtarlar: [],
          aciklama: `${h.hesap.ad} — kasa başka firmaya ait, hesabı seçin`,
        }
      : altSatir({
          taraf: paraTaraf,
          tutar,
          rol: "PARA",
          oneriKodu: paraKodu(h.hesap.tur),
          aciklama: h.hesap.ad,
          alt: paraRef(h.hesap),
        }),
  ]
  let aciklama = h.aciklama?.trim() || ""
  let tur: FisTuru = h.hesap.tur === "CASH" ? (giris ? "TAHSIL" : "TEDIYE") : "MAHSUP"

  if (h.virman || tip === "TRANSFER") {
    tur = "MAHSUP"
    const karsi = giris ? h.virmanKaynagi : h.virmanHedefi
    if (karsi) {
      satirlar.push(
        altSatir({ taraf: karsiTaraf, tutar, rol: "PARA_KARSI", oneriKodu: paraKodu(karsi.tur), aciklama: karsi.ad, alt: paraRef(karsi) }),
      )
      aciklama ||= giris ? `Virman: ${karsi.ad} → ${h.hesap.ad}` : `Virman: ${h.hesap.ad} → ${karsi.ad}`
    } else {
      satirlar.push({
        taraf: karsiTaraf,
        tutar,
        rol: "KARSI",
        hesapKodu: null,
        oneriKodu: "102",
        kaynak: "yok",
        anahtarlar: [],
        aciklama: "Virmanın karşı kasası bulunamadı — seçin",
      })
      aciklama ||= "Hesaplar arası virman"
    }
  } else if (h.kiymet) {
    const alinan = h.kiymet.yon === "RECEIVED"
    const kod = h.kiymet.tur === "CEK" ? (alinan ? "101" : "103") : alinan ? "121" : "321"
    satirlar.push({
      taraf: karsiTaraf,
      tutar,
      rol: "KIYMET",
      ...hesapSec(eslesme, [], kod),
      oneriKodu: kod,
      anahtarlar: [],
      aciklama: `${h.kiymet.tur === "CEK" ? "Çek" : "Senet"} ${h.kiymet.no}`,
    })
    aciklama ||= `${h.kiymet.tur === "CEK" ? "Çek" : "Senet"} ${h.kiymet.no} ${alinan ? "tahsili" : "ödemesi"}`
  } else if (h.personel) {
    satirlar.push(
      altSatir({
        taraf: karsiTaraf,
        tutar,
        rol: "PERSONEL",
        oneriKodu: "335",
        aciklama: h.personel.ad,
        alt: { tur: "personel", id: h.personel.id, ad: h.personel.ad },
      }),
    )
    aciklama ||= `${h.personel.ad} — personel ödemesi`
  } else if (h.musteri || h.tedarikci) {
    const musteri = Boolean(h.musteri)
    const cari = (h.musteri ?? h.tedarikci)!
    satirlar.push(
      altSatir({
        taraf: karsiTaraf,
        tutar,
        rol: "CARI",
        oneriKodu: musteri ? "120" : "320",
        aciklama: cari.ad,
        alt: { tur: musteri ? "musteri" : "tedarikci", id: cari.id, ad: cari.ad },
      }),
    )
    aciklama ||= `${cari.ad} — ${giris ? "tahsilat" : "ödeme"}`
  } else if (h.carisizFaturaOdemesi) {
    const alis = h.carisizFaturaOdemesi.alis
    satirlar.push(
      altSatir({
        taraf: karsiTaraf,
        tutar,
        rol: "CARI",
        oneriKodu: alis ? "320" : "120",
        aciklama: alis ? "Diğer Satıcılar" : "Perakende Müşteriler",
        alt: { tur: alis ? "tedarikci" : "musteri", id: null, ad: alis ? "Diğer Satıcılar" : "Perakende Müşteriler" },
      }),
    )
    aciklama ||= alis ? "Carisiz alış ödemesi" : "Perakende satış tahsilatı"
  } else {
    // Faturasız gelir/gider: hesap KATEGORİYE göre öğrenilir (kira → 770.01 …).
    const kategori = anahtarParcasi(h.kategori)
    const anahtar = giris ? `gelir:kategori:${kategori}` : `gider:kategori:${kategori}`
    const varsayilan = giris ? "649" : "770"
    satirlar.push({
      taraf: karsiTaraf,
      tutar,
      rol: giris ? "GELIR" : "GIDER",
      ...hesapSec(eslesme, [anahtar], varsayilan),
      oneriKodu: varsayilan,
      anahtarlar: [anahtar],
      aciklama: h.kategori?.trim() || (giris ? "Faturasız gelir" : "Faturasız gider"),
    })
    aciklama ||= h.kategori?.trim() || (giris ? "Faturasız gelir" : "Faturasız gider")
  }

  return fisKur({ tarih: istanbulGunu(h.tarih), aciklama: `${aciklama}${dovizNotu}`, tur, satirlar })
}

// ── Kasaya bağlanmamış fatura ödemesi ────────────────────────────────────────

export type OdemeGirdisi = {
  id: string
  tarih: Date | string
  tutar: unknown
  yontem: string // WRITE_OFF | EMPLOYEE | CASH …
  fatura: {
    no: string
    type: string
    returnKind?: string | null
    status: string
    paraBirimi?: string | null
    kur?: unknown
    /** `tur`: karşı yönlü (mahsup) belgede dolu olan carinin türü (fis-kurallari ile aynı). */
    cari: (Kayit & { tur?: "musteri" | "tedarikci" }) | null
  }
  /** Eski kayıt: kanal verilmiş ama Transaction yazılmamış. */
  hesap?: FinansHesabi | null
  /** Çalışan cebinden ödedi. */
  personel?: Kayit | null
}

export function odemeFisi(o: OdemeGirdisi, eslesme: HesapEslesmeleri): FisSonucu {
  if (["CANCELLED", "CONVERTED"].includes(String(o.fatura.status).toUpperCase())) {
    // Cari bakiyesi iptal/dönüşmüş faturanın ödemesini de saymaz (bakiye-asof `inv` kümesi).
    return { durum: "fise-girmez", sebep: "İptal edilmiş ya da faturaya dönüşmüş belgenin ödemesi." }
  }
  const tip = String(o.fatura.type).toUpperCase()
  const iade = tip === "RETURN"
  const alis = tip === "PURCHASE" || (iade && String(o.fatura.returnKind || "").toUpperCase() === "PURCHASE")
  const paraBirimi = String(o.fatura.paraBirimi || "TRY").toUpperCase()
  const kur = paraBirimi === "TRY" ? 1 : num(o.fatura.kur)
  if (!(kur > 0)) return { durum: "kur-yok", sebep: `${paraBirimi} faturanın kuru girilmemiş.` }
  const tutar = r2(num(o.tutar) * kur)
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Tutarsız ödeme." }

  // Ödeme carinin bakiyesini KAPATIR: satışta cari alacağa, alışta borca; iadede ters.
  const cariTaraf: Taraf = alis !== iade ? "B" : "A"
  const karsiTaraf: Taraf = cariTaraf === "B" ? "A" : "B"
  const cariRef: AltHesapRef = {
    tur: o.fatura.cari?.tur ?? (alis ? "tedarikci" : "musteri"),
    id: o.fatura.cari?.id ?? null,
    ad: o.fatura.cari?.ad ?? (alis ? "Diğer Satıcılar" : "Perakende Müşteriler"),
  }
  const satirlar: FisSatiri[] = [
    altSatir({ taraf: cariTaraf, tutar, rol: "CARI", oneriKodu: cariRef.tur === "tedarikci" ? "320" : "120", aciklama: cariRef.ad, alt: cariRef }),
  ]
  const yontem = String(o.yontem).toUpperCase()
  let aciklama: string
  let tur: FisTuru = "MAHSUP"
  if (yontem === "WRITE_OFF") {
    // Verilen iskonto (satış) gider; alınan iskonto (alış) gelir.
    const gider = karsiTaraf === "B"
    const anahtar = gider ? "bakiye-kapama:verilen" : "bakiye-kapama:alinan"
    const kod = gider ? "611" : "649"
    satirlar.push({
      taraf: karsiTaraf,
      tutar,
      rol: "BAKIYE_KAPAMA",
      ...hesapSec(eslesme, [anahtar], kod),
      oneriKodu: kod,
      anahtarlar: [anahtar],
      aciklama: gider ? "Verilen iskonto / bakiye kapama" : "Alınan iskonto / bakiye kapama",
    })
    aciklama = `${o.fatura.no} bakiye kapama · ${cariRef.ad}`
  } else if (yontem === "EMPLOYEE" && o.personel) {
    satirlar.push(
      altSatir({
        taraf: karsiTaraf,
        tutar,
        rol: "PERSONEL",
        oneriKodu: "335",
        aciklama: o.personel.ad,
        alt: { tur: "personel", id: o.personel.id, ad: o.personel.ad },
      }),
    )
    aciklama = `${o.fatura.no} çalışan cebinden ödedi · ${o.personel.ad}`
  } else if (o.hesap) {
    satirlar.push(
      altSatir({ taraf: karsiTaraf, tutar, rol: "PARA", oneriKodu: paraKodu(o.hesap.tur), aciklama: o.hesap.ad, alt: paraRef(o.hesap) }),
    )
    if (o.hesap.tur === "CASH") tur = karsiTaraf === "B" ? "TAHSIL" : "TEDIYE"
    aciklama = `${o.fatura.no} ${cariTaraf === "A" ? "tahsilatı" : "ödemesi"} · ${cariRef.ad}`
  } else {
    satirlar.push({
      taraf: karsiTaraf,
      tutar,
      rol: "KARSI",
      hesapKodu: null,
      oneriKodu: "100",
      kaynak: "yok",
      anahtarlar: [],
      aciklama: "Ödemenin kasası yazılmamış — seçin",
    })
    aciklama = `${o.fatura.no} ödemesi (kasa yok) · ${cariRef.ad}`
  }
  return fisKur({ tarih: istanbulGunu(o.tarih), aciklama, tur, satirlar })
}

// ── Çek / senet ──────────────────────────────────────────────────────────────

export type KiymetGirdisi = {
  id: string
  tur: "CEK" | "SENET"
  no: string
  tarih: Date | string // issueDate
  tutar: unknown
  durum: string
  /** Çözülmüş yön (null → müşteride alınan, tedarikçide verilen). */
  yon: "RECEIVED" | "GIVEN"
  banka?: string | null
  musteri?: Kayit | null
  tedarikci?: Kayit | null
}

export const KIYMET_SAYILMAZ = ["İADE_EDİLDİ", "PROTESTOLU"]
export const CIRO_DURUMU = "CİRO_EDİLDİ"

const kiymetKodu = (tur: "CEK" | "SENET", yon: "RECEIVED" | "GIVEN") =>
  tur === "CEK" ? (yon === "RECEIVED" ? "101" : "103") : yon === "RECEIVED" ? "121" : "321"
const kiymetAdi = (k: Pick<KiymetGirdisi, "tur" | "no" | "banka">) =>
  [k.tur === "CEK" ? `Çek ${k.no}` : `Senet ${k.no}`, k.banka].filter(Boolean).join(" · ")

/**
 * Evrakın alınması/verilmesi — cari bakiyesiyle aynı gün (`issueDate`). İade edilen
 * ve protestolu evrak cariyi hiç düşürmez (lib/cari/check-credit.ts): fişe de girmez.
 */
export function kiymetFisi(k: KiymetGirdisi): FisSonucu {
  if (KIYMET_SAYILMAZ.includes(k.durum)) {
    return { durum: "fise-girmez", sebep: "İade edilen / protestolu evrak cari bakiyesine girmez." }
  }
  const tutar = r2(num(k.tutar))
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Tutarsız evrak." }
  const alinan = k.yon === "RECEIVED"
  const cari = k.musteri ?? k.tedarikci ?? null
  const musteri = Boolean(k.musteri)
  const satirlar: FisSatiri[] = []

  // Verilen evrak "ciro edildi" işaretliyse portföydeki bir müşteri çekinin devridir —
  // kaynak hesap 103 değil 101 olabilir; Kobipo bunu ayırt etmiyor, müşavir seçer.
  const ciroluVerilen = !alinan && k.durum === CIRO_DURUMU
  const kod = kiymetKodu(k.tur, k.yon)
  if (ciroluVerilen) {
    satirlar.push({
      taraf: "A",
      tutar,
      rol: "KARSI",
      hesapKodu: null,
      oneriKodu: k.tur === "CEK" ? "101" : "121",
      kaynak: "yok",
      anahtarlar: [],
      aciklama: `${kiymetAdi(k)} — ciro edilen evrak (portföyden mi, kendi çekimiz mi?)`,
    })
  } else {
    satirlar.push({
      taraf: alinan ? "B" : "A",
      tutar,
      rol: "KIYMET",
      hesapKodu: kod,
      oneriKodu: kod,
      kaynak: "varsayilan",
      anahtarlar: [],
      aciklama: kiymetAdi(k),
    })
  }
  if (cari) {
    satirlar.push(
      altSatir({
        taraf: alinan ? "A" : "B",
        tutar,
        rol: "CARI",
        oneriKodu: musteri ? "120" : "320",
        aciklama: cari.ad,
        alt: { tur: musteri ? "musteri" : "tedarikci", id: cari.id, ad: cari.ad },
      }),
    )
  } else {
    satirlar.push({
      taraf: alinan ? "A" : "B",
      tutar,
      rol: "KARSI",
      hesapKodu: null,
      oneriKodu: alinan ? "120" : "320",
      kaynak: "yok",
      anahtarlar: [],
      aciklama: "Evrakın carisi yok — seçin",
    })
  }
  return fisKur({
    tarih: istanbulGunu(k.tarih),
    aciklama: `${kiymetAdi(k)} ${alinan ? "alındı" : "verildi"}${cari ? ` · ${cari.ad}` : ""}`,
    tur: "MAHSUP",
    satirlar,
  })
}

/**
 * Alınan evrakın CİROSU — portföyden çıkar, bir tedarikçinin borcunu kapatır.
 * Kobipo ciro edilen tedarikçiyi ve tarihi tutmuyor: tarih evrakın son
 * güncellenme günü, karşı hesap müşavirce seçilir (öğrenilmez).
 */
export function ciroFisi(k: KiymetGirdisi & { ciroTarihi: Date | string }): FisSonucu {
  if (k.yon !== "RECEIVED" || k.durum !== CIRO_DURUMU) {
    return { durum: "fise-girmez", sebep: "Ciro edilmiş alınan evrak değil." }
  }
  const tutar = r2(num(k.tutar))
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Tutarsız evrak." }
  const kod = kiymetKodu(k.tur, "RECEIVED")
  return fisKur({
    tarih: istanbulGunu(k.ciroTarihi),
    aciklama: `${kiymetAdi(k)} ciro edildi`,
    tur: "MAHSUP",
    satirlar: [
      {
        taraf: "B",
        tutar,
        rol: "KARSI",
        hesapKodu: null,
        oneriKodu: "320",
        kaynak: "yok",
        anahtarlar: [],
        aciklama: "Ciro edilen tedarikçi — seçin",
      },
      { taraf: "A", tutar, rol: "KIYMET", hesapKodu: kod, oneriKodu: kod, kaynak: "varsayilan", anahtarlar: [], aciklama: kiymetAdi(k) },
    ],
  })
}

// ── Cari virman fişi ─────────────────────────────────────────────────────────

export type VirmanGirdisi = {
  id: string
  no: string
  tarih: Date | string
  tutar: unknown
  aciklama?: string | null
  /** Bacaklar: DEBIT ("Virman Borç") / CREDIT ("Virman Alacak"). */
  bacaklar: Array<{ taraf: "DEBIT" | "CREDIT"; musteri?: Kayit | null; tedarikci?: Kayit | null }>
}

export function virmanFisi(v: VirmanGirdisi): FisSonucu {
  const tutar = r2(num(v.tutar))
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Tutarsız virman." }
  const satirlar: FisSatiri[] = []
  for (const b of v.bacaklar) {
    const cari = b.musteri ?? b.tedarikci
    if (!cari) continue
    const musteri = Boolean(b.musteri)
    satirlar.push(
      altSatir({
        taraf: b.taraf === "DEBIT" ? "B" : "A",
        tutar,
        rol: "CARI",
        oneriKodu: musteri ? "120" : "320",
        aciklama: cari.ad,
        alt: { tur: musteri ? "musteri" : "tedarikci", id: cari.id, ad: cari.ad },
      }),
    )
  }
  if (satirlar.length === 0) return { durum: "fise-girmez", sebep: "Virmanın carisi yok." }
  if (satirlar.length === 1) {
    // Tek taraflı fiş (karşılıksız dekont): karşı hesabı müşavir seçer.
    const tek = satirlar[0]
    const borc = tek.taraf === "B"
    satirlar.push({
      taraf: borc ? "A" : "B",
      tutar,
      rol: "KARSI",
      hesapKodu: null,
      oneriKodu: borc ? "649" : "659",
      kaynak: "yok",
      anahtarlar: [],
      aciklama: "Tek taraflı virmanın karşılığı — seçin",
    })
  }
  const adlar = v.bacaklar.map((b) => (b.musteri ?? b.tedarikci)?.ad).filter(Boolean)
  return fisKur({
    tarih: istanbulGunu(v.tarih),
    aciklama: [v.no, "cari virman", v.aciklama?.trim() || adlar.join(" → ")].filter(Boolean).join(" · "),
    tur: "MAHSUP",
    satirlar,
  })
}

// ── Bordro tahakkuku ─────────────────────────────────────────────────────────

export type BordroGirdisi = {
  id: string
  yil: number
  ay: number
  personel: Kayit
  brut: unknown
  prim: unknown
  avans: unknown
  sgk: unknown
  vergi: unknown
  diger: unknown
  net: unknown
  /** SGK işveren payı (işsizlik işveren payı dahil); 0 → satır yok. */
  isverenSgk?: unknown
  /** Tutar bordroda girilmedi, teşviksiz oranla hesaplandı (bordroIsverenPayi) — açıklamaya yazılır. */
  isverenSgkHesaplandi?: boolean
}

/**
 * Bordronun tahakkuk fişi — dönemin son günü. İşveren SGK payı ayrı satır çiftidir:
 * B gider (öğrenilir, ayrı anahtar — müşavirlerin çoğu ayrı alt hesap kullanır) · A 361.
 * Netten düşmez. Ödeme ayrıca kasa hareketiyle (B 335 · A kasa).
 */
export function bordroFisi(b: BordroGirdisi, eslesme: HesapEslesmeleri): FisSonucu {
  const brut = r2(num(b.brut) + num(b.prim))
  if (brut === 0) return { durum: "fise-girmez", sebep: "Brüt tutarı sıfır bordro." }
  const sgk = r2(num(b.sgk))
  const vergi = r2(num(b.vergi))
  const diger = r2(num(b.diger))
  const avans = r2(num(b.avans))
  // Net, kesintilerin tamamlayanı olarak kurulur: kayıtlı net kuruş sapıyorsa fiş yine dengeli kalır.
  const net = r2(brut - sgk - vergi - diger - avans)
  const isveren = r2(num(b.isverenSgk))
  const isverenNotu = b.isverenSgkHesaplandi ? " (bordroda girilmedi, teşviksiz oranla hesaplandı)" : ""
  const satir = (taraf: Taraf, tutar: number, rol: FisSatiri["rol"], kod: string, aciklama: string): FisSatiri => ({
    taraf,
    tutar,
    rol,
    hesapKodu: kod,
    oneriKodu: kod,
    kaynak: "varsayilan",
    anahtarlar: [],
    aciklama,
  })
  const satirlar: FisSatiri[] = [
    {
      taraf: "B",
      tutar: brut,
      rol: "BORDRO_GIDER",
      ...hesapSec(eslesme, ["bordro:gider"], "770"),
      oneriKodu: "770",
      anahtarlar: ["bordro:gider"],
      aciklama: "Brüt ücret (prim dahil)",
    },
    {
      taraf: "B",
      tutar: isveren,
      rol: "BORDRO_GIDER",
      ...hesapSec(eslesme, ["bordro:isveren-sgk"], "770"),
      oneriKodu: "770",
      anahtarlar: ["bordro:isveren-sgk"],
      aciklama: `SGK işveren payı${isverenNotu}`,
    },
    satir("A", sgk, "BORDRO_SGK", "361", "SGK işçi payı"),
    satir("A", isveren, "BORDRO_SGK", "361", `SGK işveren payı${isverenNotu}`),
    satir("A", vergi, "BORDRO_VERGI", "360", "Gelir ve damga vergisi"),
    satir("A", diger, "BORDRO_DIGER", "369", "Diğer kesintiler"),
    satir("A", avans, "BORDRO_AVANS", "196", "Avans mahsubu"),
    altSatir({
      taraf: "A",
      tutar: net,
      rol: "PERSONEL",
      oneriKodu: "335",
      aciklama: `${b.personel.ad} — net ücret`,
      alt: { tur: "personel", id: b.personel.id, ad: b.personel.ad },
    }),
  ]
  const sonGun = new Date(Date.UTC(b.yil, b.ay, 0))
  return fisKur({
    tarih: sonGun,
    aciklama: `${String(b.ay).padStart(2, "0")}/${b.yil} bordro · ${b.personel.ad}`,
    tur: "MAHSUP",
    satirlar,
  })
}

// ── Başlangıçtan sonra açılan kartların açılış bakiyesi ──────────────────────

export type CariAcilisGirdisi = {
  id: string
  tur: "musteri" | "tedarikci"
  ad: string
  tarih: Date | string // kartın açıldığı an
  tutar: unknown
  /** DEBIT | CREDIT (karttaki açılış bakiyesi tipi). */
  tip: string | null
}

/**
 * Cari kartın açılış bakiyesi (kart başlangıç tarihinden SONRA açıldıysa; öncesi
 * açılış fişindedir). Karşılığı önceki sistemden devreden bakiyedir — hesap bir kez
 * seçilir, sonraki kartlar öğrenilmiş hesapla gelir.
 */
export function cariAcilisFisi(c: CariAcilisGirdisi, eslesme: HesapEslesmeleri): FisSonucu {
  const tutar = r2(num(c.tutar))
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Açılış bakiyesi yok." }
  const borc = String(c.tip || "DEBIT").toUpperCase() === "DEBIT"
  const anahtar = "acilis:cari"
  return fisKur({
    tarih: istanbulGunu(c.tarih),
    aciklama: `${c.ad} — açılış bakiyesi`,
    tur: "ACILIS",
    satirlar: [
      altSatir({
        taraf: borc ? "B" : "A",
        tutar,
        rol: "CARI",
        oneriKodu: c.tur === "musteri" ? "120" : "320",
        aciklama: c.ad,
        alt: { tur: c.tur, id: c.id, ad: c.ad },
      }),
      {
        taraf: borc ? "A" : "B",
        tutar,
        rol: "KARSI",
        ...hesapSec(eslesme, [anahtar], null),
        oneriKodu: "500",
        anahtarlar: [anahtar],
        aciklama: "Açılış bakiyesinin karşılığı",
      },
    ],
  })
}

export type FinansAcilisGirdisi = { hesap: FinansHesabi; tarih: Date | string; tutar: unknown }

/** Kasa/banka hesabının açılış bakiyesi (hesap başlangıçtan SONRA açıldıysa). */
export function finansAcilisFisi(f: FinansAcilisGirdisi, eslesme: HesapEslesmeleri): FisSonucu {
  const tutar = r2(num(f.tutar))
  if (tutar === 0) return { durum: "fise-girmez", sebep: "Açılış bakiyesi yok." }
  const anahtar = "acilis:kasa"
  return fisKur({
    tarih: istanbulGunu(f.tarih),
    aciklama: `${f.hesap.ad} — açılış bakiyesi`,
    tur: "ACILIS",
    satirlar: [
      altSatir({ taraf: "B", tutar, rol: "PARA", oneriKodu: paraKodu(f.hesap.tur), aciklama: f.hesap.ad, alt: paraRef(f.hesap) }),
      {
        taraf: "A",
        tutar,
        rol: "KARSI",
        ...hesapSec(eslesme, [anahtar], null),
        oneriKodu: "500",
        anahtarlar: [anahtar],
        aciklama: "Açılış bakiyesinin karşılığı",
      },
    ],
  })
}
