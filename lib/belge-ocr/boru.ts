/**
 * BELGE TARAMA BORU HATTI — girdi → belirlilik merdiveni → sınıf → türe özel
 * çıkarım → denetim. SUNUCU tarafı (sharp, unpdf, model anahtarı).
 *
 * Merdiven (plan §3.1): XML eki › karekod › metin katmanı › görsel. İlk çalışan
 * kazanır; alttaki üsttekini doğrular. XML varsa model HİÇ çağrılmaz.
 *
 * İki geçiş (plan §3.2): önce SINIFLANDIRICI dosyadaki belgeleri ayırır
 * (tür + sayfalar + taraflar), sonra her belge KENDİ şemasıyla okunur. Fiş
 * yolu `lib/fis-ocr` şemasıyla koşar — o şema DEĞİŞMEZ (plan §2).
 *
 * KAYIT YAPMAZ. Sonuç `document_scans` satırına yazılır; kayıt onay kartından,
 * her türün kendi ucuna gider.
 */

import { createHash } from "node:crypto"
import { fisTaraHazir } from "@/lib/fis-ocr/extract"
import { VARSAYILAN_MODEL } from "@/lib/fis-ocr/models"
import { denetle as fisDenetle, insanaSorulmali as fisInsanaSorulmali } from "@/lib/fis-ocr/validate"
import type { Fis } from "@/lib/fis-ocr/schema"
import { kullanimTopla, modeleSor, TaramaHatasi, type IcerikParcasi, type ModelKullanimi } from "./saglayici"
import { gorselHazirla } from "./girdi/gorsel"
import { pdfOku, pdfSayfaRaster } from "./girdi/pdf"
import { gibKarekoduMu, karekodCoz, type GibKarekodu, type Karekod } from "./girdi/karekod"
import { bytesToXml, ublAdaylari, ublTuruBul } from "./girdi/xml-ek"
import { ublFaturaOku, ublIrsaliyeOku } from "./ubl"
import { SINIF_KOMUT, SINIF_PROMPT, SINIF_SEMA } from "./sinif/schema"
import { sinifNormalize, type Firma, type NormalBelge } from "./sinif/normalize"
import { FATURA_KOMUT, FATURA_PROMPT, FATURA_SEMA, type Fatura } from "./fatura/schema"
import { faturaDenetle, faturaInsanaSorulmali } from "./fatura/validate"
import { IRSALIYE_KOMUT, IRSALIYE_PROMPT, IRSALIYE_SEMA, type Irsaliye } from "./irsaliye/schema"
import { irsaliyeDenetle, irsaliyeInsanaSorulmali } from "./irsaliye/validate"
import { DEKONT_KOMUT, DEKONT_PROMPT, DEKONT_SEMA, type Dekont } from "./dekont/schema"
import { dekontDenetle, dekontInsanaSorulmali, islemTuruNormalize } from "./dekont/validate"
import { CEK_KOMUT, CEK_PROMPT, CEK_SEMA, type CekSenet } from "./cek/schema"
import { cekDenetle, cekInsanaSorulmali, cekTuruNormalize } from "./cek/validate"
import type { BelgeTuru, Denetim, OkumaYolu } from "./turler"

export { TaramaHatasi }

/**
 * Sayfa tavanı: tek istek 60 sn; 10 sayfa görsel + sınıf + tür çıkarımı sığar.
 * Aşılırsa uç "böl" der, sessizce kırpmaz (plan §3.4).
 */
export const MAX_SAYFA = 10

/**
 * Sınıflandırıcı modeli. Plan "ucuz model, ölçümle seçilecek" diyor; korpus
 * olmadan ölçülemedi (2026-09-21), o yüzden fişin ölçülmüş modeliyle başlıyor.
 * Env ile değiştirilebilir ki tezgâh koşunca kod değişmeden geçilsin.
 */
export const SINIF_MODEL = process.env.BELGE_SINIF_MODEL || VARSAYILAN_MODEL

