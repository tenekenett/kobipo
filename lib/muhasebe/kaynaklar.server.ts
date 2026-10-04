import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { belgeFisTaslagi, type FisBelgesi } from "@/lib/muhasebe/fis-kurallari"
import { istanbulGunu, utcGunu, type FisSonucu, type HesapEslesmeleri } from "@/lib/muhasebe/fis"
import {
  CIRO_DURUMU,
  bordroFisi,
  cariAcilisFisi,
  ciroFisi,
  finansAcilisFisi,
  hareketFisi,
  kiymetFisi,
  odemeFisi,
  virmanFisi,
  type HareketGirdisi,
} from "@/lib/muhasebe/para-kurallari"
import { resolveCekSenetDirection } from "@/lib/cek-senet/labels"
import {
  CHECK_SETTLEMENT_PREFIXES,
  EMPLOYEE_REIMBURSEMENT_PREFIX,
  TRANSFER_REFERENCE_PREFIX,
} from "@/lib/finans/nakit-hareket"

/**
 * KAYNAK → FİŞ. Her kaynak türü burada okunur ve kendi kural dosyasına verilir.
 * Senkron (`senkron.server.ts`) yalnız bu dosyadan beslenir; yeni bir kaynak türü
 * eklemek = buraya bir yükleyici + `KAYNAK_TIPLERI`ne bir satır.
 *
 * İki kullanım: (1) tek kayıt — kaydı yazan yol id'siyle çağırır; (2) mutabakat —
 * başlangıç tarihinden bugüne TÜM kaynaklar. İkisi aynı yükleyiciden geçer ki
 * "yazarken üretilen fiş" ile "mutabakatta üretilen fiş" ayrışmasın.
 *
 * BAŞLANGIÇ SINIRI kaynağın HAM tarihiyle sorulur (`giris`) ve açılış fişinin
 * kaynaklarıyla AYNIDIR (cari bakiyesi, kasa geri sarımı: `date < başlangıç`).
 * Fişin tarihi ise İstanbul günüdür; ikisi karıştırılırsa başlangıç gecesi 00:00–03:00
 * arasındaki bir hareket hem açılışa hem fişe girerdi.
 */

export type KaynakTipi =
  | "INVOICE"
  | "PAYMENT"
  | "TRANSACTION"
  | "CHECK"
  | "CHECK_ENDORSE"
  | "NOTE"
  | "NOTE_ENDORSE"
  | "VIRMAN"
  | "PAYROLL"
  | "CARI_OPENING"
  | "ACCOUNT_OPENING"

export type KaynakFisi = {
  tip: KaynakTipi
  id: string
  /** Kaynağın firması (şube olabilir). */
  sirketId: string
  fis: FisSonucu
  /** Başlangıç sınırıyla karşılaştırılan HAM tarih; verilmezse fiş tarihi. */
  giris?: Date
}

export type YukleyiciBaglami = {
  sirketIds: string[]
  baslangic: Date
  eslesme: HesapEslesmeleri
}

/** Yalnız bu id'ler; verilmezse başlangıç tarihinden bugüne hepsi. */
export type KaynakFiltresi = { ids?: string[] }

const kapsam = <T extends string>(alan: T, ctx: YukleyiciBaglami, f: KaynakFiltresi) =>
  // Tek kayıt yolunda tarih süzülmez: tarihi başlangıçtan geriye çekilmiş kaydın eski
  // fişi bulunup silinebilsin (senkron tarihi kendisi karşılaştırır).
  (f.ids ? { id: { in: f.ids } } : { [alan]: { gte: ctx.baslangic } }) as Record<string, unknown>

const kisiAdi = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim()

// ── Fatura ───────────────────────────────────────────────────────────────────

