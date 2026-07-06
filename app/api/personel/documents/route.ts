import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "webp", "gif", "txt", "csv"]

function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_")
  return base.length > 0 ? base.slice(-120) : "dosya"
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const employeeId = searchParams.get("employeeId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (employeeId) where.employeeId = employeeId

  // Dosya baytları (blob) DAHİL EDİLMEZ — liste hafif kalsın.
  const documents = await prisma.employeeDocument.findMany({
    where,
    select: {
      id: true, title: true, category: true, fileUrl: true, fileName: true,
      mimeType: true, fileSize: true, notes: true, createdAt: true,
      employee: { select: { id: true, firstName: true, lastName: true, department: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(documents)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const contentType = request.headers.get("content-type") || ""

  let companyId = ""
  let employeeId = ""
  let title = ""
  let category: string | null = null
  let notes: string | null = null
  let externalUrl: string | null = null
  let files: File[] = []

  if (contentType.includes("multipart/form-data")) {
    const fd = await request.formData()
    companyId = String(fd.get("companyId") || "")
    employeeId = String(fd.get("employeeId") || "")
    title = String(fd.get("title") || "")
    category = (fd.get("category") as string) || null
    notes = (fd.get("notes") as string) || null
    externalUrl = (fd.get("fileUrl") as string) || null
    // Çoklu dosya: aynı "file" alanından hepsini al.
    files = fd.getAll("file").filter((f): f is File => typeof f !== "string" && (f as File).size > 0)
  } else {
    const body = await request.json().catch(() => ({}))
    companyId = body.companyId || ""
    employeeId = body.employeeId || ""
    title = body.title || ""
    category = body.category || null
    notes = body.notes || null
    externalUrl = body.fileUrl || null
  }

  // companyId dashboard'dan slug gelebilir → cuid'e çevir (GET zaten çeviriyor). [[resolve-company.ts]]
  companyId = (await resolveCompanyId(companyId)) ?? companyId

  // Dosya yoksa başlık zorunlu; dosya varsa başlık dosya adından türetilebilir.
  if (!companyId || !employeeId) {
    return NextResponse.json({ error: "companyId ve employeeId zorunlu" }, { status: 400 })
  }
  if (files.length === 0 && !title.trim()) {
    return NextResponse.json({ error: "Belge başlığı veya en az bir dosya gerekli" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
  if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })

  const baseTitle = title.trim()
  const docSelect = {
    id: true, title: true, category: true, fileUrl: true, fileName: true,
    mimeType: true, fileSize: true, notes: true, createdAt: true,
    employee: { select: { id: true, firstName: true, lastName: true, department: true } },
  } as const

  // --- Dosyasız (yalnızca harici URL / başlık) ---
  if (files.length === 0) {
    const doc = await prisma.employeeDocument.create({
      data: {
        companyId, employeeId,
        title: baseTitle,
        category: category || null,
        fileUrl: externalUrl || null,
        notes: notes || null,
        createdBy: user.id,
      },
      select: docSelect,
    })
    return NextResponse.json([doc], { status: 201 })
  }

  // --- Çoklu dosya: her dosya ayrı bir belge ---
  const created = []
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `"${file.name}" 10 MB sınırını aşıyor` }, { status: 400 })
    }
    const safeName = sanitizeFileName(file.name || "dosya")
    const ext = safeName.includes(".") ? safeName.split(".").pop()!.toLowerCase() : ""
    if (ext && !ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: `Desteklenmeyen dosya türü: .${ext}` }, { status: 400 })
    }
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileBase = safeName.replace(/\.[^.]+$/, "")
    // Tek dosyada verilen başlığı kullan; çoklu dosyada dosya adını başlık yap.
    const docTitle = files.length === 1 ? (baseTitle || fileBase) : (baseTitle ? `${baseTitle} - ${fileBase}` : fileBase)

    const doc = await prisma.employeeDocument.create({
      data: {
        companyId, employeeId,
        title: docTitle,
        category: category || null,
        fileUrl: null,
        fileName: safeName,
        mimeType: file.type || null,
        fileSize: file.size,
        notes: notes || null,
        createdBy: user.id,
        blob: { create: { data: fileBuffer } },
      },
      select: docSelect,
    })
    created.push(doc)
  }

  return NextResponse.json(created, { status: 201 })
}
