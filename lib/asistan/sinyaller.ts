/**
 * UYARI MOTORU — asistanın deterministik yarısı.
 *
 * Buradaki her rakam SQL'den gelir; hiçbiri modelden geçmez. Sohbet katmanı bu
 * sinyalleri brifing olarak okur ve yorumlar, ama sayıyı DEĞİŞTİREMEZ. Ayrım
 * kasıtlı: bir ön muhasebe programında modelin uydurduğu bir rakam, yanlış
 * cevaptan daha kötüdür — güvenilir görünür.
 *
 * KAPI: her sinyalin bir modül ve bir menü sayfası şartı var ve ikisi de
 * kullanıcının KENDİ izinlerine karşı sınanır. Kısıtlı çalışan, panelde
 * göremediği kâr marjını asistan kartında görmemeli; aksi hâlde asistan sayfa
 * yetkilendirmesinin etrafından dolaşan bir kapı olurdu.
 */

import { canViewPage, type PagePermissions } from "@/lib/page-access"
import { isModuleEnabled } from "@/lib/modules"
import { money, money0, qty } from "@/lib/format"
import type { Sinyal, SinyalKapisi, SinyalSatiri } from "./tipler"
import { oluStoklar, kritikStoklar, zararinaSatilanlar } from "./veri/urun"
import {
  kaybolanMusteriler,
  nakitDurumu,
  vadesiGecenler,
  yaklasanVadeliEvrak,
} from "./veri/cari"
import { donemKarsilastirma } from "./veri/ozet"
import { bugunBasi, gunOnce } from "./veri/temel"
import { istekOnbellegi, type IstekOnbellegi } from "./veri/onbellek"

export type SinyalBaglami = {
  companyId: string
  izinler: PagePermissions
  kapaliModuller: string[]
  /** Ölü stok eşiği (gün). Kullanıcı "6 aydır" diye sorarsa araç bunu değiştirir. */
  oluStokGun?: number
  /**
   * İstek ömürlü önbellek. Verilmezse `sinyalleriHesapla` kendi oluşturur —
   * ama sohbet ucu KENDİ oluşturup araçlarla PAYLAŞMALI: aksi hâlde brifing
   * yaşlandırmayı bir kez, modelin çağırdığı araç ikinci kez hesaplar.
   */
  onbellek?: IstekOnbellegi
}

type SinyalTanimi = {
  anahtar: string
  baslik: string
  kapi: SinyalKapisi
  hesapla: (b: SinyalBaglami) => Promise<Omit<Sinyal, "anahtar" | "baslik"> | null>
}

/** Satır listesini kırpar ve toplamı ayrıca taşır (kart "+12 tane daha" desin). */
function sinyal(
  onem: Sinyal["onem"],
  ozet: string,
  satirlar: SinyalSatiri[],
  gosterilecek = 5
): Omit<Sinyal, "anahtar" | "baslik"> {
  return { onem, ozet, satirlar: satirlar.slice(0, gosterilecek), toplam: satirlar.length }
}

/**
 * DETAY LİNKLERİ menü href'i DEĞİLDİR — dikkat.
 *
 * Kapıdaki sayfa `/stok/urunler` ve `/cari/musteri` (menüdeki adlar), ama ürünün
 * ve carinin AÇILDIĞI adres başka: `/stok/{slug}` ve `/cari/customers|suppliers/{id}`.
 * İkisini karıştırmak kartı tıklanınca 404'e götüren bir link bırakır — nitekim
 * ilk yazımda öyle olmuştu. Cari route'u hem slug hem id kabul ediyor
 * (`/cari/[type]/[id]`), yaşlandırma slug taşımadığı için id veriliyor.
 */
const gun = (n: number) => `${n} gün`

