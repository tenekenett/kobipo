import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyExport, pagePermissionsOf } from "@/lib/middleware/company"
import { DATASETS, isKnownDataset, listDatasets } from "@/lib/export/datasets"
import { exportResponse } from "@/lib/export/response"
import { isExportFormat } from "@/lib/export/types"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { BadRequestError } from "@/lib/http/query-params"

export const dynamic = "force-dynamic"
// Büyük listelerde XLSX/PDF üretimi varsayılan 10 sn'yi aşabiliyor.
export const maxDuration = 60

/**
 * Tüm dışa aktarmaların tek girişi:
 *   GET /api/export/<dataset>?companyId=...&format=xlsx|pdf|csv&<filtreler>
 *
 * Filtreler ilgili listenin kendi query paramlarıyla birebir aynı adları
 * kullanır; UI mevcut filtre state'ini olduğu gibi buraya geçirir.
 */

/**
 * PDF satır tavanı. 5.000 satırlık bir tabloyu jsPDF'te üretmek hem belleği
 * hem süreyi zorluyor, hem de basılmayacak 100+ sayfalık bir belge çıkıyor.
 * Sessizce kesmek yerine kullanıcıya Excel'e yönlendiren bir hata döndürülür.
 */
const PDF_ROW_LIMIT = 5000

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ dataset: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { dataset } = await params
    if (!isKnownDataset(dataset)) {
      return NextResponse.json(
        { error: `Bilinmeyen dışa aktarma: ${dataset}`, available: listDatasets() },
        { status: 404 },
      )
    }

    const searchParams = new URL(request.url).searchParams

    const formatParam = (searchParams.get("format") || "xlsx").toLowerCase()
    if (!isExportFormat(formatParam)) {
      return NextResponse.json(
        { error: "format yalnızca xlsx, pdf veya csv olabilir" },
        { status: 400 },
      )
    }

    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(
      searchParams.get("companyId") || searchParams.get("company"),
    )
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    const uyelik = await ensureCompanyExport(companyId)

    const built = await DATASETS[dataset](companyId, searchParams, { izinler: pagePermissionsOf(uyelik) })

    if (formatParam === "pdf") {
      const rowCount = built.sections.reduce((sum, section) => sum + section.rows.length, 0)
      if (rowCount > PDF_ROW_LIMIT) {
        return NextResponse.json(
          {
            error: `PDF için kayıt sayısı çok yüksek (${rowCount.toLocaleString("tr-TR")} satır, sınır ${PDF_ROW_LIMIT.toLocaleString("tr-TR")}). Filtreyi daraltın veya Excel olarak indirin.`,
          },
          { status: 413 },
        )
      }
    }

    return await exportResponse(built, formatParam)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    if (message.toLowerCase().includes("unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Veri kümesinin kendi 4xx'i (ör. muhasebe: kurulum yok, hesap yok, dönem seçilmedi).
    const status = typeof error?.status === "number" ? error.status : error instanceof BadRequestError ? 400 : 0
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: message }, { status })
    }
    console.error("export route error:", error)
    return NextResponse.json(
      { error: message || "Dışa aktarma sırasında hata oluştu." },
      { status: 500 },
    )
  }
})
