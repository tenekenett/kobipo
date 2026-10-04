import { prisma } from "@/lib/db/prisma"
import { belgeHedefi } from "@/lib/arama/kayit-arama-kural"

/**
 * Fişin kaynağı — odak görünümünde başlık ve "kaynağı aç" linki. Link KAYNAĞIN
 * firmasıyla açılır (şube kaydı şubenin `?company=`siyle; CLAUDE.md "Panel
 * linkleri" kritik istisnası) — bunu çağıran uç `sirketId`yi ekler.
 */
export type KaynakBilgisi = { tip: string; ad: string; no: string | null; path: string | null }

const cariYolu = (c: { customerId?: string | null; supplierId?: string | null; slug?: string | null; id: string }, musteri: boolean) =>
  `/cari/${musteri ? "customers" : "suppliers"}/${c.slug || c.id}`

export async function kaynakBilgisi(tip: string, id: string | null): Promise<KaynakBilgisi | null> {
  if (tip === "MANUAL") return { tip, ad: "Elle fiş", no: null, path: null }
  if (tip === "OPENING") return { tip, ad: "Açılış bakiyeleri", no: null, path: null }
  if (tip === "CLOSING") return { tip, ad: "Dönem kapanışı", no: null, path: null }
  if (!id) return null
  const silinmis = { tip, ad: "Silinmiş kayıt", no: null, path: null }

  switch (tip) {
    case "INVOICE": {
      const f = await prisma.invoice.findUnique({
        where: { id },
        select: { id: true, invoiceNo: true, eDocumentNo: true, type: true, returnKind: true, isReceipt: true },
      })
      if (!f) return silinmis
      const h = belgeHedefi(f)
      return { tip, ad: h.turAdi, no: f.eDocumentNo || f.invoiceNo, path: h.path }
    }
    case "PAYMENT": {
      const p = await prisma.invoicePayment.findUnique({
        where: { id },
        select: {
          paymentMethod: true,
          invoice: { select: { id: true, invoiceNo: true, eDocumentNo: true, type: true, returnKind: true, isReceipt: true } },
        },
      })
      if (!p) return silinmis
      const ad = p.paymentMethod === "WRITE_OFF" ? "Bakiye kapama" : p.paymentMethod === "EMPLOYEE" ? "Çalışan cebinden ödeme" : "Fatura ödemesi"
      return { tip, ad, no: p.invoice.eDocumentNo || p.invoice.invoiceNo, path: belgeHedefi(p.invoice).path }
    }
    case "TRANSACTION": {
      const t = await prisma.transaction.findUnique({ where: { id }, select: { type: true, description: true, account: { select: { name: true } } } })
      if (!t) return silinmis
      const ad = t.type === "INCOME" ? "Para girişi" : t.type === "TRANSFER" ? "Hesaplar arası virman" : "Para çıkışı"
      return { tip, ad: `${ad} · ${t.account.name}`, no: null, path: "/finans/hareketler" }
    }
    case "CHECK":
    case "CHECK_ENDORSE": {
      const c = await prisma.check.findUnique({ where: { id }, select: { checkNo: true } })
      if (!c) return silinmis
      return { tip, ad: tip === "CHECK" ? "Çek" : "Çek cirosu", no: c.checkNo, path: `/cek-senet/cek/${id}` }
    }
    case "NOTE":
    case "NOTE_ENDORSE": {
      const n = await prisma.promissoryNote.findUnique({ where: { id }, select: { noteNo: true } })
      if (!n) return silinmis
      return { tip, ad: tip === "NOTE" ? "Senet" : "Senet cirosu", no: n.noteNo, path: `/cek-senet/senet/${id}` }
    }
    case "VIRMAN": {
      const v = await prisma.cariVirman.findUnique({
        where: { id },
        select: {
          virmanNo: true,
          legs: { select: { customer: { select: { id: true, slug: true } }, supplier: { select: { id: true, slug: true } } }, take: 1 },
        },
      })
      if (!v) return silinmis
      const bacak = v.legs[0]
      const path = bacak?.customer ? cariYolu(bacak.customer, true) : bacak?.supplier ? cariYolu(bacak.supplier, false) : null
      return { tip, ad: "Cari virman fişi", no: v.virmanNo, path }
    }
    case "PAYROLL": {
      const b = await prisma.payrollRecord.findUnique({
        where: { id },
        select: { periodYear: true, periodMonth: true, employee: { select: { firstName: true, lastName: true } } },
      })
      if (!b) return silinmis
      return {
        tip,
        ad: `Bordro · ${b.employee.firstName} ${b.employee.lastName}`.trim(),
        no: `${String(b.periodMonth).padStart(2, "0")}/${b.periodYear}`,
        path: "/personel/maas",
      }
    }
    case "CARI_OPENING": {
      const musteri = id.startsWith("musteri:")
      const cid = id.slice(id.indexOf(":") + 1)
      const c = musteri
        ? await prisma.customer.findUnique({ where: { id: cid }, select: { id: true, slug: true, name: true } })
        : await prisma.supplier.findUnique({ where: { id: cid }, select: { id: true, slug: true, name: true } })
      if (!c) return silinmis
      return { tip, ad: `Açılış bakiyesi · ${c.name}`, no: null, path: cariYolu(c, musteri) }
    }
    case "ACCOUNT_OPENING": {
      const k = await prisma.financialAccount.findUnique({ where: { id }, select: { name: true } })
      if (!k) return silinmis
      return { tip, ad: `Açılış bakiyesi · ${k.name}`, no: null, path: "/finans/kanallar" }
    }
  }
  return { tip, ad: tip, no: null, path: null }
}
