import { withApiErrors } from "@/lib/api/errors"
import { handleFaturaImport } from "@/lib/faturalar/ice-aktar-handler"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Satış ve ihracat faturalarını Kobipo şablonundan içe aktarır (gövdede
 * `tur: "satis" | "ihracat"`). Faturalar onaylı MANUAL kayıt olarak açılır; GİB'e
 * gönderilmez. Gövde ve kurallar: lib/faturalar/ice-aktar-handler.ts.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  return handleFaturaImport(request, ["satis", "ihracat"])
})