const FATURA_SECIMI = {
  id: true,
  companyId: true,
  invoiceNo: true,
  eDocumentNo: true,
  date: true,
  type: true,
  returnKind: true,
  isReceipt: true,
  status: true,
  invoiceType: true,
  currency: true,
  exchangeRate: true,
  globalDiscountAmount: true,
  globalChargeAmount: true,
  payableRoundingAmount: true,
  totalAmount: true,
  customer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  items: {
    select: {
      quantity: true,
      unitPrice: true,
      discountAmount: true,
      vatRate: true,
      withholdingRate: true,
      gekapAmount: true,
      vatAmount: true,
      withholdingAmount: true,
      exciseAmount: true,
      totalAmount: true,
      productId: true,
      product: { select: { isService: true } },
    },
  },
} as const

async function faturaFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  const faturalar = await prisma.invoice.findMany({
    where: { companyId: { in: ctx.sirketIds }, ...kapsam("date", ctx, filtre) },
    select: FATURA_SECIMI,
  })
  return faturalar.map((f) => {
    const alis =
      f.type === "PURCHASE" || (f.type === "RETURN" && String(f.returnKind || "").toUpperCase() === "PURCHASE")
    // Karşı yönlü (mahsup) belge: alışın tedarikçisi yoksa müşterisi, satışın müşterisi
    // yoksa tedarikçisi — cari bakiyesi belgeyi dolu olan carinin hesabına yazıyor.
    const dogal = alis ? f.supplier : f.customer
    const karsi = alis ? f.customer : f.supplier
    const cari = dogal
      ? { id: dogal.id, ad: dogal.name, tur: alis ? ("tedarikci" as const) : ("musteri" as const) }
      : karsi
        ? { id: karsi.id, ad: karsi.name, tur: alis ? ("musteri" as const) : ("tedarikci" as const) }
        : null
    const belge: FisBelgesi = {
      id: f.id,
      no: f.eDocumentNo || f.invoiceNo,
      tarih: utcGunu(f.date),
      type: f.type,
      returnKind: f.returnKind,
      isReceipt: f.isReceipt,
      status: f.status,
      invoiceType: f.invoiceType,
      currency: f.currency,
      exchangeRate: f.exchangeRate,
      globalDiscountAmount: f.globalDiscountAmount,
      globalChargeAmount: f.globalChargeAmount,
      payableRoundingAmount: f.payableRoundingAmount,
      totalAmount: f.totalAmount,
      cari,
      kalemler: f.items.map((k) => ({ ...k, urunHizmetMi: k.product ? k.product.isService : null })),
    }
    return { tip: "INVOICE" as const, id: f.id, sirketId: f.companyId, fis: belgeFisTaslagi(belge, ctx.eslesme), giris: f.date }
  })
}

// ── Kasa / banka hareketi ────────────────────────────────────────────────────

type HareketSatiri = {
  id: string
  companyId: string
  accountId: string
  date: Date
  type: string
  amount: Prisma.Decimal
  reference: string | null
}

const gunAnahtari = (d: Date) => istanbulGunu(d).toISOString().slice(0, 10)

/**
 * Hesaplar arası virmanın iki bacağını eşleştirir (saf). Kaynak bacak `TRANSFER`,
 * hedef bacak `INCOME` + `TRANSFER:<kaynak kasa>` referanslıdır; ortak bir kimlik
 * taşımazlar (app/api/finans/transactions). Eşleşme: aynı firma, aynı tutar, aynı
 * İstanbul günü, hedefin referansı kaynağın kasası (ve kaynak referansı hedefi
 * gösteriyorsa o kasa). Her bacak en çok bir kez eşleşir, sıra id'ye göre.
 */
