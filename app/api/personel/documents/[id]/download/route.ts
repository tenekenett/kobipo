import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const doc = await prisma.employeeDocument.findUnique({
    where: { id },
    include: { blob: true },
  })
  if (!doc) return NextResponse.json({ error: "Belge bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(doc.companyId)

  // Veritabanında saklanan dosya → baytları doğrudan servis et.
  // GÜVENLİK: mimeType yükleyen tarafından kontrol edilir (upload'taki uzantı allowlist'i
  // bunu KAPATMAZ — mimeType uzantıdan bağımsız saklanır). text/html, image/svg+xml gibi
  // tipler app origin'inde script çalıştırabilir → stored XSS (başka kullanıcının oturumu).
  // Bu yüzden yalnızca script ÇALIŞTIRMAYAN "güvenli" tipleri inline (önizleme) servis eder,
  // gerisini octet-stream + attachment ile İNDİRTİRİZ. nosniff ile MIME tahmini de kapanır.
  if (doc.blob) {
    const SAFE_INLINE = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "text/plain",
    ])
    const declared = (doc.mimeType || "").split(";")[0].trim().toLowerCase()
    const inlineOk = SAFE_INLINE.has(declared)
    const body = Buffer.from(doc.blob.data)
    const filename = encodeURIComponent(doc.fileName || "dosya")
    return new NextResponse(body, {
      headers: {
        "Content-Type": inlineOk ? declared : "application/octet-stream",
        "Content-Disposition": `${inlineOk ? "inline" : "attachment"}; filename="${filename}"`,
        "Content-Length": String(body.length),
        "X-Content-Type-Options": "nosniff",
      },
    })
  }

  // Harici bağlantı → yönlendir.
  if (doc.fileUrl) {
    return NextResponse.redirect(doc.fileUrl)
  }

  return NextResponse.json({ error: "Bu belgeye ekli dosya yok" }, { status: 404 })
}
