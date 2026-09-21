/**
 * Mükerrer kayıt denetimi — belge kaydedilmeden ÖNCE sorulur (plan §3.6).
 *
 * Anahtar sırası: ETTN › cari + belge no › cari + gün + tutar. Sonuç ENGEL değil
 * UYARIDIR: uç bulduğunu söyler, kararı onay kutusu ve kullanıcı verir (fişteki
 * kural). Fiş kendi ucunu kullanmaya devam eder (/api/alis/fis-tarama GET).
 *
 *   GET ?companyId&tur=FATURA|IRSALIYE|CEK|SENET|DEKONT&yon=ALIS|SATIS
 *       &no=&ettn=&cariId=&date=YYYY-MM-DD&total=
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { resolveReportDateFilter } from "@/lib/raporlar/satis-alis-shared"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export type MukerrerKaydi = {
  anahtar: "ettn" | "no" | "gun-tutar" | "referans"
  kaynak: "invoice" | "incoming" | "waybill" | "check" | "note" | "payment"
  id: string
  no: string | null
  slug: string | null
  date: string | null
  total: number | null
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const tur = (sp.get("tur") || "").toUpperCase()
  const yon = (sp.get("yon") || "ALIS").toUpperCase() === "SATIS" ? "SATIS" : "ALIS"
  const no = (sp.get("no") || "").trim()
  const ettn = (sp.get("ettn") || "").trim().toLowerCase()
  const cariId = sp.get("cariId") || null
  const gun = sp.get("date")
  const total = sp.get("total") != null ? Number(sp.get("total")) : NaN
  const aralik = gun ? resolveReportDateFilter(gun, gun) : null

  const bulunan: MukerrerKaydi[] = []
  const tutarEsit = (a: unknown) => Number.isFinite(total) && Math.abs(Number(a) - total) < 0.01

  if (tur === "FATURA") {
    const type = yon === "SATIS" ? "SALES" : "PURCHASE"
    if (ettn) {
      // ETTN nota "ETTN: <uuid>" olarak yazılır (to-invoice.ts); indeks yok, firma kapsamı yeter.
      const inv = await prisma.invoice.findFirst({
        where: { companyId, status: { not: "CANCELLED" }, notes: { contains: ettn } },
        select: { id: true, invoiceNo: true, slug: true, date: true, totalAmount: true },
      })
      if (inv) bulunan.push({ anahtar: "ettn", kaynak: "invoice", id: inv.id, no: inv.invoiceNo, slug: inv.slug, date: inv.date.toISOString(), total: Number(inv.totalAmount) })
      // Aynı e-fatura Mysoft gelen kutusundan da düşmüş olabilir (plan §3.5).
      const gelen = await prisma.incomingInvoice.findFirst({
        where: { companyId, uuid: ettn },
        select: { id: true, invoiceNo: true, linkedInvoiceId: true },
      })
      if (gelen) bulunan.push({ anahtar: "ettn", kaynak: "incoming", id: gelen.linkedInvoiceId ?? gelen.id, no: gelen.invoiceNo, slug: null, date: null, total: null })
    }
    if (bulunan.length === 0 && no) {
      const inv = await prisma.invoice.findFirst({
        where: {
          companyId,
          type,
          status: { not: "CANCELLED" },
          invoiceNo: { equals: no, mode: "insensitive" },
          ...(cariId ? (type === "PURCHASE" ? { supplierId: cariId } : { customerId: cariId }) : {}),
        },
        select: { id: true, invoiceNo: true, slug: true, date: true, totalAmount: true },
      })
      if (inv) bulunan.push({ anahtar: "no", kaynak: "invoice", id: inv.id, no: inv.invoiceNo, slug: inv.slug, date: inv.date.toISOString(), total: Number(inv.totalAmount) })
    }
    if (bulunan.length === 0 && aralik && Number.isFinite(total)) {
      const adaylar = await prisma.invoice.findMany({
        where: {
          companyId,
          type,
          isReceipt: false,
          status: { not: "CANCELLED" },
          date: aralik,
          ...(cariId ? (type === "PURCHASE" ? { supplierId: cariId } : { customerId: cariId }) : {}),
        },
        select: { id: true, invoiceNo: true, slug: true, date: true, totalAmount: true },
        take: 20,
      })
      const es = adaylar.find((a) => tutarEsit(a.totalAmount))
      if (es) bulunan.push({ anahtar: "gun-tutar", kaynak: "invoice", id: es.id, no: es.invoiceNo, slug: es.slug, date: es.date.toISOString(), total: Number(es.totalAmount) })
    }
  } else if (tur === "IRSALIYE") {
    const type = yon === "SATIS" ? "SALES" : "PURCHASE"
    if (no) {
      const w = await prisma.waybill.findFirst({
        where: { companyId, type, status: { not: "CANCELLED" }, waybillNo: { equals: no, mode: "insensitive" }, ...(cariId ? (type === "PURCHASE" ? { supplierId: cariId } : { customerId: cariId }) : {}) },
        select: { id: true, waybillNo: true, date: true },
      })
      if (w) bulunan.push({ anahtar: "no", kaynak: "waybill", id: w.id, no: w.waybillNo, slug: null, date: w.date.toISOString(), total: null })
    }
  } else if (tur === "CEK") {
    if (no) {
      const c = await prisma.check.findFirst({ where: { companyId, checkNo: { equals: no, mode: "insensitive" } }, select: { id: true, checkNo: true, dueDate: true, amount: true } })
      if (c) bulunan.push({ anahtar: "no", kaynak: "check", id: c.id, no: c.checkNo, slug: null, date: c.dueDate.toISOString(), total: Number(c.amount) })
    }
  } else if (tur === "SENET") {
    if (no) {
      const n = await prisma.promissoryNote.findFirst({ where: { companyId, noteNo: { equals: no, mode: "insensitive" } }, select: { id: true, noteNo: true, dueDate: true, amount: true } })
      if (n) bulunan.push({ anahtar: "no", kaynak: "note", id: n.id, no: n.noteNo, slug: null, date: n.dueDate.toISOString(), total: Number(n.amount) })
    }
  } else if (tur === "DEKONT") {
    if (no) {
      const p = await prisma.invoicePayment.findFirst({ where: { companyId, reference: { equals: no, mode: "insensitive" } }, select: { id: true, reference: true, paymentDate: true, amount: true } })
      if (p) bulunan.push({ anahtar: "referans", kaynak: "payment", id: p.id, no: p.reference, slug: null, date: p.paymentDate.toISOString(), total: Number(p.amount) })
    }
    if (bulunan.length === 0 && aralik && Number.isFinite(total)) {
      const adaylar = await prisma.invoicePayment.findMany({ where: { companyId, paymentDate: aralik }, select: { id: true, reference: true, paymentDate: true, amount: true }, take: 50 })
      const es = adaylar.find((a) => tutarEsit(a.amount))
      if (es) bulunan.push({ anahtar: "gun-tutar", kaynak: "payment", id: es.id, no: es.reference, slug: null, date: es.paymentDate.toISOString(), total: Number(es.amount) })
    }
  } else {
    return NextResponse.json({ error: "tur: FATURA | IRSALIYE | CEK | SENET | DEKONT" }, { status: 400 })
  }

  return NextResponse.json({ mukerrer: bulunan[0] ?? null, tumu: bulunan })
})