export function virmanEslestir(bacaklar: HareketSatiri[]): Map<string, string> {
  const kaynaklar = bacaklar.filter((b) => b.type === "TRANSFER").sort((a, b) => a.id.localeCompare(b.id))
  const hedefler = bacaklar
    .filter((b) => b.type === "INCOME" && b.reference?.startsWith(TRANSFER_REFERENCE_PREFIX))
    .sort((a, b) => a.id.localeCompare(b.id))
  const kullanilan = new Set<string>()
  const cift = new Map<string, string>() // her iki yönde: kaynak→hedef, hedef→kaynak
  for (const k of kaynaklar) {
    const hedefKasa = k.reference?.startsWith(TRANSFER_REFERENCE_PREFIX) ? k.reference.slice(TRANSFER_REFERENCE_PREFIX.length) : null
    const h = hedefler.find(
      (t) =>
        !kullanilan.has(t.id) &&
        t.companyId === k.companyId &&
        t.reference === `${TRANSFER_REFERENCE_PREFIX}${k.accountId}` &&
        t.amount.equals(k.amount) &&
        gunAnahtari(t.date) === gunAnahtari(k.date) &&
        (!hedefKasa || t.accountId === hedefKasa),
    )
    if (!h) continue
    kullanilan.add(h.id)
    cift.set(k.id, h.id)
    cift.set(h.id, k.id)
  }
  return cift
}

