/**
 * K-BLG-08 · "Ticari faturanın yanıt süresi doluyor — yanıt vermezsen kabul
 * edilmiş sayılacak."
 *
 * ── K-BLG-01'in AÇIKÇA dışarıda bıraktığı küme ──────────────────────────────
 * K-BLG-01 yalnız `status = 'KABUL'` faturaları sayıyor ve gerekçesinde bunu
 * yazıyor: "yanıt bekleyen henüz aktarılabilir değil". Doğru — ama o belgeler
 * bir yerde duruyor ve üzerlerinde SÜRE işliyor. Yanıt bekleyen fatura bugün
 * hiçbir kartta görünmüyordu; bu kart o boşluğu dolduruyor.
 *
 * ── Süre: TİCARİ faturada 8 gün ─────────────────────────────────────────────
 * Ticari senaryodaki e-faturaya alıcı 8 gün içinde red yanıtı verebilir; süre
 * geçerse fatura KABUL EDİLMİŞ SAYILIR (TTK 21/2'nin sekiz günlük itiraz
 * süresiyle aynı ölçü). Kart bu yüzden anatominin 2. kuralının en saf hâli:
 * gerçek bir son tarih ve tarihi kaçırmanın gerçek bir sonucu var.
 *
 * TEMEL faturada aynı şey söylenemez: sistem üzerinden reddedilemez, itiraz
 * noter/KEP/taahhütlü mektupla yapılır. Bu yüzden kart YALNIZ `TICARIFATURA`
 * sayar. Bugünkü veride ikisi aynı kümeye denk geliyor (yanıt bekleyen 67
 * faturanın 67'si ticari), ama ilk temel fatura beklemeye düştüğünde kart ona
 * "reddet" demesin diye süzgeç baştan yazılı.
 *
 * ── Saat başlangıcı: BELGE TARİHİ ───────────────────────────────────────────
 * `docDate` ile `sentDate` bu veride günlerce ayrışıyor (bir faturada belge 52,
 * zarf 44 gün). Süre belge tarihinden işlediği için kart docDate'i esas alır —
 * yani her zaman ERKEN uyarır. Zarf tarihine bakan bir ölçü, kullanıcıya
 * elinde olmayan günleri var gösterirdi.
 *
 * ── Ekranla aynı kümeyi saymak ──────────────────────────────────────────────
 * "Yanıt bekliyor" ekranda `BEKLEMEDE` süzgecidir ve tanımı "terminal olmayan
 * her durum" (Mysoft `YANIT_BEKLENIYOR`, `KABUL_KUYRUGUNDA` gibi metinler
 * döndürüyor; düz eşitlik yazan bir sorgu 36 satırı 0'a düşürmüştü). Kart o
 * tanımı kopyalamıyor, `buildIncomingWhereWithoutDate` ile ekranın SORGUSUNU
 * çağırıyor. Kartın aksiyonu `?durum=BEKLEMEDE` ile aynı listeyi açıyor; ekran
 * profil süzgecini URL'den okumadığı için orada temel faturalar da görünebilir
 * — kartın saydığı her belge listede var, tersi şart değil.
 *
 * ── Ölçüm (2026-09-07, canlı 34 firma) ──────────────────────────────────────
 * 67 fatura yanıt bekliyor, 6 firmaya dağılmış. İki uç da veride var:
 *   ASDOĞUŞ            ₺1.412.400 · 7 günlük → red süresi YARIN doluyor
 *   EREN FORKLİFT      ₺58.881 · 5 günlük   → 3 gün kaldı
 *   EREN F. PNÖMATİK   ₺66.872 · 77 günlük  → süre çoktan doldu
 * Süresi dolmuş olanlar kartta susturulmuyor: red hakkı bitmiş olsa da o
 * belgeler hâlâ ne kabul edilmiş ne aktarılmış — yani K-BLG-01'in saydığı
 * gider ve KDV indirimine de girmiyorlar.
 */

import { prisma } from "@/lib/db/prisma"
import { buildIncomingWhereWithoutDate } from "@/lib/integrations/e-invoice/incoming-list-query"
import { sayi } from "@/lib/asistan/veri/temel"

/** Ticari faturaya red yanıtı için tanınan süre. */
export const YANIT_SURESI_GUN = 8

/** Kartta adı geçecek fatura sayısı. */
export const ORNEK_FATURA_SAYISI = 3

/** Kartın listelediği en eski belgeyi KAPSAYAN en dar ekran dönemi. */
const EKRAN_DONEMLERI = [7, 30, 90, 180, 365]

/** Sorgudan gelen ham satır — saf özetin girdisi. */
export type HamKayit = {
  uuid: string
  invoiceNo: string | null
  senderName: string | null
  docDate: Date | null
  payableAmount: unknown
  currencyCode: string | null
}

