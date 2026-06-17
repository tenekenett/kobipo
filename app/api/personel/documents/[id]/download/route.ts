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
  if (doc.blob) {
    const body = Buffer.from(doc.blob.data)
    return new NextResponse(body, {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName || "dosya")}"`,
        "Content-Length": String(body.length),
      },
    })
  }

  // Harici bağlantı → yönlendir.
  if (doc.fileUrl) {
    return NextResponse.redirect(doc.fileUrl)
  }

  return NextResponse.json({ error: "Bu belgeye ekli dosya yok" }, { status: 404 })
}