const TANIMLAR: SinyalTanimi[] = [
  {
    anahtar: "olu-stok",
    baslik: "Hareketsiz stok",
    kapi: { modul: "stock", sayfa: "/stok/urunler" },
    async hesapla(b) {
      const esik = b.oluStokGun ?? 90
      const satirlar = await oluStoklar(b.companyId, esik)
      if (satirlar.length === 0) return null

      const bagliToplam = satirlar.reduce((t, s) => t + (s.bagliTutar ?? 0), 0)
      const ozet =
        bagliToplam > 0
          ? `${satirlar.length} üründe ${esik} gündür hareket yok; ${money0(bagliToplam)} sermaye bağlı.`
          : `${satirlar.length} üründe ${esik} gündür hareket yok (maliyet girilmediği için bağlı tutar hesaplanamadı).`

      return sinyal(
        "uyari",
        ozet,
        satirlar.map((s) => ({
          baslik: s.ad,
          detay:
            (s.hareketsizGun == null
              ? "Hiç satılmamış"
              : `${gun(s.hareketsizGun)} hareketsiz`) +
            ` · ${qty(s.miktar)} ${s.birim}` +
            (s.bagliTutar == null ? " · maliyet girilmemiş" : ` · ${money(s.bagliTutar)} bağlı`),
          sayi: s.bagliTutar ?? 0,
          href: `/stok/${s.slug || s.id}`,
        }))
      )
    },
  },

  {
    anahtar: "kritik-stok",
    baslik: "Stok bitiyor",
    kapi: { modul: "stock", sayfa: "/stok/urunler" },
    async hesapla(b) {
      const satirlar = await kritikStoklar(b.companyId)
      if (satirlar.length === 0) return null

      // Aciliyet "minimumun altında" değil, "kaç gün sonra biter" ile ölçülür:
      // hızı sıfır olan bir ürünün minimumun altında olması acil değildir.
      const acil = satirlar.filter((s) => s.kalanGun != null && s.kalanGun <= 7)

      return sinyal(
        acil.length > 0 ? "kritik" : "uyari",
        acil.length > 0
          ? `${acil.length} ürün bir hafta içinde bitiyor (toplam ${satirlar.length} ürün minimum seviyenin altında).`
          : `${satirlar.length} ürün minimum stok seviyesinin altında.`,
        satirlar.map((s) => ({
          baslik: s.ad,
          detay:
            `${qty(s.miktar)} ${s.birim} kaldı (min ${qty(s.minSeviye)})` +
            (s.kalanGun == null
              ? " · son 30 günde satış yok"
              : ` · bu hızla ${gun(s.kalanGun)} yeter`),
          sayi: s.kalanGun ?? 9999,
          href: `/stok/${s.slug || s.id}`,
        }))
      )
    },
  },

  {
    anahtar: "zararina-satis",
    baslik: "Maliyetin altında satış",
    kapi: { modul: "reports", sayfa: "/raporlar/satis" },
    async hesapla(b) {
      const satirlar = await zararinaSatilanlar(b.companyId)
      if (satirlar.length === 0) return null

      const toplam = satirlar.reduce((t, s) => t + s.toplamZarar, 0)
      return sinyal(
        "kritik",
        `${satirlar.length} ürün son 90 günde ortalama maliyetinin altında satıldı; fark ${money0(toplam)}.`,
        satirlar.map((s) => ({
          baslik: s.ad,
          detay: `${qty(s.adet)} adet · ort. satış ${money(s.ortSatis)} < maliyet ${money(s.birimMaliyet)} · fark ${money(s.toplamZarar)}`,
          sayi: s.toplamZarar,
          href: `/stok/${s.slug || s.id}`,
        }))
      )
    },
  },

  {
    anahtar: "vadesi-gecen-alacak",
    baslik: "Vadesi geçmiş alacak",
    kapi: { modul: "reports", sayfa: "/raporlar/cari" },
    async hesapla(b) {
      const satirlar = await vadesiGecenler(b.companyId, "musteri", 15, b.onbellek)
      if (satirlar.length === 0) return null

      const toplam = satirlar.reduce((t, s) => t + s.gecikenTutar, 0)
      const enEski = satirlar.reduce((m, s) => (s.enEskiGun > m ? s.enEskiGun : m), 0)
      return sinyal(
        enEski > 90 ? "kritik" : "uyari",
        `${satirlar.length} müşteriden toplam ${money0(toplam)} vadesi geçmiş alacak var; en eskisi ${gun(enEski)} gecikmiş.`,
        satirlar.map((s) => ({
          baslik: s.ad,
          detay: `${money(s.gecikenTutar)} · ${s.belgeSayisi} belge · en eski ${gun(s.enEskiGun)} gecikmiş`,
          sayi: s.gecikenTutar,
          href: `/cari/customers/${s.id}`,
        }))
      )
    },
  },

  {
    anahtar: "vadesi-gecen-borc",
    baslik: "Vadesi geçmiş borç",
    kapi: { modul: "reports", sayfa: "/raporlar/cari" },
    async hesapla(b) {
      const satirlar = await vadesiGecenler(b.companyId, "tedarikci", 15, b.onbellek)
      if (satirlar.length === 0) return null

      const toplam = satirlar.reduce((t, s) => t + s.gecikenTutar, 0)
      return sinyal(
        "uyari",
        `${satirlar.length} tedarikçiye toplam ${money0(toplam)} vadesi geçmiş borcunuz var.`,
        satirlar.map((s) => ({
          baslik: s.ad,
          detay: `${money(s.gecikenTutar)} · ${s.belgeSayisi} belge · en eski ${gun(s.enEskiGun)} gecikmiş`,
          sayi: s.gecikenTutar,
          href: `/cari/suppliers/${s.id}`,
        }))
      )
    },
  },

  {
    anahtar: "kaybolan-musteri",
    baslik: "Susan müşteriler",
    kapi: { modul: "sales", sayfa: "/cari/musteri" },
    async hesapla(b) {
      const satirlar = await kaybolanMusteriler(b.companyId)
      if (satirlar.length === 0) return null

      const ciro = satirlar.reduce((t, s) => t + s.toplamCiro, 0)
      return sinyal(
        "uyari",
        `${satirlar.length} düzenli müşteri alışverişi kesti; geçmiş ciroları toplamı ${money0(ciro)}.`,
        satirlar.map((s) => ({
          baslik: s.ad,
          detay: `${gun(s.sessizGun)} sessiz · normalde ${Math.round(s.ortalamaAralik)} günde bir alırdı · ${s.faturaSayisi} fatura, ${money(s.toplamCiro)}`,
          sayi: s.toplamCiro,
          href: `/cari/customers/${s.id}`,
        }))
      )
    },
  },

  {
    anahtar: "ciro-dususu",
    baslik: "Ciro düşüşü",
    kapi: { modul: "reports", sayfa: "/raporlar/satis" },
    async hesapla(b) {
      const k = await donemKarsilastirma(b.companyId, gunOnce(30), bugunBasi())
      // Eşik %15: küçük firmalarda aylık %5-10 dalgalanma normaldir ve her ay
      // uyarı basmak kartı gürültüye çevirir, kullanıcı da bakmayı bırakır.
      if (k.ciroDegisimYuzde == null || k.ciroDegisimYuzde > -15) return null

      const satirlar: SinyalSatiri[] = [
        {
          baslik: "Ciro",
          detay: `${money(k.simdi.ciro)} (önceki 30 gün ${money(k.onceki.ciro)})`,
          sayi: k.ciroDegisimYuzde,
          href: "/raporlar/satis",
        },
        {
          baslik: "Fatura sayısı",
          detay: `${k.simdi.faturaSayisi} adet (önceki dönem ${k.onceki.faturaSayisi})`,
          sayi: k.simdi.faturaSayisi - k.onceki.faturaSayisi,
        },
        {
          baslik: "Ortalama fatura",
          detay: `${money(k.simdi.ortalamaFatura)} (önceki dönem ${money(k.onceki.ortalamaFatura)})`,
          sayi: k.simdi.ortalamaFatura - k.onceki.ortalamaFatura,
        },
      ]

      return sinyal(
        k.ciroDegisimYuzde < -30 ? "kritik" : "uyari",
        `Son 30 günün cirosu bir önceki 30 güne göre %${Math.abs(k.ciroDegisimYuzde).toFixed(1)} düştü.`,
        satirlar,
        3
      )
    },
  },

  {
    anahtar: "yaklasan-vade",
    baslik: "Yaklaşan çek/senet",
    kapi: { modul: "finance", sayfa: "/cek-senet/cek" },
    async hesapla(b) {
      const satirlar = await yaklasanVadeliEvrak(b.companyId)
      if (satirlar.length === 0) return null

      const cikacak = satirlar.filter((s) => s.yon === "verilen").reduce((t, s) => t + s.tutar, 0)
      const girecek = satirlar.filter((s) => s.yon === "alinan").reduce((t, s) => t + s.tutar, 0)

      return sinyal(
        cikacak > girecek ? "kritik" : "bilgi",
        `Önümüzdeki 14 günde ${money0(cikacak)} ödeme çıkacak, ${money0(girecek)} tahsilat girecek.`,
        satirlar.map((s) => ({
          baslik: `${s.tur === "cek" ? "Çek" : "Senet"} ${s.no}${s.karsiTaraf ? ` · ${s.karsiTaraf}` : ""}`,
          detay: `${s.yon === "verilen" ? "Ödeme" : "Tahsilat"} ${money(s.tutar)} · ${s.kalanGun} gün sonra`,
          sayi: s.kalanGun,
          href: s.tur === "cek" ? "/cek-senet/cek" : "/cek-senet/senet",
        }))
      )
    },
  },

  {
    anahtar: "negatif-kasa",
    baslik: "Eksi bakiyeli hesap",
    kapi: { modul: "finance", sayfa: "/finans/kanallar" },
    async hesapla(b) {
      const durum = await nakitDurumu(b.companyId)
      if (durum.negatifler.length === 0) return null

      return sinyal(
        "kritik",
        `${durum.negatifler.length} hesap eksi bakiyede. Kasa eksiye düşmez: kayıt eksik ya da yanlış hesaba işlenmiş olabilir.`,
        durum.negatifler.map((h) => ({
          baslik: h.ad,
          detay: `${money(h.bakiye)} · ${h.tur === "CASH" ? "Kasa" : "Banka"}`,
          sayi: h.bakiye,
          href: "/finans/kanallar",
        }))
      )
    },
  },
]

