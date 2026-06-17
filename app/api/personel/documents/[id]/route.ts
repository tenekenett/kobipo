import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.employeeDocument.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Belge bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(existing.companyId)

  // Belgeyi sil — bağlı blob (dosya içeriği) FK onDelete: Cascade ile gider.
  await prisma.employeeDocument.delete({ where: { id } })
  return NextResponse.json({ message: "Belge silindi" })
}
