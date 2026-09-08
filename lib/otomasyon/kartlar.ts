/**
 * OTOMASYON KARTLARI — kayıt defteri.
 *
 * `lib/asistan/sinyaller.ts`in kardeşi ve aynı iki kuralı taşır:
 *
 *   1. HİÇBİR RAKAM MODELDEN GEÇMEZ. Buradaki her sayı SQL'den çıkar ve ekrana
 *      çıktığı gibi basılır. Bir ön muhasebe programında modelin ürettiği bir
 *      rakam, yanlış cevaptan kötüdür — güvenilir görünür.
 *   2. HER KARTIN KAPISI VAR. Modül kapalıysa kart gürültüdür; sayfa kapalıysa
 *      kullanıcının o veriyi görme yetkisi yoktur ve kart, sayfa
 *      yetkilendirmesinin etrafından dolaşan bir kapı olurdu.
 *
 * Sinyalden farkı: sinyal DURUM listeler ("9 ürün minimumun altında"), kart
 * KARAR sunar ("bugün sipariş vermezsen 2 gün açıkta kalırsın, şu numarayı ara").
 * Ayrım `lib/otomasyon/tipler.ts` başlığında.
 *
 * Katalog ve kod şeması: `docs/otomasyonlar/KATALOG.md`
 */

import { canViewPage, type PagePermissions } from "@/lib/page-access"
import { isModuleEnabled } from "@/lib/modules"
import { money0, qty } from "@/lib/format"
import type { Kart, KartAksiyonu, KartKapisi, KartOnem } from "./tipler"
import { kartSirasi } from "./tipler"
import {
  tedarikPenceresindekiUrunler,
  type StokTukenmeSatiri,
} from "./veri/stok-tukenme"
import { negatifStokOzeti, type NegatifStokOzeti } from "./veri/negatif-stok"
import {
  islenmemisFaturaOzeti,
  type IslenmemisFaturaOzeti,
  PENCERE_GUN,
} from "./veri/islenmemis-fatura"
import { bekleyenTaslakOzeti, type BekleyenTaslakOzeti } from "./veri/bekleyen-taslak"
import {
  vadesiGecmisEvrakOzeti,
  type VadesiGecmisEvrakOzeti,
} from "./veri/vadesi-gecmis-cek"
import {
  musteriFiyatFarki,
  type FiyatFarkiOzeti,
  PENCERE_GUN as FIYAT_PENCERESI,
} from "./veri/musteri-fiyat-farki"
import { eksiKasaOzeti, KRITIK_ESIK, type EksiKasaOzeti } from "./veri/eksi-kasa"
import {
  vadesiGecmisAlacaklar,
  type GecikmisAlacak,
} from "./veri/vadesi-gecmis-alacak"
import {
  tersBakiyeOzeti,
  type TersBakiyeCarisi,
  type TersBakiyeOzeti,
} from "./veri/ters-bakiye"
import {
  acikAdisyonOzeti,
  YUKSEK_ESIK_GUN,
  type AcikAdisyonOzeti,
} from "./veri/acik-adisyon"
import {
  kdvDonemiOzeti,
  BEYAN_GUNU,
  type KdvDonemi,
} from "./veri/kdv-donemi"
import {
  musteriYogunlasmasi,
  PENCERE_AY as YOGUNLASMA_AY,
  type MusteriYogunlasmasi,
} from "./veri/musteri-yogunlasmasi"
import {
  gonderilemeyenOzeti,
  durumOzeti,
  type GonderilemeyenOzeti,
} from "./veri/gonderilemeyen-fatura"
import {
  donmeyenMusteriOzeti,
  type DonmeyenMusteriOzeti,
} from "./veri/donmeyen-musteri"
import {
  yanitBekleyenOzeti,
  YANIT_SURESI_GUN,
  type YanitBekleyenFatura,
  type YanitBekleyenOzeti,
} from "./veri/yanit-bekleyen-fatura"

export type KartBaglami = {
  companyId: string
  izinler: PagePermissions
  kapaliModuller: string[]
}

type KartTanimi = {
  kod: string
  /** Katalogdaki insan okur adı — kapalı kart listesinde bu görünür. */
  ad: string
  kapi: KartKapisi
  uret: (b: KartBaglami) => Promise<Kart[]>
}