/** Belge başına sınıf bilgisi (tür, yön, sayfalar, taraflar) + türe özel çıkarım. */
export type BelgeCikarimi = { sinif: NormalBelge } & (
  | { tur: "FIS"; veri: Fis; denetimler: Denetim[]; insanaSorulmali: boolean }
  | { tur: "FATURA"; veri: Fatura; denetimler: Denetim[]; insanaSorulmali: boolean; karekod: GibKarekodu | null }
  | { tur: "IRSALIYE"; veri: Irsaliye; denetimler: Denetim[]; insanaSorulmali: boolean }
  | { tur: "DEKONT"; veri: Dekont; denetimler: Denetim[]; insanaSorulmali: boolean }
  | { tur: "CEK" | "SENET"; veri: CekSenet; denetimler: Denetim[]; insanaSorulmali: boolean }
  | { tur: "DIGER"; veri: null; denetimler: Denetim[]; insanaSorulmali: true }
)

export type BoruSonucu = {
  sha256: string
  sayfaSayisi: number
  yol: OkumaYolu
  belgeler: BelgeCikarimi[]
  karekod: Karekod | null
  /** Karekod aranırken raster gerekti ama yapılamadı — Vercel ölçümü için görünür */
  karekodNotu: string | null
  xmlEkAdi: string | null
  metinKarakter: number | null
  model: string
  saglayici: string
  sureMs: number
  kullanim: ModelKullanimi
}

export type BoruBaglami = {
  firma: Firma
  /** Kasa/banka kartlarındaki IBAN'lar — dekont yönü */
  bizimIbanlar: string[]
  model?: string
  /** Sınıflandırıcıyı atla, tüm dosyayı bu tür say (kartta "türü değiştir") */
  zorlaTur?: BelgeTuru
  bugun?: Date
}

type Girdi =
  | { tip: "xml"; xml: string }
  | { tip: "pdf" }
  | { tip: "gorsel" }

function girdiTuru(dosya: Buffer, mime: string, ad: string): Girdi {
  const bas = dosya.subarray(0, 512).toString("latin1")
  if (bas.startsWith("%PDF")) return { tip: "pdf" }
  // UTF-8 BOM (U+FEFF) ile baslayan XML dosyalari da XML sayilir; karakter kaynakta
  // gorunmez oldugu icin kod noktasindan kuruluyor.
  const BOM = String.fromCharCode(0xfeff)
  const xmlGibi = new RegExp("^\\s*" + BOM + "?<\\?xml|^\\s*<").test(dosya.subarray(0, 64).toString("utf8"))
  if (xmlGibi || /xml/i.test(mime) || /\.xml$/i.test(ad)) {
    const xml = bytesToXml(new Uint8Array(dosya))
    if (xml && ublTuruBul(xml) !== "DIGER") return { tip: "xml", xml }
    if (xml) throw new TaramaHatasi("XML dosyası UBL Invoice/DespatchAdvice değil")
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(ad)) return { tip: "pdf" }
  return { tip: "gorsel" }
}

const bosKullanim = (): ModelKullanimi => ({ girdiToken: 0, ciktiToken: 0, dusunmeToken: 0, maliyetUsd: null })

/** XML'den (ek ya da doğrudan) gelen belge — model çağrısı yok. */
function xmlBelgesi(xml: string, ad: string | null, b: BoruBaglami, karekod: GibKarekodu | null): BelgeCikarimi | null {
  const tur = ublTuruBul(xml)
  if (tur === "INVOICE") {
    const f = ublFaturaOku(xml)
    if (!f) return null
    const sinif = sinifNormalize(
      { belgeler: [{ tur: "FATURA", sayfalar: [1], duzenleyenUnvan: f.saticiUnvan, duzenleyenVknTckn: f.saticiVknTckn, muhatapUnvan: f.aliciUnvan, muhatapVknTckn: f.aliciVknTckn, belgeNo: f.faturaNo, tarih: f.tarih, toplam: f.odenecek, guven: 1, not: ad ? `UBL eki: ${ad}` : "UBL XML" }] },
      b.firma
    )
    const denetimler = faturaDenetle(f, { firmaVkn: b.firma.vkn, yon: sinif[0].yon, karekod, bugun: b.bugun })
    return { sinif: sinif[0], tur: "FATURA", veri: f, denetimler, insanaSorulmali: faturaInsanaSorulmali(denetimler, f), karekod }
  }
  if (tur === "DESPATCHADVICE") {
    const i = ublIrsaliyeOku(xml)
    if (!i) return null
    const sinif = sinifNormalize(
      { belgeler: [{ tur: "IRSALIYE", sayfalar: [1], duzenleyenUnvan: i.saticiUnvan, duzenleyenVknTckn: i.saticiVknTckn, muhatapUnvan: i.aliciUnvan, muhatapVknTckn: i.aliciVknTckn, belgeNo: i.irsaliyeNo, tarih: i.duzenlemeTarihi, toplam: null, guven: 1, not: ad ? `UBL eki: ${ad}` : "UBL XML" }] },
      b.firma
    )
    const denetimler = irsaliyeDenetle(i, { firmaVkn: b.firma.vkn, yon: sinif[0].yon, bugun: b.bugun })
    return { sinif: sinif[0], tur: "IRSALIYE", veri: i, denetimler, insanaSorulmali: irsaliyeInsanaSorulmali(denetimler, i) }
  }
  return null
}