/** Sinyalin kapısı bu kullanıcı için açık mı? */
function kapiAcik(kapi: SinyalKapisi, b: SinyalBaglami): boolean {
  if (kapi.modul && !isModuleEnabled(b.kapaliModuller, kapi.modul)) return false
  if (kapi.sayfa && !canViewPage(b.izinler, kapi.sayfa)) return false
  return true
}

export type SinyalSonucu = {
  sinyaller: Sinyal[]
  /** Kapısı kapalı olduğu için hiç çalıştırılmayan sinyallerin başlıkları. */
  kapaliAlanlar: string[]
  /** Çalışıp hata veren sinyaller — SESSİZCE YUTULMAZ, çağırana bildirilir. */
  hatalar: Array<{ anahtar: string; mesaj: string }>
}

const ONEM_SIRASI: Record<Sinyal["onem"], number> = { kritik: 0, uyari: 1, bilgi: 2 }

/**
 * Kullanıcının görebildiği tüm sinyalleri paralel hesaplar.
 *
 * Bir sinyalin patlaması diğerlerini düşürmez (`allSettled`) ama hata SAKLANMAZ
 * da: `hatalar` alanıyla yukarı çıkar ve panelde görünür. Yutulan hata, uyarı
 * motorunda en tehlikeli davranış olurdu — kullanıcı "uyarı yok" ile "uyarı
 * hesaplanamadı"yı ayırt edemezdi.
 */