const TANIMLAR: KartTanimi[] = [
  {
    kod: "K-STK-01",
    ad: "Tükenme + tedarik süresi",
    kapi: { modul: "stock", sayfa: "/stok/urunler" },
    async uret(b) {
      const satirlar = await tedarikPenceresindekiUrunler(b.companyId)
      return satirlar.map((s) => stokTukenmeKarti(s))
    },
  },

  {
    kod: "K-STK-09",
    ad: "Negatif stok",
    kapi: { modul: "stock", sayfa: "/stok/urunler" },
    async uret(b) {
      const ozet = await negatifStokOzeti(b.companyId)
      return ozet ? [negatifStokKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-BLG-01",
    ad: "İşlenmemiş gelen fatura",
    kapi: { modul: "purchase", sayfa: "/alis/gelen-e-faturalar" },
    async uret(b) {
      const ozet = await islenmemisFaturaOzeti(b.companyId)
      return ozet ? [islenmemisFaturaKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-BLG-04",
    ad: "Bekleyen taslak fatura",
    kapi: { modul: "sales", sayfa: "/satis/fatura" },
    async uret(b) {
      const ozet = await bekleyenTaslakOzeti(b.companyId)
      return ozet ? [bekleyenTaslakKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-NKT-06",
    ad: "Vadesi geçmiş portföy evrakı",
    kapi: { modul: "finance", sayfa: "/cek-senet/cek" },
    async uret(b) {
      const ozet = await vadesiGecmisEvrakOzeti(b.companyId)
      return ozet ? [vadesiGecmisEvrakKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-MUS-04",
    ad: "Aynı ürüne farklı müşteri fiyatı",
    kapi: { modul: "sales", sayfa: "/raporlar/satis" },
    async uret(b) {
      const ozet = await musteriFiyatFarki(b.companyId)
      return ozet ? [fiyatFarkiKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-NKT-08",
    ad: "Kasada eksi bakiye",
    kapi: { modul: "finance", sayfa: "/finans/kanallar" },
    async uret(b) {
      const ozet = await eksiKasaOzeti(b.companyId)
      return ozet ? [eksiKasaKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-THS-07",
    ad: "Vadesi geçmiş alacak",
    kapi: { modul: "sales", sayfa: "/cari/musteri" },
    async uret(b) {
      const satirlar = await vadesiGecmisAlacaklar(b.companyId)
      return satirlar.map((s) => gecikmisAlacakKarti(s))
    },
  },

  {
    kod: "K-THS-08",
    ad: "Faturasız tahsilat (müşteri bakiyesi ters yönde)",
    kapi: { modul: "sales", sayfa: "/cari/musteri" },
    async uret(b) {
      const ozet = await tersBakiyeOzeti(b.companyId, "musteri")
      return ozet ? [tersBakiyeKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-TDR-05",
    ad: "Tedarikçiye fazla ödeme",
    kapi: { modul: "purchase", sayfa: "/cari/tedarikci" },
    async uret(b) {
      const ozet = await tersBakiyeOzeti(b.companyId, "tedarikci")
      return ozet ? [tersBakiyeKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-BLG-08",
    ad: "Yanıt süresi dolan ticari fatura",
    kapi: { modul: "purchase", sayfa: "/alis/gelen-e-faturalar" },
    async uret(b) {
      const ozet = await yanitBekleyenOzeti(b.companyId)
      return ozet ? [yanitBekleyenKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-BLG-07",
    ad: "KDV beyan dönemi yaklaşıyor",
    kapi: { modul: "purchase", sayfa: "/alis/gelen-e-faturalar" },
    async uret(b) {
      const ozet = await kdvDonemiOzeti(b.companyId)
      return ozet ? [kdvDonemiKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-MUS-07",
    ad: "Tek müşteriye ciro bağımlılığı",
    kapi: { modul: "sales", sayfa: "/cari/musteri" },
    async uret(b) {
      const ozet = await musteriYogunlasmasi(b.companyId)
      return ozet ? [yogunlasmaKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-BLG-09",
    ad: "Entegratöre takılmış giden fatura",
    kapi: { modul: "sales", sayfa: "/satis/fatura" },
    async uret(b) {
      const ozet = await gonderilemeyenOzeti(b.companyId)
      return ozet ? [gonderilemeyenKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-MUS-06",
    ad: "Bir kez alıp dönmeyen müşteri",
    kapi: { modul: "sales", sayfa: "/cari/musteri" },
    async uret(b) {
      const ozet = await donmeyenMusteriOzeti(b.companyId)
      return ozet ? [donmeyenMusteriKarti(b.companyId, ozet)] : []
    },
  },

  {
    kod: "K-OPR-06",
    ad: "Gün devreden açık adisyon",
    kapi: { modul: "restaurant", sayfa: "/restoran/adisyonlar" },
    async uret(b) {
      const ozet = await acikAdisyonOzeti(b.companyId)
      return ozet ? [acikAdisyonKarti(b.companyId, ozet)] : []
    },
  },
]

/** K-STK-01'in tek satırdan kart üretimi. Sürüm: eşik veya metin değişirse artar. */
const K_STK_01_SURUM = 1

function stokTukenmeKarti(s: StokTukenmeSatiri): Kart {
  // Bugün sipariş verilse bile mal gelene kadar kaç gün açıkta kalınır.
  const acikGun = s.tedarikGun - s.kalanGun
  const gecKalindi = acikGun > 0

  const baslik = gecKalindi
    ? `Bugün sipariş versen bile ${s.ad} ${acikGun} gün stoksuz kalacak.`
    : `${s.ad} için son sipariş günü bugün.`

  const onem: KartOnem = gecKalindi || s.kalanGun <= 1 ? "kritik" : s.kalanGun <= 3 ? "yuksek" : "orta"

  const tedarikCumlesi = tedarikGerekcesi(s)

  const gerekce = [
    `Günde ${qty(s.gunlukHiz)} ${s.birim} gidiyor, elde ${qty(s.stok)} ${s.birim} var —` +
      ` bu hızla ${s.kalanGun} gün yeter.`,
    tedarikCumlesi,
    `Önerilen miktar ${qty(s.onerilenMiktar)} ${s.birim}, yaklaşık ${s.onerilenKapsamGun} günlük ihtiyaç.`,
  ].join(" ")

  const sonSiparisGun = s.kalanGun - s.tedarikGun
  const sonTarih =
    sonSiparisGun <= 0
      ? "Sipariş bugün verilmeli."
      : `Sipariş ${sonSiparisGun} gün içinde verilmeli.`

  return {
    kod: "K-STK-01",
    surum: K_STK_01_SURUM,
    onem,
    ozneTuru: "product",
    ozneId: s.id,
    baslik,
    gerekce,
    sonTarih,
    karsiTaraf: s.tedarikci
      ? {
          ad: s.tedarikci.ad,
          yetkili: s.tedarikci.yetkili,
          telefon: s.tedarikci.telefon,
          href: `/cari/suppliers/${s.tedarikci.id}`,
        }
      : undefined,
    aksiyonlar: [
      {
        anahtar: "siparis_olustur",
        etiket: "Sipariş oluştur",
        // Sipariş ekranı bu üçünü okuyup formu ön dolduruyor (AlisSiparisPage,
        // "Otomasyon kartından gelen ön dolgu"). Ürün SLUG değil ID ile
        // gönderilir: formdaki seçici ürünleri id ile eşliyor.
        href:
          `/alis/siparis?urun=${encodeURIComponent(s.id)}&miktar=${s.onerilenMiktar}` +
          (s.tedarikci ? `&tedarikci=${encodeURIComponent(s.tedarikci.id)}` : ""),
        birincil: true,
      },
      ...(s.tedarikci
        ? [
            {
              anahtar: "tedarikciyi_ara",
              etiket: "Tedarikçiyi aç",
              href: `/cari/suppliers/${s.tedarikci.id}`,
            },
          ]
        : []),
      {
        anahtar: "urunu_gor",
        etiket: "Ürünü gör",
        href: `/stok/${s.slug || s.id}`,
      },
    ],
    // Günlüğe yazılan ham ölçüm: "kart haklı çıktı mı" sonradan ancak bununla
    // sorulabilir. Eşik değişse bile bu satırlar geçmişi yeniden okutur.
    olcum: {
      stok: s.stok,
      birim: s.birim,
      gunlukHiz: s.gunlukHiz,
      kalanGun: s.kalanGun,
      tedarikGun: s.tedarikGun,
      tedarikKaynagi: s.tedarikKaynagi,
      tedarikOrnek: s.tedarikOrnek,
      onerilenMiktar: s.onerilenMiktar,
      acikGun: gecKalindi ? acikGun : 0,
      tedarikciId: s.tedarikci?.id ?? null,
    },
  }
}

/**
 * Tedarik süresinin nereden bilindiğini SÖYLER.
 *
 * Katalogdaki üçüncü veri kuralı: bilmiyorsan sus değil, söyle. Kullanıcı
 * kartın 4 günü nereden bulduğunu göremezse, bir kez yanıldığında kartların
 * tamamına güveni biter.
 */
function tedarikGerekcesi(s: StokTukenmeSatiri): string {
  const ad = s.tedarikci?.ad ?? "Tedarikçin"
  switch (s.tedarikKaynagi) {
    case "siparis":
      return `${ad} son ${s.tedarikOrnek} teslimde ortalama ${s.tedarikGun} günde getirdi.`
    case "alis-araligi":
      return (
        `${ad}'ın teslim süresini bilmiyorum; son ${s.tedarikOrnek} alışın arası` +
        ` ortalama ${s.tedarikGun} gün — onu esas aldım.`
      )
    default:
      return `Teslim süresini bilmiyorum, ${s.tedarikGun} gün varsaydım.`
  }
}

const K_STK_09_SURUM = 1

/**
 * K-STK-09 · Eksi stok bakiyesi.
 *
 * Diğer kartlardan farkı: burada bir SON TARİH yok, çünkü sorun gelecekte değil
 * GEÇMİŞTE. Anatomideki "sonuç" kuralı yine de geçerli — kartın söylediği sonuç
 * "şu an bakmakta olduğun maliyet ve kâr rakamları yanlış".
 */
export function negatifStokKarti(companyId: string, o: NegatifStokOzeti): Kart {
  const hepsiAlissiz = o.hicAlisiOlmayan === o.urunSayisi
  const teshis = hepsiAlissiz
    ? "Hiçbirinin alış faturası yok — bu ürünler sisteme hiç girilmeden satılmış."
    : o.hicAlisiOlmayan > 0
      ? `${o.hicAlisiOlmayan} tanesinin hiç alış faturası yok; kalanında alış eksik girilmiş.`
      : "Alışlar girilmiş ama satılan miktarı karşılamıyor."

  const ornekMetni = o.ornekler
    .map((s) => `${s.ad} (${qty(s.acik)} ${s.birim} açık)`)
    .join(", ")

  return {
    kod: "K-STK-09",
    surum: K_STK_09_SURUM,
    // Eksi stok kâr ve maliyeti bozar; adet arttıkça rapor tamamen güvenilmez olur.
    onem: o.urunSayisi >= 10 ? "kritik" : o.urunSayisi >= 3 ? "yuksek" : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: `${o.urunSayisi} üründe stok eksi görünüyor — maliyet ve kâr rakamlarınız yanlış çıkıyor.`,
    gerekce:
      `Toplam ${qty(o.toplamAcik)} birimlik açık var. ${teshis} ` +
      `En büyükleri: ${ornekMetni}. ` +
      `Eksi bakiyeli üründe birim maliyet hesaplanamaz; o ürünün kârı, ` +
      `stok değeri ve tükenme tahmini de yanlış olur.`,
    aksiyonlar: [
      {
        anahtar: "alis_faturasi_gir",
        etiket: "Alış faturası gir",
        href: "/alis/fatura",
        birincil: true,
      },
      {
        anahtar: "gelen_faturalari_ac",
        etiket: "Gelen faturalar",
        // Eksi stoğun en sık sebebi girilmemiş alış: aktarılmamış gelen faturalar
        // K-BLG-01 ile AYNI süzgeçle açılır, kullanıcı doğrudan oradan işler.
        href: `/alis/gelen-e-faturalar?gun=${PENCERE_GUN}&durum=KABUL&aktarim=unlinked`,
      },
      { anahtar: "urunleri_gor", etiket: "Ürünleri gör", href: "/stok/urunler" },
    ],
    olcum: {
      urunSayisi: o.urunSayisi,
      toplamAcik: o.toplamAcik,
      hicAlisiOlmayan: o.hicAlisiOlmayan,
      ornekler: o.ornekler.map((s) => ({ id: s.id, ad: s.ad, acik: s.acik })),
    },
  }
}

const K_BLG_01_SURUM = 1

/**
 * K-BLG-01 · Aktarılmamış gelen fatura.
 *
 * Kartın "sonuç"u parasal: aktarılmayan fatura gidere de KDV indirimine de
 * girmez. Tutar YALNIZ TRY faturalardan toplanır; döviz faturalar ayrıca
 * sayılır ve toplama katılmadıkları SÖYLENİR (gerekçesi veri dosyasında).
 */
function islenmemisFaturaKarti(companyId: string, o: IslenmemisFaturaOzeti): Kart {
  const dovizNotu =
    o.dovizAdet > 0
      ? ` Ayrıca ${o.dovizAdet} döviz faturası var; kurları karıştırmamak için TL toplamına katmadım.`
      : ""

  return {
    kod: "K-BLG-01",
    surum: K_BLG_01_SURUM,
    onem: o.adet >= 50 ? "kritik" : o.adet >= 10 ? "yuksek" : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: `${o.adet} gelen fatura aktarılmadı — ${money0(o.kdvTL)} KDV indirimi kayıtlarınızda yok.`,
    gerekce:
      `Kabul edilmiş ama alış faturasına dönüştürülmemiş ${o.adet} belge var, ` +
      `toplam ${money0(o.tutarTL)} gider.${dovizNotu} En eskisi ${o.enEskiGun} gün önce geldi. ` +
      `Aktarılmayan fatura ne gidere ne KDV indirimine girer; beyan döneminde eksik indirim demektir.`,
    // Kaçan KDV indirimi: kartın parasal karşılığı gider değil, ödenen fazla vergi.
    etki: o.kdvTL,
    sonTarih: `Beyan dönemi kapanmadan aktarılmalı. Son ${PENCERE_GUN} gün sayıldı.`,
    aksiyonlar: [
      {
        anahtar: "gelen_kutusunu_ac",
        etiket: "Gelen faturaları aç",
        // Kartın SAYDIĞI kayıtlar açılsın: ekran varsayılan 30 günde ve süzgeçsiz
        // açılıyordu, kart "517 fatura" derken liste SIFIR satır gösteriyordu
        // (2026-09-06). Param'lar buradaki üç süzgecin birebir karşılığı.
        href: `/alis/gelen-e-faturalar?gun=${PENCERE_GUN}&durum=KABUL&aktarim=unlinked`,
        birincil: true,
      },
      { anahtar: "alis_faturalarini_gor", etiket: "Alış faturaları", href: "/alis/fatura" },
    ],
    olcum: {
      adet: o.adet,
      tutarTL: o.tutarTL,
      kdvTL: o.kdvTL,
      dovizAdet: o.dovizAdet,
      enEskiGun: o.enEskiGun,
      pencereGun: PENCERE_GUN,
    },
  }
}

const K_BLG_04_SURUM = 1

/**
 * Liste ekranının kartı karşılayacak en dar penceresi.
 *
 * Fatura listesi hazır dönemlerle çalışıyor (30/90/180/365); aradaki bir sayı
 * seçiciyi boş bırakırdı. En eski belgeyi KAPSAYAN en küçük dönem seçilir —
 * daha geniş dönem, kartın konusu olmayan belgeleri de listeye sokardı.
 */
function listePenceresi(enEskiGun: number): number {
  return [30, 90, 180, 365].find((g) => g >= enEskiGun) ?? 365
}

/**
 * K-BLG-04 · Taslakta kalmış satış faturası.
 *
 * "Sonuç" burada gelirdir: taslak fatura ciroya girmez, tahsilat takibine
 * girmez, vadesi işlemez. Tutar yalnız TRY'den toplanır (K-BLG-01 ile aynı
 * gerekçe) ve döviz belgeler ayrıca sayılır.
 */
function bekleyenTaslakKarti(companyId: string, o: BekleyenTaslakOzeti): Kart {
  const dovizNotu =
    o.dovizAdet > 0
      ? ` Ayrıca ${o.dovizAdet} döviz belgesi var; kurları karıştırmamak için TL toplamına katmadım.`
      : ""

  const ornekMetni = o.ornekler
    .map((x) => `${x.no} (${money0(x.tutar)}, ${x.gun} gün)`)
    .join(", ")

  return {
    kod: "K-BLG-04",
    surum: K_BLG_04_SURUM,
    onem: o.adet >= 50 ? "kritik" : o.adet >= 10 ? "yuksek" : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    etki: o.tutarTL,
    baslik: `${o.adet} satış faturası taslakta kalmış — ${money0(o.tutarTL)} hiç faturalanmadı.`,
    gerekce:
      `En eskisi ${o.enEskiGun} gün önce açılmış.${dovizNotu} ` +
      `En büyükleri: ${ornekMetni}. ` +
      `Taslak belge ciroya girmez, tahsilat takibine düşmez ve vadesi işlemez — ` +
      `bu tutar ne raporlarınızda ne cari hesapta görünüyor.`,
    aksiyonlar: [
      // `/faturalar` bir MENÜ ANAHTARI, sayfa değil: altında yalnız [id] rotaları
      // var, index yok (page-access.ts ROUTE_OWNERS onu /satis|alis/fatura'ya
      // bağlar). Oraya link vermek kartı 404'e götürürdü.
      //
      // Pencere kartın kendi en eski belgesinden türer: 128 günlük taslak sayan
      // kart, ekranı varsayılan 90 günde açsaydı saydığı belgenin bir kısmı
      // listede HİÇ olmazdı. Durum süzgeci de sorgunun aynısı (DRAFT+GIB_DRAFT).
      {
        anahtar: "faturalari_ac",
        etiket: "Satış faturaları",
        href: `/satis/fatura?gun=${listePenceresi(o.enEskiGun)}&durum=DRAFT,GIB_DRAFT`,
        birincil: true,
      },
    ],
    olcum: {
      adet: o.adet,
      tutarTL: o.tutarTL,
      dovizAdet: o.dovizAdet,
      enEskiGun: o.enEskiGun,
      ornekler: o.ornekler,
    },
  }
}

const K_NKT_06_SURUM = 1

/**
 * K-NKT-06 · Vadesi geçtiği hâlde portföyde duran çek/senet.
 *
 * TOPLAM TUTAR YAZMAZ — evrakları tek tek sayar. Gerekçesi veri dosyasında:
 * tek bir saçma tutar, toplam alındığında kartın tamamını güvenilmez yapar.
 */
function vadesiGecmisEvrakKarti(companyId: string, o: VadesiGecmisEvrakOzeti): Kart {
  const yon =
    o.verilenAdet === 0
      ? "Hepsi sizin ALDIĞINIZ evrak: ya tahsil edildi ve kaydı düşülmedi, ya karşılıksız çıktı."
      : o.alinanAdet === 0
        ? "Hepsi sizin VERDİĞİNİZ evrak: ya ödendi ve kaydı düşülmedi, ya borç hâlâ açık."
        : `${o.alinanAdet} tanesi aldığınız, ${o.verilenAdet} tanesi verdiğiniz evrak.`

  const ornekMetni = o.ornekler
    .map(
      (e) =>
        `${e.tur === "cek" ? "Çek" : "Senet"} ${e.no}` +
        `${e.karsiTaraf ? ` · ${e.karsiTaraf}` : ""}` +
        ` · ${money0(e.tutar)} · ${e.gecikmeGun} gün gecikmiş`
    )
    .join(" | ")

  return {
    kod: "K-NKT-06",
    surum: K_NKT_06_SURUM,
    onem: o.enUzunGun >= 30 ? "kritik" : "yuksek",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: `${o.adet} çek/senet vadesi geçtiği hâlde hâlâ portföyde duruyor.`,
    gerekce:
      `${yon} En uzun bekleyen ${o.enUzunGun} gün geçmiş. ${ornekMetni}. ` +
      `Kapanmayan evrak nakit projeksiyonuna girmez ama cari bakiyesinde ` +
      `kapanmış gibi durur — iki tablo da yanlış okunur.`,
    aksiyonlar: [
      { anahtar: "cekleri_ac", etiket: "Çekleri aç", href: "/cek-senet/cek", birincil: true },
      { anahtar: "senetleri_ac", etiket: "Senetler", href: "/cek-senet/senet" },
    ],
    olcum: {
      adet: o.adet,
      alinanAdet: o.alinanAdet,
      verilenAdet: o.verilenAdet,
      enUzunGun: o.enUzunGun,
      ornekler: o.ornekler,
    },
  }
}

const K_MUS_04_SURUM = 1

/**
 * K-MUS-04 · Aynı ürün, müşteriden müşteriye farklı fiyat.
 *
 * SUÇLAMAZ, GÖSTERİR: farkın meşru sebebi olabilir (hacim iskontosu, sözleşme,
 * arada yapılan zam). Bu yüzden iki uç TARİHİYLE yazılır — okuyan kişi zammı
 * kendisi ayırt etsin. Gerekçe veri dosyasının başlığında.
 */
function fiyatFarkiKarti(companyId: string, o: FiyatFarkiOzeti): Kart {
  const tarih = (d: Date) =>
    new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(d)

  const ornekMetni = o.ornekler
    .map(
      (x) =>
        `${x.urun}: ${x.ucuzMusteri} ${money0(x.ucuzFiyat)} (${tarih(x.ucuzTarih)}) ↔ ` +
        `${x.pahaliMusteri} ${money0(x.pahaliFiyat)} (${tarih(x.pahaliTarih)}), %${x.farkYuzde} fark`
    )
    .join(" | ")

  return {
    kod: "K-MUS-04",
    surum: K_MUS_04_SURUM,
    onem: o.urunSayisi >= 5 ? "yuksek" : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: `${o.urunSayisi} üründe müşteriden müşteriye belirgin fiyat farkı var.`,
    gerekce:
      `Son ${FIYAT_PENCERESI} günde her müşterinin EN SON aldığı fiyat karşılaştırıldı ` +
      `(satır iskontosu düşülmüş, KDV hariç). ${ornekMetni}. ` +
      `Fark hacim iskontosu ya da arada yapılan zam olabilir — tarihler bunun için yazılı.`,
    aksiyonlar: [
      { anahtar: "satis_raporu", etiket: "Satış raporu", href: "/raporlar/satis", birincil: true },
      { anahtar: "urunleri_gor", etiket: "Ürünler", href: "/stok/urunler" },
    ],
    olcum: { urunSayisi: o.urunSayisi, pencereGun: FIYAT_PENCERESI, ornekler: o.ornekler },
  }
}

const K_NKT_08_SURUM = 1

/**
 * K-NKT-08 · Kasada eksi bakiye.
 *
 * TOPLAM DEĞİL, HESAP HESAP yazılır — K-NKT-06'daki gerekçenin aynısı: eksi
 * bakiyeler tek rakama toplanınca hangi kasanın kaç lira açık verdiği kaybolur,
 * oysa aksiyon tam olarak o kasanın ekstresine bakmaktır.
 *
 * Kart SUÇLAMAZ, hesabı gösterir: "para kayıp" demez, "bu kasa eksi görünüyor,
 * fiziksel olarak mümkün değil, kayıt eksik" der.
 */
function eksiKasaKarti(companyId: string, o: EksiKasaOzeti): Kart {
  const hesapMetni = o.ornekler.map((h) => `${h.ad} ${money0(h.bakiye)}`).join(" · ")
  const kalan = o.adet - o.ornekler.length

  return {
    kod: "K-NKT-08",
    surum: K_NKT_08_SURUM,
    onem: o.enDerin >= KRITIK_ESIK ? "kritik" : "yuksek",
    ozneTuru: "company",
    ozneId: companyId,
    baslik:
      o.adet === 1
        ? `${o.ornekler[0].ad} kasası ${money0(o.ornekler[0].bakiye)} görünüyor — kasa eksiye düşemez.`
        : `${o.adet} kasa eksi bakiyede — kasa eksiye düşemez.`,
    etki: o.enDerin,
    gerekce:
      `${hesapMetni}${kalan > 0 ? ` (+${kalan} kasa daha)` : ""}. ` +
      `Kasadaki nakit fiziksel olarak eksiye düşemez: ya bir tahsilat girilmemiş, ` +
      `ya bir ödeme yanlış kasadan işlenmiştir. Yanlış bakiye nakit raporunu ve ` +
      `projeksiyonu da olduğundan düşük gösterir.`,
    aksiyonlar: [
      { anahtar: "kasalari_ac", etiket: "Kasaları aç", href: "/finans/kanallar", birincil: true },
      { anahtar: "hareketleri_gor", etiket: "Hareketler", href: "/finans/hareketler" },
    ],
    olcum: {
      adet: o.adet,
      enDerin: o.enDerin,
      toplam: o.toplam,
      ornekler: o.ornekler,
    },
  }
}

const K_THS_07_SURUM = 1

/**
 * K-THS-07 · Vadesi geçmiş alacak.
 *
 * Kartların içinde KARŞI TARAFI en çok hak edeni bu: sonuç zaten "birini
 * aramak". Telefon `karsiTaraf`ta, ekstre birincil aksiyonda.
 *
 * TUTAR CARİ BAKİYEDİR, gecikmiş faturanın tutarı değil — ikisi ayrı sorulardır
 * ve gerekçe bunu açıkça söyler. Sebebi veri dosyasının başlığında: tahsilat
 * cariye işlenip faturaya bağlanmayınca fatura "ödenmemiş" görünüyor.
 */
function gecikmisAlacakKarti(a: GecikmisAlacak): Kart {
  const vadeCumlesi =
    a.vadeKaynagi === "alan"
      ? "Vade faturanın kendi vade tarihinden."
      : `Faturada vade tarihi yok; müşteri kartındaki ${a.vadeGunu} günlük vadeyi fatura tarihine ekledim.`

  return {
    kod: "K-THS-07",
    surum: K_THS_07_SURUM,
    // Bir ay ve üstü gecikme tahsilat sorununa dönüşmüş demektir.
    onem: a.gecikmeGun >= 30 ? "kritik" : a.gecikmeGun >= 14 ? "yuksek" : "orta",
    ozneTuru: "customer",
    ozneId: a.musteriId,
    etki: a.bakiye,
    baslik: `${a.ad} ${a.gecikmeGun} gündür geciken ödemesini yapmadı — ${money0(a.bakiye)} açık.`,
    gerekce:
      `${a.faturaAdet} faturanın vadesi geçti. ${vadeCumlesi} ` +
      `${money0(a.bakiye)} rakamı bu müşterinin CARİ BAKİYESİDİR: geciken faturaların yanında ` +
      `kapanmamış eski bakiye, tahsilatlar ve çek/senet de içindedir — cari listesindeki ` +
      `ve ekstredeki tutarın aynısı.`,
    sonTarih:
      a.gecikmeGun >= 30
        ? "Bir ayı geçti; bugün aranmalı."
        : "Gecikme büyümeden aranmalı.",
    karsiTaraf: {
      ad: a.ad,
      yetkili: a.yetkili,
      telefon: a.telefon,
      href: `/cari/customers/${a.slug || a.musteriId}`,
    },
    aksiyonlar: [
      {
        anahtar: "ekstreyi_ac",
        etiket: "Ekstreyi aç",
        href: `/cari/ekstre?customerId=${encodeURIComponent(a.musteriId)}`,
        birincil: true,
      },
      {
        anahtar: "cari_karti",
        etiket: "Cari kartı",
        href: `/cari/customers/${a.slug || a.musteriId}`,
      },
    ],
    olcum: {
      bakiye: a.bakiye,
      faturaAdet: a.faturaAdet,
      gecikmeGun: a.gecikmeGun,
      vadeKaynagi: a.vadeKaynagi,
      vadeGunu: a.vadeGunu,
    },
  }
}

const K_THS_08_SURUM = 1
const K_TDR_05_SURUM = 1

/**
 * K-THS-08 (müşteri) · K-TDR-05 (tedarikçi) — cari bakiyesi ters yöne dönmüş.
 *
 * TEK ÜRETİCİ, İKİ KOD: soru aynı, yalnız yön ve karşı taraf değişiyor. Metni
 * iki kopyaya bölmek, bir gün birinin cümlesi düzeltilip diğerinin unutulması
 * demekti. Kodlar ayrı çünkü günlükte "müşteriden fazla para" ile "tedarikçiye
 * fazla ödeme" ayrı sorulardır ve ayrı ekranlara götürürler.
 *
 * KART SUÇLAMAZ: ters bakiyenin iki meşru okuması var (avans / faturası
 * kesilmemiş iş) ve kart ikisini de söyleyip kararı kullanıcıya bırakır.
 * Gerekçesi ve elenen üç yanlış-pozitif sınıfı `veri/ters-bakiye.ts` başlığında.
 */
export function tersBakiyeKarti(companyId: string, o: TersBakiyeOzeti): Kart {
  const musteri = o.yon === "musteri"
  const ilk = o.ornekler[0]

  const listeMetni = o.ornekler
    .map((c) => `${c.ad} ${money0(c.tutar)}${faturaNotu(c)}`)
    .join(" · ")
  const kalan = o.adet - o.ornekler.length

  // Tek cari varsa kart onun adıyla konuşur — "3 müşteri" cümlesi tek kişilik
  // bir bulguda hem soğuk hem de aksiyonu belirsiz kalırdı.
  const baslik = tersBakiyeBasligi(o, ilk, musteri)

  const teshis = musteri
    ? `Bakiyenin alacaklıya dönmesi iki şeyden biridir: ya AVANS aldınız — o hâlde bu para ` +
      `gelir değil borçtur — ya da yapılmış bir satışın faturası kesilmemiştir; o hâlde ` +
      `cironuz ve hesaplanan KDV kayıtlarda eksik görünüyor.`
    : `Bunun iki sebebi olabilir: ya AVANS verdiniz — o hâlde bu para gider değil ` +
      `alacaktır — ya da aldığınız malın faturası sisteme girilmemiştir; girilmemiş fatura ` +
      `ne gidere ne KDV indirimine girer.`

  const gerekce =
    `${listeMetni}${kalan > 0 ? ` (+${kalan} cari daha)` : ""}. ` +
    `Bu tutarlar cari listesindeki bakiyedir ve ekstrede de aynı rakam görünür: ` +
    `fatura, tahsilat, çek/senet ve açılış bakiyesi birlikte hesaplanır. ` +
    `${musteri ? "Bu müşterilere kesilmiş alış faturası" : "Bu tedarikçilere kesilmiş satış faturası"} ` +
    `yok, yani bakiye mahsuptan doğmuyor.${ciftRolNotu(o, musteri)} ${teshis}`

  return {
    kod: musteri ? "K-THS-08" : "K-TDR-05",
    surum: musteri ? K_THS_08_SURUM : K_TDR_05_SURUM,
    // Hiç faturası olmayan cari en güçlü hâl: para hareket etmiş, belge yok.
    onem: o.faturasizAdet > 0 ? "yuksek" : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik,
    gerekce,
    etki: o.enBuyuk,
    // Tek cari varsa aranacak kişi bellidir; birden çoksa kart listeye götürür.
    karsiTaraf:
      o.adet === 1
        ? {
            ad: ilk.ad,
            yetkili: ilk.yetkili,
            telefon: ilk.telefon,
            href: `/cari/${musteri ? "customers" : "suppliers"}/${ilk.slug || ilk.id}`,
          }
        : undefined,
    aksiyonlar: tersBakiyeAksiyonlari(o, ilk, musteri),
    olcum: {
      yon: o.yon,
      adet: o.adet,
      faturasizAdet: o.faturasizAdet,
      enBuyuk: o.enBuyuk,
      ornekler: o.ornekler.map((c) => ({
        id: c.id,
        ad: c.ad,
        tutar: c.tutar,
        faturaAdet: c.faturaAdet,
        faturaToplam: c.faturaToplam,
      })),
    },
  }
}

/**
 * "Neye karşılık" parantezi.
 *
 * Toplam İADELERLE EKSİYE düşebilir (canlı veride bir tedarikçide 3 belgenin
 * neti −₺2.693): alınan maldan fazlası iade edilmiş. "3 fatura -₺2.693" cümlesi
 * okunmuyordu; iade edildiği SÖYLENİYOR, çünkü ters bakiyenin sebebi tam da o.
 */
function faturaNotu(c: TersBakiyeCarisi): string {
  if (c.faturaAdet === 0) return " (hiç fatura yok)"
  if (c.faturaToplam > 0) return ` (${c.faturaAdet} fatura ${money0(c.faturaToplam)})`
  return ` (${c.faturaAdet} belge, iadelerden sonra net ${money0(c.faturaToplam)})`
}

/**
 * Çift rollü cari uyarısı.
 *
 * Aynı iş ortağı hem müşteri hem tedarikçi olarak kayıtlıysa iki kaydın bakiyesi
 * AYRI durur — uygulama da öyle gösteriyor (ekstre tek kayıt açar). Kart mahsup
 * etmez ama sustuğunda okuyan kişi "ben bu firmayla zaten mahsuplaşıyorum" deyip
 * kartı haksız sayar. Bu yüzden ayrım cümlesi kartın içinde duruyor.
 */
function ciftRolNotu(o: TersBakiyeOzeti, musteri: boolean): string {
  if (!o.ciftRolVar) return ""
  return musteri
    ? " Listedeki cari(ler) tedarikçi olarak da kayıtlı; iki kaydın bakiyesi ayrı tutulur, mahsuplaşmaz."
    : " Listedeki cari(ler) müşteri olarak da kayıtlı; iki kaydın bakiyesi ayrı tutulur, mahsuplaşmaz."
}

function tersBakiyeBasligi(
  o: TersBakiyeOzeti,
  ilk: TersBakiyeCarisi,
  musteri: boolean
): string {
  if (o.adet > 1) {
    return musteri
      ? `${o.adet} müşteriden aldığınız para, onlara kestiğiniz faturayı aşıyor.`
      : `${o.adet} tedarikçiye borcunuzdan fazla ödeme yapılmış görünüyor.`
  }
  if (ilk.faturaAdet === 0) {
    return musteri
      ? `${ilk.ad} adına ${money0(ilk.tutar)} para girmiş ama karşılığında kesilmiş tek bir fatura yok.`
      : `${ilk.ad} için ${money0(ilk.tutar)} ödeme çıkmış ama karşılığında girilmiş tek bir alış faturası yok.`
  }
  return musteri
    ? `${ilk.ad}'dan kestiğiniz faturaların ${money0(ilk.tutar)} üstünde para almışsınız.`
    : `${ilk.ad}'a alış faturalarınızın ${money0(ilk.tutar)} üstünde ödeme yapılmış.`
}

function tersBakiyeAksiyonlari(
  o: TersBakiyeOzeti,
  ilk: TersBakiyeCarisi,
  musteri: boolean
): KartAksiyonu[] {
  // Tek caride birincil aksiyon EKSTRE: "bu para nereden geldi" sorusunun
  // cevabı orada, hareket hareket duruyor. Listede ise ekstre tek cari
  // istediği için kart cari listesine götürür.
  const ekstre = musteri
    ? `/cari/ekstre?customerId=${encodeURIComponent(ilk.id)}`
    : `/cari/ekstre?supplierId=${encodeURIComponent(ilk.id)}`

  if (o.adet === 1) {
    return [
      { anahtar: "ekstreyi_ac", etiket: "Ekstreyi aç", href: ekstre, birincil: true },
      {
        anahtar: "cari_karti",
        etiket: "Cari kartı",
        href: `/cari/${musteri ? "customers" : "suppliers"}/${ilk.slug || ilk.id}`,
      },
      ...tersBakiyeBelgeAksiyonu(musteri),
    ]
  }

  return [
    {
      anahtar: musteri ? "musterileri_ac" : "tedarikcileri_ac",
      etiket: musteri ? "Müşteri listesi" : "Tedarikçi listesi",
      href: musteri ? "/cari/musteri" : "/cari/tedarikci",
      birincil: true,
    },
    { anahtar: "ekstreyi_ac", etiket: `${ilk.ad} ekstresi`, href: ekstre },
    ...tersBakiyeBelgeAksiyonu(musteri),
  ]
}

/**
 * "Eksik olan belgeyi ver" aksiyonu.
 *
 * Tedarikçi tarafında ikinci bir yol daha var ve pratikte en olası olan bu:
 * fatura ZATEN gelmiştir, gelen kutusunda aktarılmayı bekliyordur. Süzgeç
 * K-BLG-01'in birebir aynısı — iki kart aynı kayıt kümesini açmalı.
 */
function tersBakiyeBelgeAksiyonu(musteri: boolean): KartAksiyonu[] {
  return musteri
    ? [{ anahtar: "fatura_kes", etiket: "Satış faturaları", href: "/satis/fatura" }]
    : [
        {
          anahtar: "gelen_faturalari_ac",
          etiket: "Gelen faturalar",
          href: `/alis/gelen-e-faturalar?gun=${PENCERE_GUN}&durum=KABUL&aktarim=unlinked`,
        },
        { anahtar: "alis_faturasi_gir", etiket: "Alış faturaları", href: "/alis/fatura" },
      ]
}

const K_OPR_06_SURUM = 1

/**
 * K-OPR-06 · Gün devreden açık adisyon.
 *
 * KARTIN SONUCU CİRODUR: adisyon kapanmadan fiş kesilmez, yani o masanın satışı
 * ne ciroya girer ne stoktan düşer (`lib/restoran/tickets.ts`). "Masa açık"
 * bilgisi kafede normaldir; kartı ayakta tutan şey, açık kalmanın RAKAMLARA ne
 * yaptığını söylemesidir.
 *
 * Boş adisyon (kalemi olmayan masa) ayrı sayılır ve ayrı cümlede geçer: onun
 * cirosu yok, yalnız masa planında yer tutuyor. İkisini toplamak "₺0'lık satış
 * kayıp" demek olurdu.
 */
function acikAdisyonBasligi(o: AcikAdisyonOzeti, hepsiBos: boolean): string {
  const ilk = o.ornekler[0]
  const masa = ilk.masa || ilk.kod
  if (o.adet > 1) {
    return `${o.adet} adisyon kapatılmadan gün devretmiş; en eskisi ${o.enUzunGun} gündür açık.`
  }
  // Boş masaya "satışı rapora girmedi" demek yanlış olurdu: ortada satış YOK.
  return hepsiBos
    ? `${masa} ${ilk.gun} gündür açık duruyor ama içine hiç kalem girilmemiş.`
    : `${masa} masasının hesabı ${ilk.gun} gündür açık — kapanmadığı için satışı hiçbir rapora girmedi.`
}

export function acikAdisyonKarti(companyId: string, o: AcikAdisyonOzeti): Kart {
  const dolu = o.adet - o.bosAdet
  const ilk = o.ornekler[0]
  const masaAdi = (a: { masa: string | null; kod: string }) => a.masa || a.kod

  const listeMetni = o.ornekler
    .map(
      (a) =>
        `${masaAdi(a)} · ${a.gun} gün` +
        (a.kalemAdet === 0 ? " · boş" : ` · ${money0(a.tutar)}`)
    )
    .join(" | ")

  // Boş adisyon (hiç kalem girilmemiş masa) AYRI cümle: onda kaybolan ciro yok.
  // Tek adisyonluk kartta cümle "1 adisyonda" diye tekrar etmesin diye, kartın
  // tamamı boşsa metin baştan boş adisyona göre kurulur.
  const hepsiBos = dolu === 0
  const bosNotu =
    !hepsiBos && o.bosAdet > 0
      ? ` ${o.bosAdet} adisyonda hiç kalem yok — onlarda kaybolan ciro değil, masanın kendisi: plan üzerinde dolu görünüyor.`
      : ""

  return {
    kod: "K-OPR-06",
    surum: K_OPR_06_SURUM,
    onem: o.enUzunGun >= YUKSEK_ESIK_GUN ? "yuksek" : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: acikAdisyonBasligi(o, hepsiBos),
    gerekce:
      `${listeMetni}. ` +
      (hepsiBos
        ? `${o.adet === 1 ? "İçinde" : "Hiçbirinde"} kalem yok: kaybolan ciro yok ama ` +
          `masa plan üzerinde dolu görünüyor ve gün sonu listesinden düşmüyor.`
        : `Kapanmayan adisyonda fiş kesilmediği için ${money0(o.toplamTutar)} ciroya girmedi ve ` +
          `kalemlerin malzemesi stoktan düşmedi — satış ve stok rakamları o kadar eksik.`) +
      bosNotu,
    // Ciroya girmemiş tutar; boş adisyonlar bu toplamda zaten 0.
    etki: o.toplamTutar,
    sonTarih: "Gün sonu alınmadan kapatılmalı.",
    aksiyonlar: [
      o.adet === 1
        ? {
            anahtar: "adisyonu_ac",
            etiket: "Adisyonu aç",
            href: `/restoran/adisyon/${ilk.id}`,
            birincil: true,
          }
        : {
            anahtar: "adisyonlari_ac",
            etiket: "Adisyonlar",
            // Ekran bugüne bakarken TÜM açık adisyonları da yüklüyor
            // (`useOpenTickets`) ve açıkları listenin başına sıralıyor: kartın
            // saydığı 32 günlük adisyon varsayılan görünümde görünür.
            href: "/restoran/adisyonlar",
            birincil: true,
          },
      { anahtar: "gun_sonu", etiket: "Gün sonu", href: "/restoran/gun-sonu" },
      { anahtar: "masalar", etiket: "Masalar", href: "/restoran/masalar" },
    ],
    olcum: {
      adet: o.adet,
      bosAdet: o.bosAdet,
      enUzunGun: o.enUzunGun,
      toplamTutar: o.toplamTutar,
      ornekler: o.ornekler,
    },
  }
}

const K_BLG_08_SURUM = 1

/**
 * K-BLG-08 · Ticari faturanın 8 günlük yanıt süresi.
 *
 * İKİ DAL, TEK KOD: aynı belge kümesi iki durumda olabilir ve kart hangisinde
 * olduğunu söyler.
 *   • Süre işliyor  → aksiyon "kabul et ya da reddet", son tarih gerçek.
 *   • Süre dolmuş   → red hakkı bitti, fatura kabul edilmiş SAYILIYOR; kalan iş
 *                     onu kayda geçirmek (gider + KDV indirimi).
 * Kod bölünmedi çünkü soru tek: "yanıtlanmamış ticari faturan var mı". Günlük
 * ikisini `olcum.acikAdet` / `olcum.gecmisAdet` ile zaten ayırt ediyor.
 */
export function yanitBekleyenKarti(companyId: string, o: YanitBekleyenOzeti): Kart {
  const sureVar = o.acikAdet > 0 && o.enYakinKalan !== null
  const ilk = o.ornekler[0]

  const listeMetni = o.ornekler
    .map(
      (f) =>
        `${f.gonderen ?? "Gönderen yok"} ${f.no ?? ""}`.trim() +
        ` · ${money0(f.tutar)}` +
        (f.kalanGun < 0 ? ` · süre ${-f.kalanGun} gün önce doldu` : ` · ${kalanMetni(f.kalanGun)}`)
    )
    .join(" | ")

  const dovizNotu =
    o.dovizAdet > 0
      ? ` ${o.dovizAdet} döviz faturası var; kurları karıştırmamak için TL toplamına katmadım.`
      : ""

  const gecmisNotu =
    sureVar && o.gecmisAdet > 0
      ? ` Ayrıca ${o.gecmisAdet} faturanın süresi çoktan dolmuş: onlar artık reddedilemez ` +
        `ama hâlâ kabul de edilmediği için gider ve KDV indirimine girmiyorlar.`
      : ""

  return {
    kod: "K-BLG-08",
    surum: K_BLG_08_SURUM,
    // Süre işliyorsa kart tarihe göre yanar; süresi tamamen geçmiş kuyruk artık
    // bir son tarih değil, kayıt işidir.
    onem: !sureVar ? "orta" : (o.enYakinKalan as number) <= 1 ? "kritik" : "yuksek",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: yanitBekleyenBasligi(o, sureVar, ilk),
    gerekce:
      `${listeMetni}${o.adet > o.ornekler.length ? ` (+${o.adet - o.ornekler.length} fatura daha)` : ""}. ` +
      `Toplam ${money0(o.tutarTL)}.${dovizNotu} ` +
      `Ticari faturaya ${YANIT_SURESI_GUN} gün içinde red yanıtı verilmezse fatura kabul edilmiş ` +
      `sayılır — itiraz hakkı bu süreyle sınırlıdır. Süre FATURA TARİHİNDEN işler; ` +
      `zarfın size ulaştığı tarihten değil.${gecmisNotu}`,
    sonTarih: sureVar
      ? (o.enYakinKalan as number) === 0
        ? "Bugün son gün: bugün yanıt verilmezse kabul edilmiş sayılacak."
        : `En yakın belgede ${o.enYakinKalan} gün kaldı.`
      : `Red süresi doldu; kalan iş bu belgeleri kayda geçirmek.`,
    etki: o.tutarTL,
    aksiyonlar: [
      {
        anahtar: "bekleyenleri_ac",
        etiket: "Yanıt bekleyenler",
        // Ekranın "BEKLEMEDE" süzgeci = terminal olmayan her durum; kartın
        // saydığı küme bunun içinde (bkz. veri dosyası).
        href: `/alis/gelen-e-faturalar?gun=${o.ekranDonemi}&durum=BEKLEMEDE`,
        birincil: true,
      },
      ...(o.adet === 1
        ? [
            {
              anahtar: "faturayi_ac",
              etiket: "Faturayı aç",
              href: `/alis/gelen-e-faturalar/${ilk.uuid}`,
            },
          ]
        : []),
      { anahtar: "alis_faturalarini_gor", etiket: "Alış faturaları", href: "/alis/fatura" },
    ],
    olcum: {
      adet: o.adet,
      acikAdet: o.acikAdet,
      gecmisAdet: o.gecmisAdet,
      enYakinKalan: o.enYakinKalan,
      enEskiGun: o.enEskiGun,
      tutarTL: o.tutarTL,
      dovizAdet: o.dovizAdet,
      sureGun: YANIT_SURESI_GUN,
      ornekler: o.ornekler,
    },
  }
}

function kalanMetni(kalan: number): string {
  return kalan === 0 ? "bugün son gün" : `${kalan} gün kaldı`
}

function yanitBekleyenBasligi(
  o: YanitBekleyenOzeti,
  sureVar: boolean,
  ilk: YanitBekleyenFatura
): string {
  if (!sureVar) {
    return (
      `${o.adet} ticari fatura yanıtsız kaldı — ${YANIT_SURESI_GUN} günlük red süresi ` +
      `geçtiği için kabul edilmiş sayılıyorlar.`
    )
  }
  if (o.acikAdet === 1) {
    return (
      `${ilk.gonderen ?? "Bir gönderici"} faturasına ${kalanMetni(ilk.kalanGun)} — ` +
      `${money0(ilk.tutar)}, yanıt verilmezse kabul edilmiş sayılacak.`
    )
  }
  return (
    `${o.acikAdet} ticari faturanın yanıt süresi doluyor; en yakınında ` +
    `${kalanMetni(o.enYakinKalan as number)}.`
  )
}

const K_MUS_06_SURUM = 1

/**
 * K-MUS-06 · Bir kez alıp geri dönmeyen müşteri.
 *
 * Kartların çoğu bir HATAYI gösteriyor; bu bir FIRSATI gösteriyor ve tek
 * aksiyonu var: telefonu aç. Bu yüzden karşı taraf bloğu kartın merkezinde —
 * tek müşteri varsa doğrudan onun numarası, birden çoksa en büyük cirolu üçü
 * adıyla ve tutarıyla yazılıyor.
 *
 * EŞİĞİ KART DEĞİL FİRMA BELİRLİYOR: "kaç gün sessizlik kayıptır" sorusunun
 * cevabı firmanın kendi tekrar-alım ritminden türetiliyor ve gerekçede o hesap
 * açıkça yazılı (bkz. veri dosyası). Sabit bir gün sayısı, kartı sektörlerin
 * yarısında haksız çıkarırdı.
 */
export function donmeyenMusteriKarti(companyId: string, o: DonmeyenMusteriOzeti): Kart {
  const ilk = o.ornekler[0]
  const listeMetni = o.ornekler
    .map((m) => `${m.ad} ${money0(m.ciro)} · ${m.gun} gün önce`)
    .join(" | ")
  const kalan = o.adet - o.ornekler.length

  const esikCumlesi =
    o.kaynak === "ritim"
      ? `Eşiği firmanızın kendi ritminden aldım: geri dönen ${o.ritimOrnek} müşterinin ` +
        `dörtte üçü ${o.ritimGun} gün içinde ikinci alışını yapmış, ben bunun iki katını ` +
        `(${o.esikGun} gün) sınır saydım.`
      : `Geri dönen müşteri sayısı ritim ölçmeye yetmediği için ${o.esikGun} günlük ` +
        `genel bir sınır kullandım.`

  return {
    kod: "K-MUS-06",
    surum: K_MUS_06_SURUM,
    // Kayıp müşteri acil değil ama soğuyor: kart orta kademede durur, sıralamada
    // parasal etkisiyle yarışır (bkz. tipler.ts → Kart.etki).
    onem: "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik:
      o.adet === 1
        ? `${ilk.ad} bir kez alışveriş yapıp ${ilk.gun} gündür geri gelmedi — ${money0(ilk.ciro)} ciro.`
        : `${o.adet} müşteri bir kez alıp bir daha gelmedi; birlikte ${money0(o.toplamCiro)} ciro yapmışlardı.`,
    gerekce:
      `${listeMetni}${kalan > 0 ? ` (+${kalan} müşteri daha)` : ""}. ` +
      `${esikCumlesi} ` +
      `Bu kişiler ürünü bir kez denemiş ve bir daha dönmemiş: sebebini yalnız ` +
      `arayınca öğrenirsiniz — yeni müşteri bulmaktan ucuz olan taraf da burasıdır.`,
    karsiTaraf:
      o.adet === 1
        ? {
            ad: ilk.ad,
            yetkili: ilk.yetkili,
            telefon: ilk.telefon,
            href: `/cari/customers/${ilk.slug || ilk.id}`,
          }
        : undefined,
    etki: o.toplamCiro,
    aksiyonlar: [
      o.adet === 1
        ? {
            anahtar: "cari_karti",
            etiket: "Cari kartı",
            href: `/cari/customers/${ilk.slug || ilk.id}`,
            birincil: true,
          }
        : {
            anahtar: "musterileri_ac",
            etiket: "Müşteri listesi",
            href: "/cari/musteri",
            birincil: true,
          },
      { anahtar: "satis_raporu", etiket: "Satış raporu", href: "/raporlar/satis" },
    ],
    olcum: {
      adet: o.adet,
      toplamCiro: o.toplamCiro,
      esikGun: o.esikGun,
      kaynak: o.kaynak,
      ritimGun: o.ritimGun,
      ritimOrnek: o.ritimOrnek,
      ornekler: o.ornekler.map((m) => ({ id: m.id, ad: m.ad, ciro: m.ciro, gun: m.gun })),
    },
  }
}

const K_BLG_09_SURUM = 1

/**
 * K-BLG-09 · "Gönderildi" görünen ama entegratörde hata almış fatura.
 *
 * KART EŞİK KULLANMAZ: söylediği tek şey entegratörün kendi yazdığı durumdur.
 * Bu yüzden hem her zaman haklıdır hem de en yüksek önem kademesinde durur —
 * ortada satış var, cari borçlu, resmî belge yok.
 */
export function gonderilemeyenKarti(companyId: string, o: GonderilemeyenOzeti): Kart {
  const ilk = o.ornekler[0]

  const listeMetni = o.ornekler
    .map(
      (f) =>
        `${f.no}${f.musteri ? ` · ${f.musteri}` : ""} · ${money0(f.tutar)} · ${f.gun} gün` +
        ` · ${durumOzeti(f.durum)}`
    )
    .join(" | ")
  const kalan = o.adet - o.ornekler.length

  const belgeNotu =
    o.belgesizAdet > 0
      ? ` ${o.belgesizAdet} tanesinde resmî belge numarası hiç alınamamış: o belgeler GİB'e ULAŞMADI.`
      : ""

  return {
    kod: "K-BLG-09",
    surum: K_BLG_09_SURUM,
    onem: "kritik",
    ozneTuru: "company",
    ozneId: companyId,
    baslik:
      o.adet === 1
        ? `${ilk.no} faturası panelde gönderildi görünüyor ama entegratörde hata almış.`
        : `${o.adet} fatura gönderildi görünüyor ama entegratöre takılmış.`,
    gerekce:
      `${listeMetni}${kalan > 0 ? ` (+${kalan} fatura daha)` : ""}.${belgeNotu} ` +
      `Panelde "gönderildi" yazan belge cariye işlenir, ciroya girer ve tahsilat ` +
      `takibine düşer; entegratör hatası bunların hiçbirini geri almaz. Yani satış ` +
      `kayıtlarınızda var, GİB tarafında yok — fark genelde müşteri "faturam gelmedi" ` +
      `diye arayınca ya da beyan döneminde çıkar. En eskisi ${o.enEskiGun} gündür bu hâlde.`,
    sonTarih: "Belgeler yeniden gönderilmeli; gecikme beyan dönemini de etkiler.",
    etki: o.toplamTutar,
    aksiyonlar: [
      o.adet === 1
        ? {
            anahtar: "faturayi_ac",
            etiket: "Faturayı aç",
            // `/faturalar/[id]` diye bir sayfa YOK — belge detayı önizleme
            // rotasında duruyor ve liste de oraya bağlanıyor (faturalar-listing).
            // Nöbetçi test bunu yakaladı; ilk yazımda 404'e gidiyordu.
            href: `/faturalar/${ilk.slug || ilk.id}/onizleme`,
            birincil: true,
          }
        : {
            anahtar: "faturalari_ac",
            etiket: "Satış faturaları",
            // PENCERE ŞART: liste varsayılan 90 günde açılıyor, kartın en eski
            // takılı belgesi ise 117 günlük. Tarayıcı denetiminde yakalandı —
            // ekran 55 satır gösteriyor ve kartın saydığı 6 belgenin dördü
            // listede HİÇ yoktu (2026-09-06'da K-BLG-01'de yaşananın aynısı).
            href: `/satis/fatura?gun=${listePenceresi(o.enEskiGun)}&durum=SENT`,
            birincil: true,
          },
      { anahtar: "e_donusum", etiket: "e-Dönüşüm ayarları", href: "/ayarlar/e-donusum" },
    ],
    olcum: {
      adet: o.adet,
      toplamTutar: o.toplamTutar,
      belgesizAdet: o.belgesizAdet,
      enEskiGun: o.enEskiGun,
      // Durum metni KISALTILMADAN günlüğe yazılıyor: hangi hata sınıfının ne
      // sıklıkta çıktığı sonradan ancak buradan sayılabilir.
      ornekler: o.ornekler,
    },
  }
}

const K_MUS_07_SURUM = 1

/**
 * K-MUS-07 · Tek müşteriye ciro bağımlılığı.
 *
 * Kartların çoğu bir HATAYI ya da FIRSATI gösteriyor; bu bir RİSKİ gösteriyor.
 * Anatominin "sonuç" kuralı burada şu cümleyle karşılanıyor: bu müşteri bir
 * çeyrek sipariş vermezse cironun yüzde kaçı gider. Açık bakiye yanına
 * konuyor, çünkü bağımlılığın somut hâli tam olarak orada: hem cironun büyük
 * kısmı hem de tahsil edilmemiş paranın büyük kısmı aynı kapıya bağlıysa risk
 * iki katına çıkar.
 */
export function yogunlasmaKarti(companyId: string, o: MusteriYogunlasmasi): Kart {
  const yuzde = Math.round(o.pay * 100)
  const ilkUc = Math.round(o.ilkUcPay * 100)

  const bakiyeCumlesi =
    o.bakiye > 1
      ? `Üstelik bu müşterinin ${money0(o.bakiye)} açık bakiyesi var: cironuz da alacağınız da aynı kapıya bağlı.`
      : o.bakiye < -1
        ? `Bu müşterinin bakiyesi ${money0(Math.abs(o.bakiye))} sizin lehinize dönmüş durumda (avans ya da faturası kesilmemiş iş).`
        : `Bu müşterinin açık bakiyesi yok — bugün için tahsilat riski taşımıyor.`

  return {
    kod: "K-MUS-07",
    surum: K_MUS_07_SURUM,
    // Üçte ikiyi aşan bağımlılık, tek müşterinin kararının işletmeyi
    // yönetebildiği eşiktir.
    onem: yuzde >= 60 ? "yuksek" : "orta",
    ozneTuru: "customer",
    ozneId: o.musteriId,
    // TÜRKÇE EK KULLANILMIYOR: "%72'si" ile "%48'i" arasındaki fark sayının
    // OKUNUŞUNA bağlı (yetmiş iki-si, kırk sekiz-i) ve şablondan üretilemez.
    // Cümleler eki gerektirmeyecek biçimde kuruldu; para tutarları için de aynı
    // tuzak var ("₺1.000.000'si" yanlış, "milyonu" olmalıydı).
    baslik: `Son ${YOGUNLASMA_AY} ayın cirosunda tek müşterinin payı %${yuzde} — ${o.ad}.`,
    gerekce:
      `${o.musteriSayisi} müşteriye toplam ${money0(o.toplamCiro)} fatura kesilmiş; ` +
      `${money0(o.ciro)} tutarındaki kısmı tek başına bu müşteriden geliyor. ` +
      `İlk üç müşteri birlikte %${ilkUc}. ` +
      `${bakiyeCumlesi} ` +
      `Bu bir hata değil, bir bağımlılık ölçüsüdür: bu müşteri bir dönem sipariş ` +
      `vermediğinde cironuzun %${yuzde}'lik kısmı o dönem gelmeyecek demektir.`,
    karsiTaraf: {
      ad: o.ad,
      yetkili: o.yetkili,
      telefon: o.telefon,
      href: `/cari/customers/${o.slug || o.musteriId}`,
    },
    etki: o.ciro,
    aksiyonlar: [
      {
        anahtar: "cari_karti",
        etiket: "Cari kartı",
        href: `/cari/customers/${o.slug || o.musteriId}`,
        birincil: true,
      },
      {
        anahtar: "ekstreyi_ac",
        etiket: "Ekstreyi aç",
        href: `/cari/ekstre?customerId=${encodeURIComponent(o.musteriId)}`,
      },
      { anahtar: "satis_raporu", etiket: "Satış raporu", href: "/raporlar/satis" },
    ],
    olcum: {
      pay: o.pay,
      ciro: o.ciro,
      toplamCiro: o.toplamCiro,
      musteriSayisi: o.musteriSayisi,
      ilkUcPay: o.ilkUcPay,
      bakiye: o.bakiye,
      pencereAy: YOGUNLASMA_AY,
    },
  }
}

const K_BLG_07_SURUM = 1

/**
 * K-BLG-07 · KDV beyan dönemi + o döneme ait kaçan indirim.
 *
 * Kart bir BEYANNAME DEĞİL, beyan öncesi kontrol listesidir ve bunu cümle içinde
 * söyler: devreden KDV, tevkifat, istisna ve iade hesaba girmiyor. Rakamı
 * beyanname yerine koyduran bir cümle, bu kartın yapabileceği en zararlı şey
 * olurdu (gerekçe `veri/kdv-donemi.ts` başlığında).
 *
 * KARTIN ASIL KONUSU KAÇAN İNDİRİM: aktarılmamış gelen fatura beyana girmez.
 * K-BLG-01 aynı belgeleri süresiz bir kuyruk olarak sayıyor; bu kart onları
 * TAKVİME bağlıyor.
 */
export function kdvDonemiKarti(companyId: string, o: KdvDonemi): Kart {
  const kacanVar = o.kacanAdet > 0 && o.kacanKdv > 0

  // Tek bir fatura toplamı ele geçiriyorsa okuyan kişi görsün: veride
  // ₺24,5 milyarlık sahte kayıtlar var (bkz. veri dosyası).
  const tekKayitBaskin = kacanVar && o.kacanEnBuyuk > o.kacanKdv * 0.5
  const enBuyukNotu = tekKayitBaskin
    ? ` Bunun ${money0(o.kacanEnBuyuk)} kadarı TEK faturadan geliyor — tutar beklediğinizden büyükse önce o belgeyi kontrol edin.`
    : ""

  const gunMetni =
    o.kalanGun === 0 ? "bugün son gün" : `${o.kalanGun} gün kaldı`

  // Cümleler AYRI kuruluyor çünkü dört durum var ve ikisi ölçümde çıktı:
  // hiç satış faturası olmayan dönem (HİDROEREN) ve iadeler yüzünden NET
  // İNDİRİMİ EKSİYE düşen dönem (Reypo, −₺155). "Alış faturası yok" cümlesini
  // tutara bakarak kurmak, altı belgesi olan firmaya "hiç belge yok" derdi.
  const satisCumlesi =
    o.satisAdet === 0
      ? "Bu dönemde kesilmiş satış faturası yok."
      : `${o.satisAdet} satış faturasında ${money0(o.hesaplananKdv)} hesaplanan KDV var.`

  const indirimCumlesi =
    o.alisAdet === 0
      ? "Sisteme girilmiş tek bir alış faturası yok: indirilecek KDV sıfır."
      : o.indirilecekKdv >= 0
        ? `${o.alisAdet} alış belgesinden ${money0(o.indirilecekKdv)} indirilecek KDV var.`
        : `${o.alisAdet} alış belgesi var ama iadeler ağır bastığı için net indirim ${money0(o.indirilecekKdv)}.`

  const farkCumlesi =
    o.satisAdet === 0 && o.alisAdet === 0
      ? ""
      : o.fark >= 0
        ? `Aradaki fark ${money0(o.fark)}. `
        : `İndirilecek KDV hesaplananı ${money0(-o.fark)} aşıyor; bu fark devreden KDV olur. `

  return {
    kod: "K-BLG-07",
    surum: K_BLG_07_SURUM,
    // Kaçan indirim varsa iş yapılabilir ve süre işliyor; yoksa kart yalnız
    // hatırlatmadır.
    onem: kacanVar ? (o.kalanGun <= 3 ? "kritik" : "yuksek") : "orta",
    ozneTuru: "company",
    ozneId: companyId,
    baslik: kacanVar
      ? `${o.donemAdi} KDV beyanına ${gunMetni} — aktarılmamış ${o.kacanAdet} faturadaki ${money0(o.kacanKdv)} indirim bu beyana girmeyecek.`
      : `${o.donemAdi} KDV beyanına ${gunMetni}.`,
    gerekce:
      `${satisCumlesi} ${indirimCumlesi} ${farkCumlesi}` +
      (kacanVar
        ? `Aynı döneme ait ${o.kacanAdet} gelen fatura kabul edilmiş ama alış faturasına ` +
          `dönüştürülmemiş; içindeki ${money0(o.kacanKdv)} KDV, aktarılmadığı sürece bu ` +
          `dönemin indirimine giremez.${enBuyukNotu} `
        : "") +
      `Bu bir beyanname değildir: devreden KDV, tevkifat, istisna ve iade hesaba ` +
      `katılmadı — buradaki rakamlar yalnız sistemdeki belgelerden görüneni söyler.`,
    sonTarih: `Beyan ve ödeme ${o.beyanTarihi} (aylık mükellefiyet varsayıldı).`,
    // Parasal ağırlık KAÇAN İNDİRİMDİR: kartın aksiyonla geri kazandırdığı tutar.
    etki: o.kacanKdv,
    aksiyonlar: [
      {
        anahtar: "gelen_kutusunu_ac",
        etiket: "Aktarılmamış faturalar",
        // K-BLG-01 ile AYNI süzgeç: kartın saydığı belgeler listede görünmeli.
        href: `/alis/gelen-e-faturalar?gun=${PENCERE_GUN}&durum=KABUL&aktarim=unlinked`,
        birincil: true,
      },
      { anahtar: "alis_faturalarini_gor", etiket: "Alış faturaları", href: "/alis/fatura" },
      { anahtar: "kdv_raporu", etiket: "Vergi raporu", href: "/raporlar/vergi" },
    ],
    olcum: {
      donem: o.donem,
      kalanGun: o.kalanGun,
      beyanGunu: BEYAN_GUNU,
      hesaplananKdv: o.hesaplananKdv,
      indirilecekKdv: o.indirilecekKdv,
      fark: o.fark,
      satisAdet: o.satisAdet,
      alisAdet: o.alisAdet,
      kacanAdet: o.kacanAdet,
      kacanKdv: o.kacanKdv,
      kacanEnBuyuk: o.kacanEnBuyuk,
    },
  }
}

/** Kartın kapısı bu kullanıcı için açık mı? */
function kapiAcik(kapi: KartKapisi, b: KartBaglami): boolean {
  if (kapi.modul && !isModuleEnabled(b.kapaliModuller, kapi.modul)) return false
  if (kapi.sayfa && !canViewPage(b.izinler, kapi.sayfa)) return false
  return true
}

export type KartSonucu = {
  kartlar: Kart[]
  /** Kapısı kapalı olduğu için hiç çalıştırılmayan kartların adları. */
  kapaliAlanlar: string[]
  /** Çalışıp hata veren kartlar — SESSİZCE YUTULMAZ. */
  hatalar: Array<{ kod: string; mesaj: string }>
}

/**
 * Kullanıcının görebildiği tüm kartları paralel üretir.
 *
 * Bir kartın patlaması diğerlerini düşürmez (`allSettled`) ama hata da
 * saklanmaz: yutulan hata, kullanıcının "kart yok" ile "kart hesaplanamadı"yı
 * ayırt edememesi demek olurdu.
 */
export async function kartlariUret(b: KartBaglami): Promise<KartSonucu> {
  const acik = TANIMLAR.filter((t) => kapiAcik(t.kapi, b))
  const kapaliAlanlar = TANIMLAR.filter((t) => !kapiAcik(t.kapi, b)).map((t) => t.ad)

  const sonuclar = await Promise.allSettled(acik.map((t) => t.uret(b)))

  const kartlar: Kart[] = []
  const hatalar: KartSonucu["hatalar"] = []

  sonuclar.forEach((s, i) => {
    if (s.status === "fulfilled") {
      kartlar.push(...s.value)
    } else {
      hatalar.push({
        kod: acik[i].kod,
        mesaj: s.reason instanceof Error ? s.reason.message : String(s.reason),
      })
    }
  })

  // ÖNCE önem, SONRA parasal etki — kural `tipler.ts`te (`kartSirasi`) ve orada
  // testle tutuluyor; buradaki tek iş onu uygulamak.
  kartlar.sort(kartSirasi)
  return { kartlar, kapaliAlanlar, hatalar }
}
