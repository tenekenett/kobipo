/**
 * Cari ekstre (hesap hareketleri) sorgusu.
 *
 * `app/api/cari/ekstre/route.ts`ten ayıklandı: dışa aktarma da AYNI hareketleri,
 * AYNI borç/alacak yönünü ve AYNI yürüyen bakiyeyi üretmek zorunda. Ekstre
 * ekranı daha önce kendi tek seferlik XLSX kodunu yazıyordu; artık ikisi de bu
 * fonksiyonu çağırıyor.
 */

import { prisma } from "@/lib/db/prisma"
import { cariRelationVisibilityWhere, cariVisibilityWhere, type CariVisibility } from "@/lib/cari/visibility"
import {
  isPurchaseReturn,
  payableSign,
  receivableSign,
  type DirectionalInvoice,
} from "@/lib/cari/invoice-direction"
import { CHECK_NOTE_NON_SETTLING, checkNoteSignedCredit } from "@/lib/cari/check-credit"
import { AGING_BUCKETS, type AgingBucket } from "@/lib/raporlar/cari-yaslandirma-buckets"
import { computeCariAging } from "@/lib/raporlar/cari-yaslandirma"
import { isBakiyeKapama } from "@/lib/cari/bakiye-kapama"
import { VIRMAN_LEG_SELECT, virmanLegRow } from "@/lib/cari/virman-db"

export type EkstreEntryType =
  | "OPENING"
  | "INVOICE"
  | "INVOICE_PAYMENT"
  /** Kasa hareketi olmayan kapama — bkz. lib/cari/bakiye-kapama.ts. */
  | "WRITE_OFF"
  | "TRANSACTION"
  | "CHECK"
  | "PROMISSORY_NOTE"
  /** Cari virman fişi bacağı — bkz. lib/cari/virman.ts. */
  | "VIRMAN"

export type EkstreEntry = {
  type: EkstreEntryType
  id: string
  date: Date
  description: string
  debit: number
  credit: number
  balance: number
  reference: string | null
  /** Ham kayıt — uç sözleşmesi için taşınır, dışa aktarma kullanmaz. */
  data: unknown
}

/**
 * Ekstre yaşlandırması — kovalar YAŞLANDIRMA RAPORUYLA aynı sözlükten
 * (`lib/raporlar/cari-yaslandirma-buckets.ts`).
 *
 * Önceden burada kendi kovaları vardı (`current`/`days_0_30`/…) ve yaş
 * VADEYE değil BELGE TARİHİNE göre ölçülüyordu; `dueDate` hiç okunmuyordu.
 * Sonuç: vadesine 26 gün olan fatura "belge yaşı 69 gün" diye gecikmiş
 * sayılıyordu (ölçüldü: bir caride vadesi gelmemiş 7 faturanın 7'si de,
 * 22.617 TL, ekstrede "vadesi geçmiş" tarafında duruyordu; aynı tutar
 * yaşlandırma raporunda "vadesi gelmemiş"ti). Aynı cari, iki ekran, zıt cevap.
 *
 * İkinci kusur ödeme satırlarıydı: ekstredeki HER hareket (tahsilat dahil)
 * kovaya giriyor, tahsilat kendi tarihinin kovasına EKSİ olarak yazılıp
 * ilgisiz bir dilimi eksiltiyordu. Artık ölçü belge değil AÇIK FATURA:
 * tutar − tahsilat.
 */
export type EkstreAging = Record<AgingBucket, number>

export type EkstreResult = {
  entries: EkstreEntry[]
  totalDebit: number
  totalCredit: number
  finalBalance: number
  /**
   * CARİ SEÇİLMEDİYSE null. "Tümü" görünümünde tek bir yaşlandırma kutusu
   * anlamsızdır: alacaklar ve borçlar aynı torbaya girer. Sıfır göstermek
   * "gecikmiş borç yok" diye okunurdu — hesaplanamayan şeyi hesaplanmış gibi
   * göstermektense yok saymak doğru.
   */
  aging: EkstreAging | null
  /**
   * Yaşlandırmaya SAYILMAYAN satış taslakları. Ekstrenin hareket listesi ve
   * bakiyesi taslakları İÇERİR (durum süzgeci yalnız CANCELLED/CONVERTED'i eler),
   * yaşlandırma ise raporla aynı kuralı uygular ve saymaz. Söylenmezse aynı
   * ekranda "bakiye şu kadar ama vade kutuları tutmuyor" görünür.
   */
  agingExcludedDrafts: { count: number; amount: number } | null
}

