/**
 * "e-Faturaları İndir" / "UBL (XML) İndir" menülerinin indirilecek belge listesi.
 *
 * Ekranın süzgeçleri AYNEN gelir ve liste `fetchInvoiceList`ten (ekranla aynı sorgu)
 * kurulur; ekranın 500 satır tavanı burada 10.000'dir. İstemcinin elindeki satırlardan
 * indirmek 500'ü aşan dönemde sessizce eksik arşiv verirdi.
 *
 * Resmî belgesi olan fatura:
 *   alış  → GELEN E-FATURADAN dönüştürülmüş olan (`meta.inboxUuid`) — belge gelen kutusundan.
 *   satış → GİB'e GÖNDERİLMİŞ e-Fatura/e-Arşiv (SENT + ETTN) — belge giden kutusundan.
 *           Taslak, GİB taslağı, iptal ve manuel fatura resmî PDF'i olmadığı için sayılır
 *           ve ayrıca bildirilir (resmî PDF ucunun kuralıyla aynı:
 *           app/api/e-donusum/invoices/[id]/pdf).
 * Kullanıcı "45 fatura vardı, zip'te 30 belge var" farkının sebebini görmeli.
 *
 * Belgelerin kendisi tek tek indirilir (istemci zip'i kurar): tek yanıtta yüzlerce
 * PDF'i zip'lemek sunucu yanıt sınırını (4,5 MB) aşardı. İndirme adresleri burada
 * kurulur ki istemci iki yönün uç farkını bilmek zorunda kalmasın.
 */

import { NextResponse } from "next/server"
import { parseDateParam, parseIntParam } from "@/lib/http/query-params"
import { fetchInvoiceList } from "@/lib/faturalar/list-query"
import { parseTrNumber } from "@/lib/format"

const LIST_LIMIT = 10000

export type EBelgeArsivKalemi = {
  invoiceNo: string | null
  date: string | null
  counterpartyName: string | null
  pdfUrl: string
  xmlUrl: string
}

export async function listEBelgeArsivi(
  companyId: string,
  searchParams: URLSearchParams,
  yon: "alis" | "satis",
): Promise<Response> {
  // Okunamayan tutar süzgeci SESSİZCE düşmez (liste ucuyla aynı kural): düşseydi
  // arşiv ekranda görünenden fazla belge taşırdı.
  const amount = (key: string): number | null | "invalid" => {
    const raw = (searchParams.get(key) || "").trim()
    if (!raw) return null
    return parseTrNumber(raw) ?? "invalid"
  }
  const minAmount = amount("minAmount")
  const maxAmount = amount("maxAmount")
  if (minAmount === "invalid" || maxAmount === "invalid") {
    return NextResponse.json({ error: "Tutar süzgeci sayı olmalı." }, { status: 400 })
  }

  const result = await fetchInvoiceList({
    companyId,
    direction: yon === "alis" ? "incoming" : "outgoing",
    includeInbox: false,
    days: parseIntParam(searchParams.get("days"), "days", { min: 1, max: 3650 }) ?? 90,
    startDate: parseDateParam(searchParams.get("startDate"), "startDate"),
    endDate: parseDateParam(searchParams.get("endDate"), "endDate"),
    status: searchParams.get("status"),
    search: searchParams.get("search"),
    counterparty: searchParams.get("counterparty"),
    taxNumber: searchParams.get("taxNumber"),
    category: searchParams.get("category"),
    minAmount,
    maxAmount,
    limit: LIST_LIMIT,
  })

  const q = `?companyId=${encodeURIComponent(companyId)}`
  const items: EBelgeArsivKalemi[] = []
  for (const row of result.data) {
    const base = { invoiceNo: row.invoiceNo, date: row.date, counterpartyName: row.counterparty.name }
    if (yon === "alis") {
      const uuid = typeof row.meta?.inboxUuid === "string" ? row.meta.inboxUuid : ""
      if (!uuid) continue
      const path = `/api/e-donusum/inbox/${encodeURIComponent(uuid)}`
      items.push({ ...base, pdfUrl: `${path}/pdf${q}`, xmlUrl: `${path}/ubl${q}` })
    } else {
      const isEDocument = row.invoiceType === "E_INVOICE" || row.invoiceType === "E_ARCHIVE"
      if (!isEDocument || row.status !== "SENT" || !row.uuid || !row.id.startsWith("invoice:")) continue
      const path = `/api/e-donusum/invoices/${encodeURIComponent(row.id.slice("invoice:".length))}`
      items.push({ ...base, pdfUrl: `${path}/pdf${q}`, xmlUrl: `${path}/ubl${q}` })
    }
  }

  return NextResponse.json({
    items,
    total: result.data.length,
    skipped: result.data.length - items.length,
    skippedReason:
      yon === "alis"
        ? "elle girilmiş (gelen e-faturadan dönüştürülmemiş)"
        : "GİB'e gönderilmiş e-belge değil (manuel, taslak ya da iptal)",
    truncated: result.truncated,
  })
}