export type YanitBekleyenFatura = {
  uuid: string
  no: string | null
  gonderen: string | null
  /** Belge tarihinden bugüne kaç gün. */
  gun: number
  /** Yanıt için kaç gün kaldı; 0 = bugün son gün, negatif = süre doldu. */
  kalanGun: number
  tutar: number
  tl: boolean
}

export type YanitBekleyenOzeti = {
  adet: number
  /** Süresi HENÜZ dolmamış fatura sayısı — kartın asıl konusu. */
  acikAdet: number
  /** Red hakkı geçmiş fatura sayısı. */
  gecmisAdet: number
  /** Açık faturalar içinde en az kalan gün (yoksa null). */
  enYakinKalan: number | null
  enEskiGun: number
  /** Yalnız TRY faturaların toplamı (K-BLG-01 ile aynı kural). */
  tutarTL: number
  dovizAdet: number
  /** Ekran linkinin taşıyacağı dönem. */
  ekranDonemi: number
  ornekler: YanitBekleyenFatura[]
}

/** Ekranın hazır dönemlerinden, en eski belgeyi kapsayan en darı. */
function ekranDonemi(enEskiGun: number): number {
  return EKRAN_DONEMLERI.find((g) => g >= enEskiGun) ?? 365
}

export async function yanitBekleyenOzeti(
  companyId: string
): Promise<YanitBekleyenOzeti | null> {
  const kayitlar = await prisma.incomingInvoice.findMany({
    where: {
      ...buildIncomingWhereWithoutDate(companyId, {
        dateField: "docDate",
        startDate: new Date(0),
        endDate: new Date(0),
        status: "BEKLEMEDE",
        profile: "TICARIFATURA",
        linked: "",
        q: "",
        sender: "",
        taxNumber: "",
        minAmount: null,
        maxAmount: null,
      }),
      isArchived: false,
      docDate: { not: null },
    },
    select: {
      uuid: true,
      invoiceNo: true,
      senderName: true,
      docDate: true,
      payableAmount: true,
      currencyCode: true,
    },
  })

  if (kayitlar.length === 0) return null
  return yanitBekleyenSec(kayitlar)
}

/**
 * SÜRE HESABI VE ÖZET — saf fonksiyon, veritabanı bilmez.
 *
 * Kartın kararı burada: 8 günlük sürenin BELGE TARİHİNDEN işlemesi, süresi
 * dolmuşla dolmamışın ayrılması, TL/döviz ayrımı ve ekran penceresinin
 * seçilmesi. Hiçbiri sorguda değil; biri bozulursa sorgu hata vermez, kart
 * kullanıcıya olmayan bir süre gösterir.
 */
export function yanitBekleyenSec(
  kayitlar: HamKayit[],
  simdiTarih: Date = new Date()
): YanitBekleyenOzeti | null {
  if (kayitlar.length === 0) return null

  const gunMs = 86_400_000
  const simdi = simdiTarih.getTime()

  const satirlar: YanitBekleyenFatura[] = kayitlar.map((f) => {
    const gun = Math.floor((simdi - (f.docDate as Date).getTime()) / gunMs)
    return {
      uuid: f.uuid,
      no: f.invoiceNo,
      gonderen: f.senderName,
      gun,
      kalanGun: YANIT_SURESI_GUN - gun,
      tutar: sayi(f.payableAmount),
      tl: (f.currencyCode ?? "TRY") === "TRY",
    }
  })

  const acik = satirlar.filter((s) => s.kalanGun >= 0)

  // Önce SÜRESİ DOLMAK ÜZERE olanlar (en az kalan gün), sonra tutarı büyük
  // olanlar. Kart üç satır basıyor; o üç satır aksiyonu en acil olanlar olmalı,
  // en eskiler değil — süresi geçmiş fatura için yapılacak bir şey kalmadı.
  const sirali = [...satirlar].sort(
    (a, b) =>
      Number(a.kalanGun < 0) - Number(b.kalanGun < 0) ||
      a.kalanGun - b.kalanGun ||
      b.tutar - a.tutar
  )

  return {
    adet: satirlar.length,
    acikAdet: acik.length,
    gecmisAdet: satirlar.length - acik.length,
    enYakinKalan: acik.length ? Math.min(...acik.map((s) => s.kalanGun)) : null,
    enEskiGun: Math.max(...satirlar.map((s) => s.gun)),
    tutarTL: satirlar.filter((s) => s.tl).reduce((t, s) => t + s.tutar, 0),
    dovizAdet: satirlar.filter((s) => !s.tl).length,
    ekranDonemi: ekranDonemi(Math.max(...satirlar.map((s) => s.gun))),
    ornekler: sirali.slice(0, ORNEK_FATURA_SAYISI),
  }
}