export async function sinyalleriHesapla(girdi: SinyalBaglami): Promise<SinyalSonucu> {
  // Önbellek verilmediyse burada doğar: iki vade sinyali yaşlandırmayı yine de
  // tek kez hesaplasın. Çağıran paylaşırsa araçlar da aynı sonucu kullanır.
  const b: SinyalBaglami = { ...girdi, onbellek: girdi.onbellek ?? istekOnbellegi() }
  const acik = TANIMLAR.filter((t) => kapiAcik(t.kapi, b))
  const kapali = TANIMLAR.filter((t) => !kapiAcik(t.kapi, b)).map((t) => t.baslik)

  const sonuclar = await Promise.allSettled(
    acik.map(async (t) => {
      const govde = await t.hesapla(b)
      return govde ? ({ anahtar: t.anahtar, baslik: t.baslik, ...govde } as Sinyal) : null
    })
  )

  const sinyaller: Sinyal[] = []
  const hatalar: SinyalSonucu["hatalar"] = []

  sonuclar.forEach((s, i) => {
    if (s.status === "fulfilled") {
      if (s.value) sinyaller.push(s.value)
    } else {
      hatalar.push({
        anahtar: acik[i].anahtar,
        mesaj: s.reason instanceof Error ? s.reason.message : String(s.reason),
      })
    }
  })

  sinyaller.sort((a, c) => ONEM_SIRASI[a.onem] - ONEM_SIRASI[c.onem])
  return { sinyaller, kapaliAlanlar: kapali, hatalar }
}
