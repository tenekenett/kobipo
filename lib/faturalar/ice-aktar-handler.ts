/**
 * Fatura içe aktarma ucunun gövdesi — alış ve satış uçları bunu çağırır:
 *
 *   POST /api/faturalar/alis/ice-aktar   (tür: alis)
 *   POST /api/faturalar/satis/ice-aktar  (tür: satis | ihracat — gövdedeki `tur`)
 *
 * Yön YOLDA durur ki sayfa kapısı doğru ekrana sorsun (PAGE_API_RULES →
 * /api/faturalar/alis → Alış Faturaları, /api/faturalar/satis → Satış Faturaları):
 * satış yazma izni olmayan biri alış ucundan satış faturası açamaz.
 *
 *   { companyId, fileBase64, fileName, mode: "preview" }
 *     → dosyayı okur, her faturanın planını (cari eşleşmesi, toplam, hatalar) döner.
 *       Hiçbir şey yazmaz.
 *   { companyId, fileBase64, fileName, mode: "import", keys: [...] }
 *     → yalnız verilen faturaları yazar (en fazla MAX_KEYS_PER_REQUEST).
 *
 * Neden parça parça: her fatura editörün çekirdeğinden (stok, muhasebe fişi, kota)
 * geçiyor; 300 faturayı tek istekte yazmak süre sınırını aşardı. İstemci dosyayı
 * her parçada yeniden gönderir ve sunucu planı BAŞTAN kurar — önceki parçada açılan
 * cari artık "mevcut" eşleşir, yazılmış fatura "zaten kayıtlı" olur. İstemciden
 * gelen hiçbir ara sonuca güvenmek gerekmez.
 */

import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { isAccessDeniedError } from "@/lib/api/errors"
import { resolveCariVisibility } from "@/lib/cari/resolve-visibility"
import { assertCariMirrorWrite } from "@/lib/cari/dual-role-access"
import { sessionWriteActor } from "@/lib/api/session-actor"
import { parseFaturaSablonu, type SablonTuru } from "@/lib/faturalar/fatura-sablon"
import {
  prepareFaturaImport,
  runFaturaImport,
  type ImportPlan,
  type ImportResult,
} from "@/lib/faturalar/fatura-ice-aktar"

/** İstek gövdesi (base64) sınırı: dosya ~3 MB. Vercel gövde sınırı 4,5 MB. */
const MAX_FILE_BYTES = 3 * 1024 * 1024
const MAX_KEYS_PER_REQUEST = 25

function readSheetRows(fileBase64: string, fileName: string): unknown[][] {
  const buffer = Buffer.from(fileBase64, "base64")
  // CSV metin olarak okunur ve DEĞER ÇEVRİLMEZ (`raw`): "01.02.2026" tarihe,
  // "1.234,50" sayıya SheetJS'in kendi (ABD) kuralıyla dönmesin; ikisini de
  // şablon ayrıştırıcısı Türkçe biçimle okur.
  const workbook = /\.csv$/i.test(fileName)
    ? XLSX.read(buffer.toString("utf8"), { type: "string", raw: true })
    : XLSX.read(buffer, { type: "buffer" })
  const first = workbook.SheetNames[0]
  if (!first) return []
  // `raw: true`: sayı hücresi sayı, tarih hücresi Excel seri numarası olarak gelir.
  // Görünen metni (`raw: false`) okumak hücre biçimine bağlı kalırdı — "9/26/26"
  // gibi bir tarih gösterimi ay/gün karışıklığı doğurur.
  return XLSX.utils.sheet_to_json(workbook.Sheets[first], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  }) as unknown[][]
}

function planSummary(plan: ImportPlan) {
  return {
    key: plan.key,
    rows: plan.rows,
    invoiceNo: plan.invoiceNo,
    date: plan.date,
    dueDate: plan.dueDate,
    dueDateSource: plan.dueDateSource,
    counterparty: plan.counterparty
      ? { kind: plan.counterparty.kind, name: plan.counterparty.name, taxNumber: plan.counterparty.taxNumber }
      : null,
    currency: plan.currency,
    category: plan.category,
    lineCount: plan.lines.length,
    stockLineCount: plan.lines.filter((l) => l.productId).length,
    totals: plan.totals,
    errors: plan.errors,
    warnings: plan.warnings,
  }
}

