/**
 * Ürün fotoğrafı yükleme ucu — dosyayı nesne deposuna koyar ve URL'ini döner.
 *
 * Ürün kaydından AYRI durur: fotoğraf hem yeni ürün diyaloğunda (ürünün henüz
 * id'si yokken) hem mevcut üründe seçilebiliyor. İki akış da önce buraya yükler,
 * dönen URL'i sonra ürüne yazar (POST /api/stok/products ya da PATCH .../[id]).
 *
 * Yol `/products/image`; `[id]` ile çakışmaz — Next.js statik segmenti dinamik
 * olana tercih eder ve "image" zaten geçerli bir ürün id'si değildir.
 *
 * Dosya buraya gelmeden ÖNCE istemcide kırpılıp WebP'ye çevriliyor
 * (components/stok/image-crop-dialog.tsx) — bu uç yine de tek başına savunmalı:
 * doğrudan çağrılabilir.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { productImageStore } from "@/lib/storage/object-store"
import { sanitizeFileName } from "@/lib/storage/supabase-storage"

export const dynamic = "force-dynamic"

/**
 * İstemci ~30 KB gönderiyor; sınır yalnızca dönüştürmenin atlandığı durumlar
 * için (eski tarayıcı fallback'i, doğrudan API çağrısı) bir tavan.
 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB

/**
 * İzin verilen türler DAR tutuldu. Depo public ve nesne, yüklerken verdiğimiz
 * content-type ile servis ediliyor; SVG kabul etmek kendi alan adımızdan script
 * sunmak (depolanmış XSS) demekti. Animasyonlu GIF de yok: satış ızgarasındaki
 * 30 kart aynı anda oynayacaktı.
 *
 * JPEG listede çünkü istemci WebP kodlayamayan tarayıcıda ona düşüyor.
 */
const ALLOWED_MIME = ["image/webp", "image/jpeg", "image/png", "image/avif"]

const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/avif": "avif",
}

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const fd = await request.formData().catch(() => null)
    if (!fd) {
      return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 })
    }

    const rawCompany = fd.get("companyId")
    const companyId = await resolveCompanyId(
      typeof rawCompany === "string" ? rawCompany : null
    )
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    await ensureCompanyWrite(companyId)

    const file = fd.get("file")
    if (!file || typeof file === "string" || file.size === 0) {
      return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 })
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: "Görsel 5 MB sınırını aşıyor — daha küçük bir fotoğraf seçin" },
        { status: 400 }
      )
    }
    // Tür BOŞ da olsa reddedilir (blog ucundan farkı): oradaki yükleyici blog
    // editörüyken burası firmadaki her yazma yetkilisi. Tanımadığımız bir türü
    // public depoya koymuyoruz.
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Desteklenmeyen görsel türü${file.type ? `: ${file.type}` : ""} — WebP, JPEG, PNG veya AVIF olmalı`,
        },
        { status: 400 }
      )
    }

    // Yol firmayla başlar: depoya bakan biri hangi nesnenin kime ait olduğunu
    // görebilsin, bir firmanın fotoğrafları topluca temizlenebilsin.
    const base = sanitizeFileName(file.name || "urun").replace(/\.[^.]+$/, "")
    const path = `${companyId}/${Date.now()}-${base}.${EXT_BY_MIME[file.type]}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const url = await productImageStore().put(path, buffer, file.type)
    return NextResponse.json({ url }, { status: 201 })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error uploading product image:", error)
    return NextResponse.json({ error: error?.message || "Görsel yüklenemedi" }, { status: 500 })
  }
})