/** Sayfa altkümesini içerik parçalarına indirir; sayfa eşleşmezse tümü gider. */
function sayfaParcalari(parcalar: IcerikParcasi[], sayfalar: number[]): IcerikParcasi[] {
  const secili = sayfalar.map((n) => parcalar[n - 1]).filter(Boolean)
  return secili.length ? secili : parcalar
}

export async function belgeTara(
  dosya: Buffer,
  meta: { mime: string; ad: string },
  b: BoruBaglami
): Promise<BoruSonucu> {
  const t0 = Date.now()
  const sha256 = createHash("sha256").update(dosya).digest("hex")
  const model = b.model || VARSAYILAN_MODEL
  const girdi = girdiTuru(dosya, meta.mime, meta.ad)

  // ---------------------------------------------------------- 1. XML doğrudan
  if (girdi.tip === "xml") {
    const x = xmlBelgesi(girdi.xml, null, b, null)
    if (!x) throw new TaramaHatasi("UBL XML çözülemedi")
    return {
      sha256, sayfaSayisi: 1, yol: "xml", belgeler: [x], karekod: null, karekodNotu: null,
      xmlEkAdi: null, metinKarakter: null, model: "—", saglayici: "xml", sureMs: Date.now() - t0, kullanim: bosKullanim(),
    }
  }

  // ---------------------------------------------------------- 2. PDF / görsel → içerik parçaları
  let parcalar: IcerikParcasi[] = []
  let sayfaSayisi = 1
  let yol: OkumaYolu = "gorsel"
  let karekod: Karekod | null = null
  let karekodNotu: string | null = null
  let metinKarakter: number | null = null
  // Fiş şeması yalnız GÖRSEL okur; metin yolunda fiş çıkarsa sayfa rasterlenir.
  const sayfaGorseli = async (n: number): Promise<Buffer | null> => {
    const p = parcalar[n - 1]
    if (p?.tip === "gorsel") return p.jpeg
    if (girdi.tip !== "pdf") return null
    return pdfSayfaRaster(dosya, n)
  }

  if (girdi.tip === "pdf") {
    const pdf = await pdfOku(dosya)
    sayfaSayisi = pdf.sayfaSayisi
    if (sayfaSayisi === 0) throw new TaramaHatasi("PDF'te sayfa yok")
    if (sayfaSayisi > MAX_SAYFA) {
      throw new TaramaHatasi(`PDF ${sayfaSayisi} sayfa; tek seferde en çok ${MAX_SAYFA} sayfa okunur. Dosyayı bölün.`)
    }
    karekod = karekodCoz(pdf.karekodHam)
    if (pdf.karekodYolu === "raster-yok") karekodNotu = "Karekod için sayfa rasterlenemedi (@napi-rs/canvas yüklenemedi)"
    metinKarakter = pdf.metinKarakter
    const gib = gibKarekoduMu(karekod) ? karekod : null

    // 2a. PDF/A-3 UBL eki → model yok
    const ekler = ublAdaylari(pdf.ekler)
    if (ekler.length > 0) {
      const x = xmlBelgesi(ekler[0].xml, ekler[0].ad, b, gib)
      if (x) {
        return {
          sha256, sayfaSayisi, yol: "xml", belgeler: [x], karekod, karekodNotu, xmlEkAdi: ekler[0].ad,
          metinKarakter, model: "—", saglayici: "xml-ek", sureMs: Date.now() - t0, kullanim: bosKullanim(),
        }
      }
    }

    // 2b. Metin katmanı varsa METİN gider (görselin ~1/10'u), yoksa raster.
    if (pdf.metinKatmaniVar) {
      yol = gib ? "karekod+model" : "metin"
      parcalar = pdf.metin.map((m, i) => ({ tip: "metin", metin: `--- Sayfa ${i + 1} ---\n${m}` }))
    } else {
      yol = gib ? "karekod+model" : "gorsel"
      for (let n = 1; n <= sayfaSayisi; n++) {
        const jpeg = await pdfSayfaRaster(dosya, n)
        if (!jpeg) {
          throw new TaramaHatasi(
            "PDF'in metin katmanı yok ve sayfa görsele çevrilemedi (raster kütüphanesi bu ortamda yüklenemedi). Sayfayı fotoğraf/PNG olarak yükleyin."
          )
        }
        parcalar.push({ tip: "gorsel", jpeg })
      }
    }
  } else {
    const g = await gorselHazirla(dosya)
    parcalar = [{ tip: "gorsel", jpeg: g.jpeg }]
    // Fotoğraftaki karekodu da dene: e-Arşiv çıktısının fotoğrafı çekilmiş olabilir.
    try {
      const { karekodCozGorsel } = await import("./girdi/pdf")
      karekod = karekodCoz(await karekodCozGorsel(g.jpeg))
    } catch {
      karekod = null
    }
    if (gibKarekoduMu(karekod)) yol = "karekod+model"
  }

  // ---------------------------------------------------------- 3. Geçiş A — sınıf
  //
  // Kullanıcı kartta türü elle seçtiyse (yanlış sınıf) sınıflandırıcı ATLANIR:
  // tüm sayfalar tek belge sayılır, taraflar tür çıkarımından sonra doldurulur.
  let sinif: NormalBelge[]
  let kullanim: ModelKullanimi = bosKullanim()
  let saglayici = "—"
  if (b.zorlaTur) {
    sinif = sinifNormalize(
      { belgeler: [{ tur: b.zorlaTur, sayfalar: parcalar.map((_, i) => i + 1), guven: 1, not: "Tür kullanıcı tarafından seçildi" }] },
      b.firma
    )
  } else {
    const sinifYaniti = await modeleSor({
      model: SINIF_MODEL,
      sistem: SINIF_PROMPT,
      icerik: parcalar,
      komut: SINIF_KOMUT,
      semaAdi: "sinif",
      sema: SINIF_SEMA,
      baslik: "Kobipo belge sinif",
    })
    sinif = sinifNormalize(sinifYaniti.ham, b.firma)
    kullanim = sinifYaniti.kullanim
    saglayici = sinifYaniti.saglayici
  }

  // Karekod GİB faturası diyorsa ve sınıf tek belgeyi DIGER/FIS sandıysa karekod kazanır:
  // karekod belgenin kendi beyanıdır, modelin tahmini değil.
  if (gibKarekoduMu(karekod) && karekod.senaryo && /FATURA/.test(karekod.senaryo) && sinif.length === 1 && sinif[0].tur !== "FATURA") {
    sinif = [{ ...sinif[0], tur: "FATURA", not: `Karekod: ${karekod.senaryo} (sınıf ${sinif[0].tur} demişti)` }]
  }
  if (sinif.length === 0) sinif = sinifNormalize({ belgeler: [{ tur: "DIGER", sayfalar: [1], guven: 0, not: "Sınıflandırıcı belge bulamadı" }] }, b.firma)

  // Karekod başlığı boşlukları doldurur (yalnız NULL alanlar): sınıflandırıcı
  // alıcı VKN'yi okuyamadıysa yön belirsiz kalırdı; karekod alıcıyı taşır.
  // Dolu alan EZİLMEZ — çapraz denetim modelin okuduğunu görmeli.
  if (gibKarekoduMu(karekod) && sinif.length === 1 && sinif[0].tur === "FATURA") {
    const k = karekod
    const s0 = sinif[0]
    sinif = sinifNormalize(
      {
        belgeler: [
          {
            ...s0,
            duzenleyenVknTckn: s0.duzenleyenVknTckn ?? k.saticiVkn,
            muhatapVknTckn: s0.muhatapVknTckn ?? k.aliciVkn,
            belgeNo: s0.belgeNo ?? k.belgeNo,
            tarih: s0.tarih ?? k.tarih,
            toplam: s0.toplam ?? k.odenecek,
          },
        ],
      },
      b.firma
    )
  }

  // ---------------------------------------------------------- 4. Geçiş B — tür bazlı
  //
  // Çıktı TEK dizidir: her eleman kendi sınıf bilgisini (tür, yön, sayfalar,
  // taraflar) taşır. Sınıf listesiyle ayrı ayrı tutulsaydı bir sayfadaki iki fiş
  // (tek sınıf girişi → iki çıkarım) indeksleri kaydırır, kart yanlış belgeyi
  // "kaydedildi" işaretlerdi.
  const belgeler: BelgeCikarimi[] = []
  const gib = gibKarekoduMu(karekod) ? karekod : null
  const fisSayfalari = new Set<number>()
  const taze = (s: NormalBelge, taraf: TarafBilgisi) => tarafTazele(s, taraf, b.firma)

  for (const s of sinif) {
    const icerik = sayfaParcalari(parcalar, s.sayfalar)
    switch (s.tur) {
      case "FIS": {
        // Aynı sayfadaki fişler TEK çağrıda okunur (fiş şeması zaten diziyi döner).
        const sayfa = s.sayfalar[0] ?? 1
        if (fisSayfalari.has(sayfa)) break
        fisSayfalari.add(sayfa)
        const jpeg = await sayfaGorseli(sayfa)
        if (!jpeg) {
          belgeler.push({ sinif: s, tur: "DIGER", veri: null, denetimler: [{ anahtar: "fis", etiket: "Fiş", durum: "patladi", aciklama: "Fiş yalnız görselden okunur; sayfa görsele çevrilemedi" }], insanaSorulmali: true })
          break
        }
        const r = await fisTaraHazir(jpeg, { model })
        kullanim = kullanimTopla(kullanim, r.kullanim)
        saglayici = r.saglayici
        for (const fis of r.fisler) {
          const denetimler = fisDenetle(fis, b.bugun)
          // Fiş her zaman ALIŞtır (yazarkasa fişini karşı taraf kesmiştir).
          const sf = taze({ ...s, tur: "FIS", belgeNo: fis.fisNo, tarih: fis.tarih, toplam: fis.genelToplam }, { duzenleyenUnvan: fis.saticiUnvan, duzenleyenVknTckn: fis.vknTckn, muhatapUnvan: null, muhatapVknTckn: null })
          belgeler.push({ sinif: { ...sf, yon: "ALIS" }, tur: "FIS", veri: fis, denetimler, insanaSorulmali: fisInsanaSorulmali(denetimler, fis) })
        }
        break
      }
      case "FATURA": {
        const y = await modeleSor({ model, sistem: FATURA_PROMPT, icerik, komut: FATURA_KOMUT, semaAdi: "fatura", sema: FATURA_SEMA, maxToken: 8000, baslik: "Kobipo fatura tarama" })
        kullanim = kullanimTopla(kullanim, y.kullanim)
        saglayici = y.saglayici
        const f = faturaNormalize(y.ham, gib)
        const sf = taze({ ...s, belgeNo: s.belgeNo ?? f.faturaNo, tarih: s.tarih ?? f.tarih, toplam: s.toplam ?? f.odenecek }, { duzenleyenUnvan: f.saticiUnvan, duzenleyenVknTckn: f.saticiVknTckn, muhatapUnvan: f.aliciUnvan, muhatapVknTckn: f.aliciVknTckn })
        const denetimler = faturaDenetle(f, { firmaVkn: b.firma.vkn, yon: sf.yon, karekod: gib, bugun: b.bugun })
        belgeler.push({ sinif: sf, tur: "FATURA", veri: f, denetimler, insanaSorulmali: faturaInsanaSorulmali(denetimler, f), karekod: gib })
        break
      }
      case "IRSALIYE": {
        const y = await modeleSor({ model, sistem: IRSALIYE_PROMPT, icerik, komut: IRSALIYE_KOMUT, semaAdi: "irsaliye", sema: IRSALIYE_SEMA, maxToken: 6000, baslik: "Kobipo irsaliye tarama" })
        kullanim = kullanimTopla(kullanim, y.kullanim)
        saglayici = y.saglayici
        const i = irsaliyeNormalize(y.ham)
        const sf = taze({ ...s, belgeNo: s.belgeNo ?? i.irsaliyeNo, tarih: s.tarih ?? i.duzenlemeTarihi }, { duzenleyenUnvan: i.saticiUnvan, duzenleyenVknTckn: i.saticiVknTckn, muhatapUnvan: i.aliciUnvan, muhatapVknTckn: i.aliciVknTckn })
        const denetimler = irsaliyeDenetle(i, { firmaVkn: b.firma.vkn, yon: sf.yon, bugun: b.bugun })
        belgeler.push({ sinif: sf, tur: "IRSALIYE", veri: i, denetimler, insanaSorulmali: irsaliyeInsanaSorulmali(denetimler, i) })
        break
      }
      case "DEKONT": {
        const y = await modeleSor({ model, sistem: DEKONT_PROMPT, icerik, komut: DEKONT_KOMUT, semaAdi: "dekont", sema: DEKONT_SEMA, baslik: "Kobipo dekont tarama" })
        kullanim = kullanimTopla(kullanim, y.kullanim)
        saglayici = y.saglayici
        const d = dekontNormalize(y.ham)
        const sf = taze({ ...s, belgeNo: s.belgeNo ?? d.referansNo, tarih: s.tarih ?? d.islemTarihi, toplam: s.toplam ?? d.tutar }, { duzenleyenUnvan: d.gonderenAd, duzenleyenVknTckn: null, muhatapUnvan: d.aliciAd, muhatapVknTckn: null })
        const denetimler = dekontDenetle(d, { bizimIbanlar: b.bizimIbanlar, bugun: b.bugun })
        belgeler.push({ sinif: sf, tur: "DEKONT", veri: d, denetimler, insanaSorulmali: dekontInsanaSorulmali(denetimler, d) })
        break
      }
      case "CEK":
      case "SENET": {
        const y = await modeleSor({ model, sistem: CEK_PROMPT, icerik, komut: CEK_KOMUT, semaAdi: "cek", sema: CEK_SEMA, baslik: "Kobipo cek tarama" })
        kullanim = kullanimTopla(kullanim, y.kullanim)
        saglayici = y.saglayici
        const c = cekNormalize(y.ham, s.tur)
        const tur = cekTuruNormalize(c.tur)
        const sf = taze({ ...s, tur, belgeNo: s.belgeNo ?? c.seriNo, tarih: s.tarih ?? c.vadeTarihi, toplam: s.toplam ?? c.tutar }, { duzenleyenUnvan: c.kesideci, duzenleyenVknTckn: c.kesideciVknTckn, muhatapUnvan: c.lehtar, muhatapVknTckn: c.lehtarVknTckn })
        const denetimler = cekDenetle(c, { firmaVkn: b.firma.vkn, yon: sf.yon, bugun: b.bugun })
        belgeler.push({ sinif: sf, tur, veri: c, denetimler, insanaSorulmali: cekInsanaSorulmali(denetimler, c) })
        break
      }
      default:
        belgeler.push({ sinif: s, tur: "DIGER", veri: null, denetimler: [{ anahtar: "tur", etiket: "Tür", durum: "olcelemedi", aciklama: s.not ?? "Tanınan bir belge türü değil" }], insanaSorulmali: true })
    }
  }

  return {
    sha256, sayfaSayisi, yol, belgeler, karekod, karekodNotu, xmlEkAdi: null, metinKarakter,
    model, saglayici, sureMs: Date.now() - t0, kullanim,
  }
}