/**
 * AÇILIŞ BAKİYESİ — ekstrenin ilk satırı.
 *
 * ── Neden sonradan eklendi ──────────────────────────────────────────────────
 * Cari listesi ve yaşlandırma raporu açılış bakiyesini HESABA KATIYOR
 * (`lib/cari/list-query.ts` bakiye formülü, `cari-yaslandirma.ts` →
 * `openingBalanceToAgingItem`), ekstre ise onun için satır ÜRETMİYORDU. Aynı
 * cari iki ekranda iki farklı rakam gösteriyordu:
 *
 *   ABC Müşteri A.Ş. · cari listesi −47.214 TL · ekstre −62.214 TL
 *   aradaki 15.000 TL = kartına girilmiş açılış bakiyesi
 *
 * Fark 2026-09-07'de otomasyon kartı denetiminde çıktı: kart "cari bakiye"
 * diyor, kullanıcı ekstreyi açıyor ve başka bir rakam görüyordu. Kartın dili
 * düzeltildi ama asıl tutarsızlık buradaydı.
 *
 * ── İki karar ───────────────────────────────────────────────────────────────
 * 1. YALNIZ TEK CARİ SEÇİLİYKEN. "Tümü" görünümünde her carinin açılışı ayrı
 *    satır olurdu; o görünüm bir bakiye tablosu değil hareket listesidir ve
 *    yaşlandırma kutusu da orada bilerek boş bırakılıyor (bkz. `EkstreResult`).
 * 2. TARİH SÜZGECİNE TABİ. Açılışın tarihi hesabın açıldığı gündür
 *    (`createdAt` — yaşlandırma raporu da onu kullanıyor). Dönem seçen kullanıcı
 *    o dönemin hareketlerini görür; açılış da diğer satırlar gibi süzülür.
 *    Süzgeçten bağımsız eklenseydi, seçilen ayın bakiyesi dönem dışı bir tutarı
 *    içerirdi.
 *
 * Yön muhasebenin kendi sözlüğü: DEBIT açılış BORÇ sütununa, CREDIT açılış
 * ALACAK sütununa yazılır — müşteride de tedarikçide de aynı, çünkü ekstrenin
 * borç/alacak ekseni zaten cari türüne göre kuruluyor.
 */
export type AcilisKaydi = {
  id: string
  name: string
  createdAt: Date
  openingBalanceAmount: unknown
  openingBalanceType: string | null
}

export function acilisSatiri(
  kayit: AcilisKaydi | null,
  startDate?: string | null,
  endDate?: string | null
): EkstreEntry | null {
  if (!kayit) return null
  const tutar = Number(kayit.openingBalanceAmount ?? 0)
  if (!Number.isFinite(tutar) || tutar <= 0) return null

  const tarih = new Date(kayit.createdAt)
  const zaman = tarih.getTime()
  if (startDate && zaman < new Date(startDate).getTime()) return null
  if (endDate && zaman > new Date(endDate).getTime()) return null

  const borc = String(kayit.openingBalanceType || "DEBIT").toUpperCase() === "DEBIT"

  return {
    type: "OPENING",
    id: `opening-${kayit.id}`,
    date: tarih,
    description: "Açılış bakiyesi",
    debit: borc ? tutar : 0,
    credit: borc ? 0 : tutar,
    balance: 0,
    reference: null,
    data: {
      openingBalanceAmount: tutar,
      openingBalanceType: borc ? "DEBIT" : "CREDIT",
      createdAt: tarih,
    },
  }
}

/**
 * ÇEK/SENEDİN EKSTREDEKİ YÖNÜ — kural `lib/cari/check-credit.ts`ten gelir.
 *
 * ── Bulunan hata (2026-09-08) ───────────────────────────────────────────────
 * Ekstre yönü kıymetin `direction` alanına DEĞİL, hangi cari alanının dolu
 * olduğuna bakarak seçiyordu: müşteriye ait her çek BORÇ, tedarikçiye ait her
 * çek ALACAK yazılıyordu. Müşteriden ALINAN çek onun borcunu KAPATIR; ekstre
 * ise borcu artırıyordu — işaret ters.
 *
 * Ölçüldü: 67 carinin 3'ünde ekstre ile cari listesi ayrışıyordu ve üçünde de
 * fark, çek tutarının TAM İKİ KATIydı (ters işaretin imzası):
 *   Özkan Karakan   liste −100.000 · ekstre +100.000  (100.000 TL alınan çek)
 *   Kanyon Turizm   liste −189.750 · ekstre +303.336  (246.543 TL alınan çek)
 *   AYGÜL YAPI      liste  168.000 · ekstre  568.000  (200.000 TL alınan çek)
 *
 * Kural artık tek kaynaktan: `checkNoteSignedCredit` "bakiyeyi AZALTAN etki"yi
 * işaretli döndürür. Müşteride azaltmak ALACAK sütunudur; tedarikçide ekstrenin
 * ekseni ters olduğu için (alış faturası alacak yazılır) azaltmak BORÇ sütunudur.
 */
