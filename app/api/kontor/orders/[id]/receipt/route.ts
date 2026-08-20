import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Havale dekontu — yükleme (POST) ve görüntüleme (GET).
 *
 * Akış: müşteri sipariş açar → `paymentCode`'u banka açıklamasına yazıp parayı
 * gönderir → dekontu buraya yükler (sipariş PAYMENT_REVIEW olur) → sistem-admin
 * panelde dekontu görüp "Onayla & Yükle" der ([[app/api/kontor/orders/[id]/confirm]]).
 *
 * Dosya baytları ayrı tabloda ([[KontorOrderReceipt]]): sipariş listeleri her satırda
 * blob taşımamalı. Dekont ÖZEL veridir — public bucket'a değil DB'ye yazılır, GET
 * yetki kontrolünden geçer.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg", "webp"]
const MAX_NOTE_LENGTH = 500

function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_")
  return base.length > 0 ? base.slice(-120) : "dekont"
}

export const POST = withApiErrors(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const order = await prisma.kontorOrder.findUnique({ where: { id } })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })

    await ensureCompanyAccess(order.companyId)

    if (order.paymentMethod !== "HAVALE") {
      return NextResponse.json({ error: "Bu sipariş havale ödemesi değil" }, { status: 400 })
    }
    // Onaylanmış/kapanmış siparişe dekont eklenmez; PAYMENT_REVIEW'da tekrar yükleme
    // serbest (yanlış dosya seçen müşteri düzeltebilsin).
    if (order.status !== "PENDING_PAYMENT" && order.status !== "PAYMENT_REVIEW") {
      return NextResponse.json(
        { error: "Bu siparişe artık dekont yüklenemez" },
        { status: 409 },
      )
    }

    const contentType = request.headers.get("content-type") || ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Dekont dosyası gerekli" }, { status: 400 })
    }

    const fd = await request.formData()
    const file = fd.get("file")
    const note = String(fd.get("note") || "").trim().slice(0, MAX_NOTE_LENGTH)

    if (typeof file === "string" || !file || file.size === 0) {
      return NextResponse.json({ error: "Dekont dosyası gerekli" }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Dekont 10 MB sınırını aşıyor" }, { status: 400 })
    }
    const safeName = sanitizeFileName(file.name || "dekont")
    const ext = safeName.includes(".") ? safeName.split(".").pop()!.toLowerCase() : ""
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { error: `Desteklenmeyen dosya türü. PDF veya görsel yükleyin (${ALLOWED_EXT.join(", ")})` },
        { status: 400 },
      )
    }

    const data = Buffer.from(await file.arrayBuffer())

    // Tek dekont saklanır: tekrar yükleme öncekini değiştirir (upsert).
    const updated = await prisma.$transaction(async (tx) => {
      await tx.kontorOrderReceipt.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, data },
        update: { data },
      })
      return tx.kontorOrder.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_REVIEW",
          paymentNote: note || null,
          receiptFileName: safeName,
          receiptMimeType: file.type || null,
          receiptFileSize: file.size,
          receiptUploadedAt: new Date(),
        },
      })
    })

    // Sistem-admin'in "onay bekliyor" kuyruğuna düşen kayıt burada iz bırakır.
    await prisma.systemLog.create({
      data: {
        userId: user.id,
        action: "KONTOR_RECEIPT_UPLOAD",
        entity: "KontorOrder",
        details:
          `Sipariş ${order.id} (kod ${order.paymentCode ?? "-"}): dekont yüklendi ` +
          `(${safeName}, ${Math.round(file.size / 1024)} KB) → onay bekliyor`,
        level: "INFO",
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("kontor receipt POST error:", error)
    return NextResponse.json({ error: message || "Dekont yüklenemedi" }, { status: 500 })
  }
})

/**
 * Dekontu servis eder. Sistem-admin her siparişin dekontunu görebilir; firma
 * kullanıcısı yalnız kendi firmasınınkini.
 */
export const GET = withApiErrors(async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const order = await prisma.kontorOrder.findUnique({
      where: { id },
      include: { receipt: true },
    })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })

    const admin = await requireSuperAdmin()
    if ("error" in admin) await ensureCompanyAccess(order.companyId)

    if (!order.receipt) {
      return NextResponse.json({ error: "Bu siparişte dekont yok" }, { status: 404 })
    }

    // GÜVENLİK: mimeType'ı yükleyen belirler. text/html, image/svg+xml gibi tipler app
    // origin'inde script çalıştırabilir → stored XSS. Yalnız script ÇALIŞTIRMAYAN tipler
    // inline (önizleme) servis edilir, gerisi octet-stream + attachment ile indirilir.
    // nosniff ile MIME tahmini de kapanır. ([[app/api/personel/documents/[id]/download]])
    const SAFE_INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"])
    const declared = (order.receiptMimeType || "").split(";")[0].trim().toLowerCase()
    const inlineOk = SAFE_INLINE.has(declared)
    const body = Buffer.from(order.receipt.data)
    const filename = encodeURIComponent(order.receiptFileName || "dekont")

    return new NextResponse(body, {
      headers: {
        "Content-Type": inlineOk ? declared : "application/octet-stream",
        "Content-Disposition": `${inlineOk ? "inline" : "attachment"}; filename="${filename}"`,
        "Content-Length": String(body.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("kontor receipt GET error:", error)
    return NextResponse.json({ error: message || "Dekont okunamadı" }, { status: 500 })
  }
})