type TarafBilgisi = Pick<NormalBelge, "duzenleyenUnvan" | "duzenleyenVknTckn" | "muhatapUnvan" | "muhatapVknTckn">

/**
 * Tür çıkarımı tarafları sınıflandırıcıdan daha güvenilir okur (tam şema, tek
 * belge). Sınıftaki BOŞ taraf alanları doldurulur ve yön yeniden türetilir;
 * dolu alan ezilmez.
 */
function tarafTazele(s: NormalBelge, t: TarafBilgisi, firma: Firma): NormalBelge {
  const [n] = sinifNormalize(
    {
      belgeler: [
        {
          ...s,
          duzenleyenUnvan: s.duzenleyenUnvan ?? t.duzenleyenUnvan,
          duzenleyenVknTckn: s.duzenleyenVknTckn ?? t.duzenleyenVknTckn,
          muhatapUnvan: s.muhatapUnvan ?? t.muhatapUnvan,
          muhatapVknTckn: s.muhatapVknTckn ?? t.muhatapVknTckn,
        },
      ],
    },
    firma
  )
  return n
}

// ---------------------------------------------------------------- normalize
//
// Model strict şemaya uyar ama sağlayıcı şemayı yok sayabilir (fişte ölçüldü);
// her alan tek tek güvenli tipe indirilir. Karekod varsa BAŞLIK ondan gelir:
// modelin okuduğu değer yalnız çapraz denetimde kullanılır — denetim, modelin
// ham değerini görebilsin diye çapraz alanlar `_model*` altında saklanmaz;
// validate.ts karekodla normalize EDİLMEMİŞ değeri karşılaştırır. Bu yüzden
// başlığı karekodla EZMİYORUZ, kartta "karekoddan" rozetiyle GÖSTERİYORUZ ve
// denetim patlarsa insan karar veriyor.