async function hareketFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  const satirlar = await prisma.transaction.findMany({
    where: { companyId: { in: ctx.sirketIds }, ...kapsam("date", ctx, filtre) },
    select: {
      id: true,
      companyId: true,
      accountId: true,
      date: true,
      type: true,
      amount: true,
      currency: true,
      description: true,
      category: true,
      reference: true,
      account: { select: { id: true, name: true, type: true, companyId: true } },
      customer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      invoicePayments: { select: { invoice: { select: { type: true, returnKind: true } } }, take: 1 },
      employeeLedger: { select: { employee: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })
  if (satirlar.length === 0) return []

  // Bordro ödemesi: hareket bir bordro kaydına bağlı (PayrollRecord.transactionId).
  const bordrolar = await prisma.payrollRecord.findMany({
    where: { transactionId: { in: satirlar.map((s) => s.id) } },
    select: { transactionId: true, employee: { select: { id: true, firstName: true, lastName: true } } },
  })
  const bordroPersonel = new Map(bordrolar.map((b) => [b.transactionId!, b.employee]))

  // Masraf iadesi: CALISAN:<personel> (defter satırı yoksa da referanstan).
  const calisanIds = satirlar
    .filter((s) => s.reference?.startsWith(EMPLOYEE_REIMBURSEMENT_PREFIX) && !s.employeeLedger)
    .map((s) => s.reference!.slice(EMPLOYEE_REIMBURSEMENT_PREFIX.length))
  const calisanlar = calisanIds.length
    ? await prisma.employee.findMany({ where: { id: { in: calisanIds } }, select: { id: true, firstName: true, lastName: true } })
    : []
  const calisanMap = new Map(calisanlar.map((c) => [c.id, c]))

  // Çek/senet tahsili: CEK:<id> / SENET:<id> → evrakın yönü ve numarası.
  const cekIds = satirlar.filter((s) => s.reference?.startsWith(CHECK_SETTLEMENT_PREFIXES.CHECK)).map((s) => s.reference!.slice(4))
  const senetIds = satirlar
    .filter((s) => s.reference?.startsWith(CHECK_SETTLEMENT_PREFIXES.PROMISSORY_NOTE))
    .map((s) => s.reference!.slice(6))
  const [cekler, senetler] = await Promise.all([
    cekIds.length
      ? prisma.check.findMany({ where: { id: { in: cekIds } }, select: { id: true, checkNo: true, direction: true, supplierId: true } })
      : [],
    senetIds.length
      ? prisma.promissoryNote.findMany({ where: { id: { in: senetIds } }, select: { id: true, noteNo: true, direction: true, supplierId: true } })
      : [],
  ])
  const cekMap = new Map(cekler.map((c) => [c.id, c]))
  const senetMap = new Map(senetler.map((n) => [n.id, n]))

  // Virman bacakları: karşı bacak yüklenen kümede olmayabilir (tek kayıt yolu) → ±2 gün aday.
  const virmanlar = satirlar.filter((s) => s.type === "TRANSFER" || s.reference?.startsWith(TRANSFER_REFERENCE_PREFIX))
  const kasaMap = new Map<string, { id: string; name: string; type: string }>()
  for (const s of satirlar) kasaMap.set(s.account.id, { id: s.account.id, name: s.account.name, type: s.account.type })
  /** Eşleşen bacağın karşı kasası, hareket id'sine göre. */
  const karsiKasa = new Map<string, { id: string; name: string; type: string }>()
  const eslesen = new Set<string>()
  if (virmanlar.length) {
    const tarihler = virmanlar.map((v) => v.date.getTime())
    const adaylar = await prisma.transaction.findMany({
      where: {
        companyId: { in: ctx.sirketIds },
        OR: [{ type: "TRANSFER" }, { reference: { startsWith: TRANSFER_REFERENCE_PREFIX } }],
        date: { gte: new Date(Math.min(...tarihler) - 2 * 86_400_000), lte: new Date(Math.max(...tarihler) + 2 * 86_400_000) },
      },
      select: {
        id: true,
        companyId: true,
        accountId: true,
        date: true,
        type: true,
        amount: true,
        reference: true,
        account: { select: { id: true, name: true, type: true } },
      },
    })
    for (const a of adaylar) kasaMap.set(a.account.id, a.account)
    const tum = new Map<string, HareketSatiri>()
    for (const a of adaylar) tum.set(a.id, a)
    for (const v of virmanlar) tum.set(v.id, v)
    const cift = virmanEslestir([...tum.values()])
    for (const v of virmanlar) {
      const karsiId = cift.get(v.id)
      const karsi = karsiId ? tum.get(karsiId) : undefined
      if (!karsi) continue
      eslesen.add(v.id)
      const k = kasaMap.get(karsi.accountId)
      if (k) karsiKasa.set(v.id, k)
    }
    // Eşleşmemiş giriş bacağının kaynak kasası referansta.
    const eksikKasa = virmanlar
      .filter((v) => v.type === "INCOME" && !eslesen.has(v.id))
      .map((v) => v.reference!.slice(TRANSFER_REFERENCE_PREFIX.length))
      .filter((id) => !kasaMap.has(id))
    if (eksikKasa.length) {
      const kasalar = await prisma.financialAccount.findMany({
        where: { id: { in: eksikKasa } },
        select: { id: true, name: true, type: true },
      })
      for (const k of kasalar) kasaMap.set(k.id, k)
    }
  }

  return satirlar.map((s) => {
    const hesap = { id: s.account.id, ad: s.account.name, tur: s.account.type }
    const odeme = s.invoicePayments[0]?.invoice
    const odemeAlis =
      odeme && (odeme.type === "PURCHASE" || (odeme.type === "RETURN" && String(odeme.returnKind || "").toUpperCase() === "PURCHASE"))
    const personelKaydi =
      bordroPersonel.get(s.id) ??
      s.employeeLedger?.employee ??
      (s.reference?.startsWith(EMPLOYEE_REIMBURSEMENT_PREFIX)
        ? calisanMap.get(s.reference.slice(EMPLOYEE_REIMBURSEMENT_PREFIX.length))
        : undefined)
    let kiymet: HareketGirdisi["kiymet"] = null
    if (s.reference?.startsWith(CHECK_SETTLEMENT_PREFIXES.CHECK)) {
      const c = cekMap.get(s.reference.slice(4))
      if (c) kiymet = { tur: "CEK", yon: resolveCekSenetDirection(c), no: c.checkNo }
    } else if (s.reference?.startsWith(CHECK_SETTLEMENT_PREFIXES.PROMISSORY_NOTE)) {
      const n = senetMap.get(s.reference.slice(6))
      if (n) kiymet = { tur: "SENET", yon: resolveCekSenetDirection(n), no: n.noteNo }
    }
    const virman = s.type === "TRANSFER" || Boolean(s.reference?.startsWith(TRANSFER_REFERENCE_PREFIX))
    const eslesti = virman && eslesen.has(s.id)
    const hedefKasa = eslesti ? karsiKasa.get(s.id) ?? null : null
    const refKasa =
      virman && s.type === "INCOME" && !eslesti ? kasaMap.get(s.reference!.slice(TRANSFER_REFERENCE_PREFIX.length)) ?? null : null
    const girdi: HareketGirdisi = {
      id: s.id,
      tarih: s.date,
      tip: s.type,
      tutar: s.amount,
      paraBirimi: s.currency,
      aciklama: s.description,
      kategori: s.category,
      hesap,
      musteri: s.customer ? { id: s.customer.id, ad: s.customer.name } : null,
      tedarikci: s.supplier ? { id: s.supplier.id, ad: s.supplier.name } : null,
      carisizFaturaOdemesi: odeme && !s.customer && !s.supplier ? { alis: Boolean(odemeAlis) } : null,
      kiymet,
      personel: personelKaydi ? { id: personelKaydi.id, ad: kisiAdi(personelKaydi) } : null,
      virman,
      virmanGirisBacagi: virman && s.type === "INCOME" && eslesti,
      virmanHedefi: s.type === "TRANSFER" && hedefKasa ? { id: hedefKasa.id, ad: hedefKasa.name, tur: hedefKasa.type } : null,
      virmanKaynagi: refKasa ? { id: refKasa.id, ad: refKasa.name, tur: refKasa.type } : null,
      yabanciKasa: !ctx.sirketIds.includes(s.account.companyId),
    }
    return { tip: "TRANSACTION" as const, id: s.id, sirketId: s.companyId, fis: hareketFisi(girdi, ctx.eslesme), giris: s.date }
  })
}

// ── Kasaya bağlanmamış fatura ödemesi ────────────────────────────────────────

async function odemeFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  const odemeler = await prisma.invoicePayment.findMany({
    where: {
      companyId: { in: ctx.sirketIds },
      // Kasaya bağlı ödeme işlem (Transaction) üzerinden fişe girer; burada yalnız kasasızlar.
      transactionId: null,
      ...kapsam("paymentDate", ctx, filtre),
    },
    select: {
      id: true,
      companyId: true,
      amount: true,
      paymentDate: true,
      paymentMethod: true,
      account: { select: { id: true, name: true, type: true } },
      employeeLedger: { select: { employee: { select: { id: true, firstName: true, lastName: true } } } },
      invoice: {
        select: {
          invoiceNo: true,
          eDocumentNo: true,
          type: true,
          returnKind: true,
          status: true,
          currency: true,
          exchangeRate: true,
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  })
  return odemeler.map((o) => {
    const f = o.invoice
    const alis = f.type === "PURCHASE" || (f.type === "RETURN" && String(f.returnKind || "").toUpperCase() === "PURCHASE")
    const dogal = alis ? f.supplier : f.customer
    const karsi = alis ? f.customer : f.supplier
    const p = o.employeeLedger?.employee
    return {
      tip: "PAYMENT" as const,
      id: o.id,
      sirketId: o.companyId,
      giris: o.paymentDate,
      fis: odemeFisi(
        {
          id: o.id,
          tarih: o.paymentDate,
          tutar: o.amount,
          yontem: o.paymentMethod,
          fatura: {
            no: f.eDocumentNo || f.invoiceNo,
            type: f.type,
            returnKind: f.returnKind,
            status: f.status,
            paraBirimi: f.currency,
            kur: f.exchangeRate,
            cari: dogal
              ? { id: dogal.id, ad: dogal.name, tur: alis ? "tedarikci" : "musteri" }
              : karsi
                ? { id: karsi.id, ad: karsi.name, tur: alis ? "musteri" : "tedarikci" }
                : null,
          },
          hesap: o.account ? { id: o.account.id, ad: o.account.name, tur: o.account.type } : null,
          personel: p ? { id: p.id, ad: kisiAdi(p) } : null,
        },
        ctx.eslesme,
      ),
    }
  })
}

// ── Çek / senet ──────────────────────────────────────────────────────────────

type KiymetSatiri = {
  id: string
  companyId: string
  no: string
  amount: Prisma.Decimal
  issueDate: Date
  updatedAt: Date
  status: string
  direction: string | null
  supplierId: string | null
  bankName?: string | null
  customer: { id: string; name: string } | null
  supplier: { id: string; name: string } | null
}

function kiymetGirdisi(k: KiymetSatiri, tur: "CEK" | "SENET") {
  const yon = resolveCekSenetDirection(k)
  return {
    id: k.id,
    tur,
    no: k.no,
    tarih: k.issueDate,
    tutar: k.amount,
    durum: k.status,
    yon,
    banka: k.bankName ?? null,
    musteri: k.customer ? { id: k.customer.id, ad: k.customer.name } : null,
    tedarikci: !k.customer && k.supplier ? { id: k.supplier.id, ad: k.supplier.name } : null,
  }
}

async function kiymetler(
  ctx: YukleyiciBaglami,
  filtre: KaynakFiltresi,
  tur: "CEK" | "SENET",
): Promise<KiymetSatiri[]> {
  const ortak = {
    id: true,
    companyId: true,
    amount: true,
    issueDate: true,
    updatedAt: true,
    status: true,
    direction: true,
    supplierId: true,
    customer: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
  } as const
  const where = { companyId: { in: ctx.sirketIds }, ...kapsam("issueDate", ctx, filtre) }
  if (tur === "CEK") {
    const r = await prisma.check.findMany({ where, select: { ...ortak, checkNo: true, bankName: true } })
    return r.map(({ checkNo, ...k }) => ({ ...k, no: checkNo }))
  }
  const r = await prisma.promissoryNote.findMany({ where, select: { ...ortak, noteNo: true } })
  return r.map(({ noteNo, ...k }) => ({ ...k, no: noteNo }))
}

function kiymetYukleyici(tur: "CEK" | "SENET", tip: "CHECK" | "NOTE") {
  return async (ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> =>
    (await kiymetler(ctx, filtre, tur)).map((k) => ({
      tip,
      id: k.id,
      sirketId: k.companyId,
      giris: k.issueDate,
      fis: kiymetFisi(kiymetGirdisi(k, tur)),
    }))
}

function ciroYukleyici(tur: "CEK" | "SENET", tip: "CHECK_ENDORSE" | "NOTE_ENDORSE") {
  return async (ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> => {
    // Mutabakatta yalnız ciro edilmiş alınan evrak; tek kayıt yolunda hepsi (durum geri
    // alındıysa eski ciro fişi silinsin).
    const liste = await kiymetler(ctx, filtre, tur)
    return liste
      .filter((k) => filtre.ids || (k.status === CIRO_DURUMU && resolveCekSenetDirection(k) === "RECEIVED"))
      .map((k) => ({
        tip,
        id: k.id,
        sirketId: k.companyId,
        // Ciro tarihi tutulmuyor: son güncelleme günü. Başlangıçtan önce alınmış evrak
        // açılış portföyüne bugünkü durumuyla girdi (bilanco-kiymet.ts yaklaşıklığı);
        // cirosu ayrıca fişlenirse 101 iki kez düşerdi.
        giris: k.issueDate.getTime() < ctx.baslangic.getTime() ? k.issueDate : k.updatedAt,
        fis:
          k.issueDate.getTime() < ctx.baslangic.getTime()
            ? { durum: "fise-girmez" as const, sebep: "Evrak başlangıçtan önce alınmış (açılış portföyünde)." }
            : ciroFisi({ ...kiymetGirdisi(k, tur), ciroTarihi: k.updatedAt }),
      }))
  }
}

// ── Cari virman fişi ─────────────────────────────────────────────────────────

async function virmanFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  const fisler = await prisma.cariVirman.findMany({
    where: { companyId: { in: ctx.sirketIds }, ...kapsam("date", ctx, filtre) },
    select: {
      id: true,
      companyId: true,
      virmanNo: true,
      date: true,
      amount: true,
      description: true,
      legs: {
        select: { side: true, customer: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } },
      },
    },
  })
  return fisler.map((v) => ({
    tip: "VIRMAN" as const,
    id: v.id,
    sirketId: v.companyId,
    giris: v.date,
    fis: virmanFisi({
      id: v.id,
      no: v.virmanNo,
      tarih: v.date,
      tutar: v.amount,
      aciklama: v.description,
      bacaklar: v.legs
        .sort((a, b) => (a.side === b.side ? 0 : a.side === "DEBIT" ? -1 : 1))
        .map((l) => ({
          taraf: l.side === "DEBIT" ? ("DEBIT" as const) : ("CREDIT" as const),
          musteri: l.customer ? { id: l.customer.id, ad: l.customer.name } : null,
          tedarikci: l.supplier ? { id: l.supplier.id, ad: l.supplier.name } : null,
        })),
    }),
  }))
}

// ── Bordro ───────────────────────────────────────────────────────────────────

async function bordroFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  const yil = ctx.baslangic.getUTCFullYear()
  const kayitlar = await prisma.payrollRecord.findMany({
    where: {
      companyId: { in: ctx.sirketIds },
      ...(filtre.ids ? { id: { in: filtre.ids } } : { periodYear: { gte: yil } }),
    },
    select: {
      id: true,
      companyId: true,
      periodYear: true,
      periodMonth: true,
      grossSalary: true,
      bonus: true,
      advance: true,
      sgkDeduction: true,
      taxDeduction: true,
      otherDeduction: true,
      netSalary: true,
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  return kayitlar.map((b) => {
    const fis = bordroFisi(
      {
        id: b.id,
        yil: b.periodYear,
        ay: b.periodMonth,
        personel: { id: b.employee.id, ad: kisiAdi(b.employee) },
        brut: b.grossSalary,
        prim: b.bonus,
        avans: b.advance,
        sgk: b.sgkDeduction,
        vergi: b.taxDeduction,
        diger: b.otherDeduction,
        net: b.netSalary,
      },
      ctx.eslesme,
    )
    return { tip: "PAYROLL" as const, id: b.id, sirketId: b.companyId, fis }
  })
}

// ── Başlangıçtan sonra açılan kartların açılış bakiyesi ──────────────────────

/** Kaynak id'si `musteri:<id>` / `tedarikci:<id>` (iki tablo tek kaynak türünde). */
async function cariAcilisFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  const musteriIds = filtre.ids?.filter((i) => i.startsWith("musteri:")).map((i) => i.slice(8))
  const tedarikciIds = filtre.ids?.filter((i) => i.startsWith("tedarikci:")).map((i) => i.slice(10))
  const sec = { id: true, companyId: true, name: true, createdAt: true, openingBalanceAmount: true, openingBalanceType: true } as const
  const [musteriler, tedarikciler] = await Promise.all([
    !filtre.ids || musteriIds?.length
      ? prisma.customer.findMany({
          where: {
            companyId: { in: ctx.sirketIds },
            ...(filtre.ids ? { id: { in: musteriIds } } : { createdAt: { gte: ctx.baslangic }, NOT: { openingBalanceAmount: 0 } }),
          },
          select: sec,
        })
      : [],
    !filtre.ids || tedarikciIds?.length
      ? prisma.supplier.findMany({
          where: {
            companyId: { in: ctx.sirketIds },
            ...(filtre.ids ? { id: { in: tedarikciIds } } : { createdAt: { gte: ctx.baslangic }, NOT: { openingBalanceAmount: 0 } }),
          },
          select: sec,
        })
      : [],
  ])
  const donustur = (tur: "musteri" | "tedarikci") => (c: (typeof musteriler)[number]): KaynakFisi => ({
    tip: "CARI_OPENING",
    id: `${tur}:${c.id}`,
    sirketId: c.companyId,
    giris: c.createdAt,
    fis: cariAcilisFisi(
      { id: c.id, tur, ad: c.name, tarih: c.createdAt, tutar: c.openingBalanceAmount, tip: c.openingBalanceType },
      ctx.eslesme,
    ),
  })
  return [...musteriler.map(donustur("musteri")), ...tedarikciler.map(donustur("tedarikci"))]
}

async function finansAcilisFisleri(ctx: YukleyiciBaglami, filtre: KaynakFiltresi): Promise<KaynakFisi[]> {
  // Açılış bakiyesi hareket üretmez, `balance`a doğrudan yazılır: bugünkü bakiye −
  // hesabın BÜTÜN hareketleri (nakit-hareket.ts ile aynı işaretler).
  const rows = await prisma.$queryRaw<Array<{ id: string; companyId: string; name: string; type: string; createdAt: Date; acilis: unknown }>>`
    SELECT fa.id, fa."companyId", fa.name, fa.type, fa."createdAt",
      fa.balance
      - COALESCE((
          SELECT SUM(CASE WHEN t.type = 'INCOME' THEN t.amount
                          WHEN t.type IN ('EXPENSE', 'TRANSFER') THEN -t.amount ELSE 0 END)
          FROM transactions t WHERE t."accountId" = fa.id
        ), 0)
      - COALESCE((
          SELECT SUM(CASE WHEN i.type = 'SALES' THEN ip.amount ELSE -ip.amount END)
          FROM invoice_payments ip JOIN invoices i ON i.id = ip."invoiceId"
          WHERE ip."accountId" = fa.id AND ip."transactionId" IS NULL
        ), 0) AS acilis
    FROM financial_accounts fa
    WHERE fa."companyId" IN (${Prisma.join(ctx.sirketIds)})
      AND ${filtre.ids ? Prisma.sql`fa.id IN (${Prisma.join(filtre.ids)})` : Prisma.sql`fa."createdAt" >= ${ctx.baslangic}`}
  `
  return rows.map((r) => ({
    tip: "ACCOUNT_OPENING" as const,
    id: r.id,
    sirketId: r.companyId,
    giris: r.createdAt,
    fis: finansAcilisFisi({ hesap: { id: r.id, ad: r.name, tur: r.type }, tarih: r.createdAt, tutar: r.acilis }, ctx.eslesme),
  }))
}

type Yukleyici = (ctx: YukleyiciBaglami, filtre: KaynakFiltresi) => Promise<KaynakFisi[]>

export const KAYNAK_TIPLERI: Record<KaynakTipi, { ad: string; yukle: Yukleyici }> = {
  INVOICE: { ad: "Fatura / fiş", yukle: faturaFisleri },
  PAYMENT: { ad: "Kasasız ödeme", yukle: odemeFisleri },
  TRANSACTION: { ad: "Kasa / banka hareketi", yukle: hareketFisleri },
  CHECK: { ad: "Çek", yukle: kiymetYukleyici("CEK", "CHECK") },
  CHECK_ENDORSE: { ad: "Çek cirosu", yukle: ciroYukleyici("CEK", "CHECK_ENDORSE") },
  NOTE: { ad: "Senet", yukle: kiymetYukleyici("SENET", "NOTE") },
  NOTE_ENDORSE: { ad: "Senet cirosu", yukle: ciroYukleyici("SENET", "NOTE_ENDORSE") },
  VIRMAN: { ad: "Cari virman", yukle: virmanFisleri },
  PAYROLL: { ad: "Bordro", yukle: bordroFisleri },
  CARI_OPENING: { ad: "Cari açılış bakiyesi", yukle: cariAcilisFisleri },
  ACCOUNT_OPENING: { ad: "Kasa açılış bakiyesi", yukle: finansAcilisFisleri },
}

export function kaynakTipiMi(v: unknown): v is KaynakTipi {
  return typeof v === "string" && v in KAYNAK_TIPLERI
}