export function kiymetYonu(kiymet: {
  customerId: string | null
  direction: string | null
  amount: unknown
}): { debit: number; credit: number } {
  const tutar = Number(kiymet.amount)
  const kind = kiymet.customerId ? "customer" : "supplier"
  const azaltan = checkNoteSignedCredit(kind, kiymet.direction, tutar)
  if (kind === "customer") {
    return { debit: Math.max(-azaltan, 0), credit: Math.max(azaltan, 0) }
  }
  return { debit: Math.max(azaltan, 0), credit: Math.max(-azaltan, 0) }
}

/** Satış ailesi ve alış iadesi BORÇ sütununa yazılır (bkz. `faturaSatirYonu`). */
const borcTarafinda = (inv: DirectionalInvoice) => receivableSign(inv) > 0 || payableSign(inv) < 0

/**
 * FATURANIN ekstredeki sütunu. Müşteride de tedarikçide de aynı eksen: satış
 * ailesi BORÇ, alış ailesi ALACAK sütunudur; kartın türü yalnız yürüyen
 * bakiyenin işaretini değiştirir.
 *
 * İADE, ait olduğu belgenin TERS TARAFINA yazılır: satış iadesi müşterinin
 * borcunu azalttığı için ALACAK, alış iadesi bizim borcumuzu azalttığı için
 * BORÇ olur. Önceden iade ekstreye 0/0 düşüyordu — müşteri geri verdiği malın
 * borcunu taşımaya devam ediyordu.
 *
 * Cari DETAY uçları da buradan geçer. Onlar faturayı yalnız kartın "kendi"
 * tipine göre yazıyordu (müşteride SALES borç, tedarikçide PURCHASE alacak):
 * iade ve mahsup faturası (müşteri kartına işlenmiş alış) tabloda 0/0 duruyor,
 * bakiye kartı ise onları sayıyordu. Ölçüldü (2026-09-16): böyle faturası olan
 * 7 kartın 6'sında tablonun son bakiyesi karttan farklıydı (biri: kart −78.365,
 * tablo +116.062); yedincisi eksik fatura ve eksik ödeme satırı birbirini
 * götürdüğü için tesadüfen tutuyordu.
 */
export function faturaSatirYonu(inv: DirectionalInvoice & { totalAmount: unknown }): {
  debit: number
  credit: number
} {
  const tutar = Number(inv.totalAmount)
  return {
    debit: borcTarafinda(inv) ? tutar : 0,
    credit: payableSign(inv) > 0 || receivableSign(inv) < 0 ? tutar : 0,
  }
}

/**
 * FATURAYA İŞLENEN ÖDEMELERİN ekstre satırları. Yalnız `transactionId` BOŞ
 * olanlar: kasa hareketine bağlı ödeme zaten Transaction olarak ayrı satır,
 * ikisi de yazılsaydı aynı ödeme iki kez düşerdi.
 *
 * Yön, faturanın yazıldığı tarafın TERSİDİR: satış faturası borç yazılır,
 * ödemesi alacak; aynı karta işlenmiş alış faturası alacak yazılır, ödemesi
 * borç. (Ölçüldü: bir caride 199.999 TL'lik alış faturası ekstreye alacak
 * düşüyor ama 199.999 TL'lik ödemesi hiç görünmüyordu — bakiye −101.186 TL
 * derken yaşlandırma +74.384 TL diyordu.)
 *
 * Cari DETAY uçları (`app/api/cari/customers|suppliers/[id]`) da buradan
 * geçer. Onların bakiye kartı bağlantısız ödemeyi baştan düşüyordu ama satırını
 * yazmıyordu; kasasız fatura ödemesi (docs/finans/KASASIZ-ODEME.md) kartta
 * "ödendi", ekstre tablosunda borç olarak asılı görünüyordu. Bugün yeni yazılan
 * her fatura ödemesi kasa hareketine bağlanıyor; bağlantısız ödeme yalnız Kobipo'nun
 * kendi faturalandırmasında (tahsilat hesabı tanımsızken,
 * lib/invoicing/issue-sales-invoice.ts) ve geçmiş kayıtlarda kalıyor.
 */