const sayi = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const metin = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const rakam = (v: unknown): string | null => {
  const r = String(v ?? "").replace(/\D/g, "")
  return r || null
}
const guven = (v: unknown, alanlar: string[]): Record<string, number> => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const a of alanlar) out[a] = typeof o[a] === "number" ? Math.max(0, Math.min(1, o[a] as number)) : 0
  return out
}

export function faturaNormalize(ham: any, karekod: GibKarekodu | null): Fatura {
  const h = ham && typeof ham === "object" ? ham : {}
  const k = karekod
  // Karekod yalnız BOŞ başlık alanını doldurur; modelin okuduğu değer kalır ki
  // faturaDenetle karekodla çapraz sınayabilsin (tutmazsa "patladı" — insan bakar).
  return {
    saticiUnvan: metin(h.saticiUnvan),
    saticiVknTckn: rakam(h.saticiVknTckn) ?? k?.saticiVkn ?? null,
    saticiVergiDairesi: metin(h.saticiVergiDairesi),
    saticiAdres: metin(h.saticiAdres),
    aliciUnvan: metin(h.aliciUnvan),
    aliciVknTckn: rakam(h.aliciVknTckn) ?? k?.aliciVkn ?? null,
    faturaNo: metin(h.faturaNo) ?? k?.belgeNo ?? null,
    ettn: metin(h.ettn)?.toLowerCase() ?? k?.ettn ?? null,
    tarih: metin(h.tarih)?.slice(0, 10) ?? k?.tarih?.slice(0, 10) ?? null,
    vade: metin(h.vade)?.slice(0, 10) ?? null,
    senaryo: metin(h.senaryo)?.toUpperCase() ?? k?.senaryo ?? null,
    tip: metin(h.tip)?.toUpperCase() ?? k?.tip ?? null,
    paraBirimi: metin(h.paraBirimi)?.toUpperCase() ?? k?.paraBirimi ?? "TRY",
    kalemler: (Array.isArray(h.kalemler) ? h.kalemler : []).map((k: any) => ({
      ad: metin(k?.ad) ?? "",
      saticiKodu: metin(k?.saticiKodu),
      miktar: sayi(k?.miktar),
      birim: metin(k?.birim),
      birimFiyat: sayi(k?.birimFiyat),
      iskontoTutar: sayi(k?.iskontoTutar),
      kdvOrani: sayi(k?.kdvOrani),
      kdvTutar: sayi(k?.kdvTutar),
      satirTutar: sayi(k?.satirTutar),
      tevkifatOrani: sayi(k?.tevkifatOrani),
    })),
    kdvKirilimi: (Array.isArray(h.kdvKirilimi) ? h.kdvKirilimi : [])
      .map((x: any) => ({ oran: sayi(x?.oran), matrah: sayi(x?.matrah), kdv: sayi(x?.kdv) }))
      .filter((x: any): x is Fatura["kdvKirilimi"][number] => x.oran != null),
    genelIskonto: sayi(h.genelIskonto),
    kdvsizEk: sayi(h.kdvsizEk),
    matrahToplam: sayi(h.matrahToplam),
    kdvToplam: sayi(h.kdvToplam),
    tevkifatToplam: sayi(h.tevkifatToplam),
    odenecek: sayi(h.odenecek) ?? k?.odenecek ?? null,
    irsaliyeNoListesi: (Array.isArray(h.irsaliyeNoListesi) ? h.irsaliyeNoListesi : []).map((x: unknown) => metin(x)).filter(Boolean) as string[],
    odemeNotu: metin(h.odemeNotu),
    guven: guven(h.guven, ["satici", "alici", "tarih", "toplam", "kalemler"]) as Fatura["guven"],
  }
}

