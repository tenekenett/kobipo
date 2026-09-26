import { withApiErrors } from "@/lib/api/errors"
import { handleFaturaImport } from "@/lib/faturalar/ice-aktar-handler"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Alış faturalarını Kobipo şablonundan içe aktarır (önizleme + parça parça yazma).
 * Gövde ve kurallar: lib/faturalar/ice-aktar-handler.ts.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  return handleFaturaImport(request, ["alis"])
})