export function faturaOdemesiSatirlari<
  P extends {
    id: string
    amount: unknown
    paymentDate: Date
    transactionId: string | null
    reference: string | null
    paymentMethod: string
  },
>(
  inv: DirectionalInvoice & { invoiceNo: string; eDocumentNo: string | null; payments: P[] },
  startDate?: string | null,
  endDate?: string | null,
): Array<EkstreEntry & { type: "INVOICE_PAYMENT" | "WRITE_OFF"; data: P }> {
  const invoiceIsDebit = borcTarafinda(inv)
  return inv.payments
    .filter((p) => !p.transactionId)
    .filter((p) => {
      if (!startDate && !endDate) return true
      const t = new Date(p.paymentDate).getTime()
      if (startDate && t < new Date(startDate).getTime()) return false
      if (endDate && t > new Date(endDate).getTime()) return false
      return true
    })
    .map((p) => {
      // Bakiye kapama / iskonto aynı yönde düşer ama AYRI TÜRDÜR: ekranda ve
      // dosyada "ödeme" diye okunmamalı — para gelmedi, alacaktan vazgeçildi.
      const kapama = isBakiyeKapama(p.paymentMethod)
      return {
        type: kapama ? ("WRITE_OFF" as const) : ("INVOICE_PAYMENT" as const),
        id: p.id,
        date: p.paymentDate,
        description: `${kapama ? "Bakiye kapama / iskonto" : "Fatura ödemesi"} ${inv.eDocumentNo || inv.invoiceNo}`,
        debit: invoiceIsDebit ? 0 : Number(p.amount),
        credit: invoiceIsDebit ? Number(p.amount) : 0,
        balance: 0,
        reference: p.reference ?? (inv.eDocumentNo || inv.invoiceNo),
        data: p,
      }
    })
}

export type EkstreOptions = {
  companyId: string
  customerId?: string | null
  supplierId?: string | null
  startDate?: string | null
  endDate?: string | null
  /**
   * Yetkili çalışan kısıtı — ZORUNLU (bkz. lib/cari/visibility.ts).
   *
   * Tek cari seçiliyken uç zaten 403 veriyor; kritik olan "Tümü" hâli: kısıt
   * buraya girmeseydi kısıtlı çalışan cari seçmeden ekstre isteyerek firmanın
   * BÜTÜN hareketlerini (ve bakiyesini) okuyabilirdi.
   */
  visibility: CariVisibility
  /**
   * `false` → yaşlandırma kutuları hesaplanmaz (`aging: null`). Yaşlandırma
   * firmanın bütün çek/senet haritasını kurar; yalnız bakiyeyi isteyen toplu
   * ölçüm (bakiye-tutarlilik.canli.test.ts) bunu her cari için tekrarlamasın.
   */
  withAging?: boolean
}