export function irsaliyeNormalize(ham: any): Irsaliye {
  const h = ham && typeof ham === "object" ? ham : {}
  return {
    saticiUnvan: metin(h.saticiUnvan),
    saticiVknTckn: rakam(h.saticiVknTckn),
    aliciUnvan: metin(h.aliciUnvan),
    aliciVknTckn: rakam(h.aliciVknTckn),
    irsaliyeNo: metin(h.irsaliyeNo),
    ettn: metin(h.ettn)?.toLowerCase() ?? null,
    duzenlemeTarihi: metin(h.duzenlemeTarihi)?.slice(0, 10) ?? null,
    sevkTarihi: metin(h.sevkTarihi)?.slice(0, 10) ?? null,
    tasiyici: metin(h.tasiyici),
    plaka: metin(h.plaka)?.toUpperCase().replace(/\s+/g, " ") ?? null,
    sofor: metin(h.sofor),
    sevkAdresi: metin(h.sevkAdresi),
    faturaNoAtfi: metin(h.faturaNoAtfi),
    kalemler: (Array.isArray(h.kalemler) ? h.kalemler : []).map((k: any) => ({
      ad: metin(k?.ad) ?? "",
      saticiKodu: metin(k?.saticiKodu),
      miktar: sayi(k?.miktar),
      birim: metin(k?.birim),
    })),
    guven: guven(h.guven, ["satici", "alici", "tarih", "kalemler"]) as Irsaliye["guven"],
  }
}