export async function handleFaturaImport(request: Request, allowed: SablonTuru[]): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 })
  }
  const tur: SablonTuru = allowed.length === 1 ? allowed[0] : body.tur
  if (!allowed.includes(tur)) {
    return NextResponse.json({ error: `Geçersiz aktarım türü (${allowed.join(" | ")}).` }, { status: 400 })
  }
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  const mode = body.mode === "import" ? "import" : "preview"
  const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : ""
  const fileName = typeof body.fileName === "string" && body.fileName ? body.fileName : "dosya.xlsx"
  if (!fileBase64) return NextResponse.json({ error: "Dosya seçilmedi." }, { status: 400 })
  if (Math.floor((fileBase64.length * 3) / 4) > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "Dosya 3 MB'tan büyük. Dosyayı bölüp parça parça aktarın." },
      { status: 413 },
    )
  }

  // Kapı: ekranın yazması (yoldan). Yeni cari kartı ise AYRICA Tedarikçi/Müşteri
  // sayfasının yazmasını ister — fatura izni cari kartı açma hakkı vermez
  // (editörde de öyle: useCanCreateCari).
  const access = await ensureCompanyWrite(companyId)
  const visibility = await resolveCariVisibility(companyId)
  let canCreateCounterparty = true
  try {
    await assertCariMirrorWrite(access, tur === "alis" ? "supplier" : "customer")
  } catch (error) {
    if (!isAccessDeniedError(error)) throw error
    canCreateCounterparty = false
  }

  let sheetRows: unknown[][]
  try {
    sheetRows = readSheetRows(fileBase64, fileName)
  } catch {
    return NextResponse.json(
      { error: "Dosya okunamadı. Excel (.xlsx, .xls) ya da CSV dosyası seçin." },
      { status: 400 },
    )
  }

  const parsed = parseFaturaSablonu(sheetRows, tur)
  if (parsed.missingColumns.length > 0) {
    return NextResponse.json(
      {
        error: `Şablonda zorunlu sütun eksik: ${parsed.missingColumns.join(", ")}. Kobipo şablonunu indirip onunla hazırlayın.`,
        missingColumns: parsed.missingColumns,
        unknownColumns: parsed.unknownColumns,
      },
      { status: 400 },
    )
  }
  if (parsed.fileError) {
    return NextResponse.json({ error: parsed.fileError, unknownColumns: parsed.unknownColumns }, { status: 400 })
  }

  const ctx = { tur, visibility, canCreateCounterparty }
  const plans = await prepareFaturaImport(companyId, parsed.invoices, ctx)

  if (mode === "preview") {
    const ready = plans.filter((p) => p.errors.length === 0)
    return NextResponse.json({
      mode,
      tur,
      unknownColumns: parsed.unknownColumns,
      canCreateCounterparty,
      summary: {
        invoices: plans.length,
        ready: ready.length,
        failed: plans.length - ready.length,
        newCounterparties: new Set(
          ready.flatMap((p) => (p.counterparty?.kind === "new" ? [p.counterparty.newKey] : [])),
        ).size,
      },
      invoices: plans.map(planSummary),
    })
  }

  const keys: string[] = Array.isArray(body.keys)
    ? Array.from(new Set(body.keys.filter((k: unknown): k is string => typeof k === "string" && k !== "")))
    : []
  if (keys.length === 0) {
    return NextResponse.json({ error: "Aktarılacak fatura seçilmedi." }, { status: 400 })
  }
  if (keys.length > MAX_KEYS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Tek istekte en fazla ${MAX_KEYS_PER_REQUEST} fatura aktarılır.` },
      { status: 400 },
    )
  }

  const byKey = new Map(plans.map((p) => [p.key, p]))
  const selected = keys.map((k) => byKey.get(k)).filter((p): p is ImportPlan => Boolean(p))
  const results: ImportResult[] = await runFaturaImport(companyId, selected, sessionWriteActor(user.id), ctx)
  for (const key of keys) {
    if (!byKey.has(key)) {
      results.push({
        key,
        invoiceNo: "",
        ok: false,
        error: "Fatura dosyada bulunamadı; dosya önizlemeden sonra değişmiş olabilir.",
      })
    }
  }

  return NextResponse.json({ mode, tur, results })
}