export async function fetchEkstre(options: EkstreOptions): Promise<EkstreResult> {
  const { companyId, customerId, supplierId, startDate, endDate, visibility, withAging = true } = options

  // Cariye BAĞLI kayıtların (fatura/işlem/çek/senet) süzgeci. "all"da boş nesne,
  // yani sorgular bugünküyle birebir aynı kalır.
  const visibleParty = cariRelationVisibilityWhere(visibility)

  const where: any = {
    companyId,
    status: { notIn: ["CANCELLED", "CONVERTED"] },
    ...visibleParty,
  }
  if (customerId) where.customerId = customerId
  if (supplierId) where.supplierId = supplierId
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate)
    if (endDate) where.date.lte = new Date(endDate)
  }

  // Çek/senette tarih alanı `dueDate`, fatura/işlemde `date`.
  const dateRange = (field: "date" | "dueDate") =>
    startDate || endDate
      ? {
          [field]: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}

  const partyFilter = {
    ...(customerId && { customerId }),
    ...(supplierId && { supplierId }),
  }

  // Açılış bakiyesi YALNIZ tek cari seçiliyken okunur (gerekçe: `acilisSatiri`).
  const acilisKaydi = customerId
    ? await prisma.customer.findFirst({
        where: { id: customerId, companyId, ...cariVisibilityWhere(visibility) },
        select: {
          id: true,
          name: true,
          createdAt: true,
          openingBalanceAmount: true,
          openingBalanceType: true,
        },
      })
    : supplierId
      ? await prisma.supplier.findFirst({
          where: { id: supplierId, companyId, ...cariVisibilityWhere(visibility) },
          select: {
            id: true,
            name: true,
            createdAt: true,
            openingBalanceAmount: true,
            openingBalanceType: true,
          },
        })
      : null

  const [invoices, transactions, checks, promissoryNotes, virmanLegs] = await Promise.all([
    // Yalnız satır kurucunun okuduğu alanlar. Eskiden her faturaya tam cari
    // kaydı + TÜM kalemler, her işleme tam kasa + cari kayıtları ekleniyordu ve
    // satırla birlikte `data` olarak istemciye gidiyordu: 84 satırlık ekstre
    // 218 KB (satır başına 2,6 KB) — hiçbir ekran okumuyordu.
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        date: true,
        type: true,
        returnKind: true,
        invoiceNo: true,
        eDocumentNo: true,
        totalAmount: true,
        // Ödemeler: faturanın üzerine doğrudan işlenenler (Faturalar → Ödemeler)
        // cari işlemi ÜRETMEZ; ekstreye girmezlerse fatura tam tutarıyla borç
        // yazılı kalır ve bakiye ödenmemiş gibi görünür.
        payments: {
          select: { id: true, amount: true, paymentDate: true, transactionId: true, reference: true, paymentMethod: true },
        },
      },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: { companyId, ...partyFilter, ...visibleParty, ...dateRange("date") },
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        description: true,
        reference: true,
        account: { select: { name: true } },
      },
      orderBy: { date: "desc" },
    }),
    // İADE_EDİLDİ / PROTESTOLU kıymet cari pozisyonunu DEĞİŞTİRMEZ; cari
    // listesi ve yaşlandırma ikisini de elemiş, ekstre elemiyordu.
    prisma.check.findMany({
      where: {
        companyId,
        ...partyFilter,
        ...visibleParty,
        ...dateRange("dueDate"),
        status: { notIn: [...CHECK_NOTE_NON_SETTLING] },
      },
      select: { id: true, dueDate: true, checkNo: true, amount: true, direction: true, customerId: true },
      orderBy: { dueDate: "desc" },
    }),
    prisma.promissoryNote.findMany({
      where: {
        companyId,
        ...partyFilter,
        ...visibleParty,
        ...dateRange("dueDate"),
        status: { notIn: [...CHECK_NOTE_NON_SETTLING] },
      },
      select: { id: true, dueDate: true, noteNo: true, amount: true, direction: true, customerId: true },
      orderBy: { dueDate: "desc" },
    }),
    // Cari virman fişi bacakları: tarih başlıkta durur. Görünürlük süzgeci
    // bacağın kendi carisine uygulanır (`customer`/`supplier` ilişkisi aynı adlı).
    prisma.cariVirmanLeg.findMany({
      where: {
        companyId,
        ...partyFilter,
        ...visibleParty,
        ...(startDate || endDate ? { virman: dateRange("date") } : {}),
      },
      select: VIRMAN_LEG_SELECT,
    }),
  ])

  const entries: EkstreEntry[] = [
    ...invoices.map((inv) => ({
      type: "INVOICE" as const,
      id: inv.id,
      date: inv.date,
      // Ekstrede resmi GİB belge no'yu göster; yoksa iç seri numarasına düş.
      description: `${
        inv.type === "RETURN" ? (isPurchaseReturn(inv) ? "Alış iadesi" : "Satış iadesi") : "Fatura"
      } ${inv.eDocumentNo || inv.invoiceNo}`,
      ...faturaSatirYonu(inv),
      balance: 0,
      reference: inv.eDocumentNo || inv.invoiceNo,
      data: inv,
    })),
    ...invoices.flatMap((inv) => faturaOdemesiSatirlari(inv, startDate, endDate)),
    ...transactions.map((trx) => ({
      type: "TRANSACTION" as const,
      id: trx.id,
      date: trx.date,
      // Açıklama boşsa işlem türüne göre insanca etiket: ödeme/tahsilat.
      description:
        trx.description ||
        (trx.type === "EXPENSE"
          ? "Ödeme"
          : trx.type === "INCOME"
            ? "Tahsilat"
            : `${trx.type} - ${trx.account.name}`),
      // Cari ekstrede ödeme (EXPENSE) cariyi borçlandırır → BORÇ sütunu;
      // tahsilat (INCOME) cariyi alacaklandırır → ALACAK sütunu. Fatura tarafıyla
      // tutarlı (SALES→borç, PURCHASE→alacak): müşteri tahsilatı bakiyeyi azaltır,
      // tedarikçi ödemesi borcu azaltır.
      debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
      credit: trx.type === "INCOME" ? Number(trx.amount) : 0,
      balance: 0,
      reference: trx.reference,
      data: trx,
    })),
    ...checks.map((check) => ({
      type: "CHECK" as const,
      id: check.id,
      date: check.dueDate,
      description: `Çek ${check.checkNo}`,
      ...kiymetYonu(check),
      balance: 0,
      reference: check.checkNo,
      data: check,
    })),
    ...promissoryNotes.map((note) => ({
      type: "PROMISSORY_NOTE" as const,
      id: note.id,
      date: note.dueDate,
      description: `Senet ${note.noteNo}`,
      ...kiymetYonu(note),
      balance: 0,
      reference: note.noteNo,
      data: note,
    })),
    // Virman: sütun kuralı kart tablosuyla ortak (virmanSatirYonu).
    ...virmanLegs.map(virmanLegRow).map((row) => ({
      type: "VIRMAN" as const,
      id: row.id,
      date: row.date,
      description: row.description,
      debit: row.debit,
      credit: row.credit,
      balance: 0,
      reference: row.virmanNo,
      data: row,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // AÇILIŞ SATIRI SIRALAMADAN SONRA, EN BAŞA eklenir — tarihine bakılmadan.
  // Muhasebede devir/açılış her zaman ekstrenin ilk satırıdır; geri tarihli bir
  // fatura hesabın açıldığı günden önceye düşebiliyor ve tarihe göre sıralamak
  // açılışı listenin ortasına atardı.
  const acilis = acilisSatiri(acilisKaydi, startDate, endDate)
  if (acilis) entries.unshift(acilis)

  // Yürüyen bakiye
  let runningBalance = 0
  entries.forEach((entry) => {
    runningBalance += entry.debit - entry.credit
    entry.balance = runningBalance
  })

  const { aging, excludedDrafts: agingExcludedDrafts } = withAging
    ? await computePartyAging(companyId, customerId, supplierId)
    : { aging: null, excludedDrafts: null }

  return {
    entries,
    totalDebit: entries.reduce((sum, e) => sum + e.debit, 0),
    totalCredit: entries.reduce((sum, e) => sum + e.credit, 0),
    finalBalance: runningBalance,
    aging,
    agingExcludedDrafts,
  }
}

/**
 * Ekstrenin yaşlandırma kutuları — hesabı YAŞLANDIRMA RAPORU yapar.
 *
 * Kendi hesabını yazmak iki kez ayrışma üretmişti: (1) yaş vadeye değil belge
 * tarihine göre ölçülüyordu, (2) faturaya bağlanmamış tahsilat/çek/iade açık
 * kalemleri kapatmıyordu. İkisi de raporda çözülmüş; aynı fonksiyonu çağırmak
 * çözümü kopyalamaktan iyidir.
 *
 * Yaşlandırma ekrandaki tarih süzgecinden ETKİLENMEZ: "vadesi geçmiş" bugünkü
 * pozisyondur, seçili dönemin değil. Dönem süzgeci uygulansaydı Ağustos'u seçen
 * kullanıcı Eylül'de vadesi dolan borcu göremezdi.
 */
async function computePartyAging(
  companyId: string,
  customerId?: string | null,
  supplierId?: string | null
): Promise<{
  aging: EkstreAging | null
  excludedDrafts: { count: number; amount: number } | null
}> {
  if (!customerId && !supplierId) return { aging: null, excludedDrafts: null }

  const result = await computeCariAging(companyId, { customerId, supplierId })
  const account = customerId ? result.customers.accounts[0] : result.suppliers.accounts[0]
  const excludedDrafts =
    result.excludedDrafts.count > 0 ? result.excludedDrafts : null
  const zero = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as EkstreAging
  // Açık bakiyesi olmayan cari listeye girmez; kovalar sıfırdır.
  if (!account) return { aging: zero, excludedDrafts }

  return {
    aging: Object.fromEntries(
      AGING_BUCKETS.map((bucket) => [bucket, account.totals[bucket]])
    ) as EkstreAging,
    excludedDrafts,
  }
}