export function dekontNormalize(ham: any): Dekont {
  const h = ham && typeof ham === "object" ? ham : {}
  const iban = (v: unknown) => metin(v)?.replace(/\s+/g, "").toUpperCase() ?? null
  return {
    banka: metin(h.banka),
    islemTarihi: metin(h.islemTarihi)?.slice(0, 10) ?? null,
    tutar: sayi(h.tutar),
    paraBirimi: metin(h.paraBirimi)?.toUpperCase() ?? "TRY",
    gonderenAd: metin(h.gonderenAd),
    gonderenIban: iban(h.gonderenIban),
    aliciAd: metin(h.aliciAd),
    aliciIban: iban(h.aliciIban),
    aciklama: metin(h.aciklama),
    referansNo: metin(h.referansNo),
    islemTuru: islemTuruNormalize(h.islemTuru),
    guven: guven(h.guven, ["taraflar", "tarih", "tutar"]) as Dekont["guven"],
  }
}

export function cekNormalize(ham: any, sinifTuru: "CEK" | "SENET"): CekSenet {
  const h = ham && typeof ham === "object" ? ham : {}
  return {
    tur: cekTuruNormalize(h.tur ?? sinifTuru),
    banka: metin(h.banka),
    sube: metin(h.sube),
    hesapNo: metin(h.hesapNo),
    seriNo: metin(h.seriNo),
    tutar: sayi(h.tutar),
    paraBirimi: metin(h.paraBirimi)?.toUpperCase() ?? "TRY",
    kesideTarihi: metin(h.kesideTarihi)?.slice(0, 10) ?? null,
    vadeTarihi: metin(h.vadeTarihi)?.slice(0, 10) ?? null,
    kesideci: metin(h.kesideci),
    kesideciVknTckn: rakam(h.kesideciVknTckn),
    lehtar: metin(h.lehtar),
    lehtarVknTckn: rakam(h.lehtarVknTckn),
    kesideYeri: metin(h.kesideYeri),
    guven: guven(h.guven, ["taraflar", "tarih", "tutar"]) as CekSenet["guven"],
  }
}
