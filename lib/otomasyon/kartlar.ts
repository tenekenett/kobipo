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
import type { Kart, KartKapisi, KartOnem } from "./tipler"
import { ONEM_SIRASI } from "./tipler"
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
import {
  vadesiGecmisAlacaklar,
  type GecikmisAlacak,
} from "./veri/vadesi-gecmis-alacak"

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
    kod: "K-THS-07",
    ad: "Vadesi geçmiş alacak",
    kapi: { modul: "sales", sayfa: "/cari/musteri" },
    async uret(b) {
      const satirlar = await vadesiGecmisAlacaklar(b.companyId)
      return satirlar.map((s) => gecikmisAlacakKarti(s))
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
function negatifStokKarti(companyId: string, o: NegatifStokOzeti): Kart {
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
    baslik: `${a.ad} ${a.gecikmeGun} gündür geciken ödemesini yapmadı — ${money0(a.bakiye)} açık.`,
    gerekce:
      `${a.faturaAdet} faturanın vadesi geçti. ${vadeCumlesi} ` +
      `${money0(a.bakiye)} rakamı bu müşterinin CARİ BAKİYESİDİR: geciken faturaların yanında ` +
      `kapanmamış eski bakiye, tahsilatlar ve çek/senet de içindedir — ekstredeki tutarın aynısı.`,
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

  kartlar.sort((a, c) => ONEM_SIRASI[a.onem] - ONEM_SIRASI[c.onem])
  return { kartlar, kapaliAlanlar, hatalar }
}
