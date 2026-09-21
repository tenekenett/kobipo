/**
 * Menü tarama ucu — gelen kutusu (docs/menu-tarama/PLAN.md §3.10–3.12).
 *
 *   POST → menünün BİR dosyasını (foto / PDF) boru hattından geçirir, sonucu
 *          document_scans satırına (kind=MENU) yazar. Çok dosyalı menü: istemci
 *          aynı `sessionId` ile ardışık POST atar; ilk istekte id sunucudan gelir.
 *   GET  → firmanın menü oturumları (dosyalar sessionId'de toplanır).
 *
 * ÜRÜN BURADA YAZILMAZ: onay ekranı /api/stok/products ve
 * /api/restoran/urun-secenekleri'ne gider (plan §2 madde 3).
 *
 * POST üç kapıdan geçer: yazma yetkisi + Restoran modülü + MENU_TARAMA_COMPANIES
 * beyaz listesi; sayfa sayacı modelden ÖNCE artar. Dosya SAKLANMAZ.
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { menuTaramaAcikMi } from "@/lib/menu-ocr/access"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import { ensureUsageLimit } from "@/lib/middleware/usage"
import { prisma } from "@/lib/db/prisma"
import { createHash } from "node:crypto"
import { MAX_SAYFA, menuTara, TaramaHatasi } from "@/lib/menu-ocr/boru"
import { menuSonucunuSatiraCevir, oturumOzetleri } from "@/lib/menu-ocr/kayit"
import { kdvOraniOku, VARSAYILAN_KDV } from "@/lib/menu-ocr/fiyat"

export const dynamic = "force-dynamic"
// Sayfa başına çağrı, 3 eşzamanlı: 10 sayfa ~4 tur × ~8 sn. Tavan 60.
export const maxDuration = 60

const MAX_BOYUT = 15 * 1024 * 1024
const IZINLI_TUR = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "application/pdf"]

/** Sayaç birimi SAYFA; belge taramadan AYRI anahtar (plan §3.12). */
export const SAYAC_ANAHTARI = "menu_tarama_sayfa_monthly"

const OTURUM_SELECT = {
  id: true,
  sessionId: true,
  fileName: true,
  pageCount: true,
  status: true,
  extraction: true,
  targets: true,
  error: true,
  costUsd: true,
  createdAt: true,
  updatedAt: true,
} as const

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  assertRestaurantModule(await ensureCompanyAccess(companyId))

  // Zaman aşımına düşen okuma READING'de asılı kalmasın (belge taramadaki kural).
  await prisma.documentScan.updateMany({
    where: { companyId, kind: "MENU", status: "READING", createdAt: { lt: new Date(Date.now() - 3 * 60 * 1000) } },
    data: { status: "FAILED", error: "Zaman aşımı: okuma 60 sn içinde bitmedi. Dosyayı yeniden yükleyin (büyükse bölün)." },
  })

  const rows = await prisma.documentScan.findMany({
    where: { companyId, kind: "MENU" },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: OTURUM_SELECT,
  })
  return NextResponse.json(oturumOzetleri(rows))
})

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const fd = await request.formData().catch(() => null)
    if (!fd) return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 })

    const rawCompany = fd.get("companyId")
    const companyId = await resolveCompanyId(typeof rawCompany === "string" ? rawCompany : null)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    assertRestaurantModule(await ensureCompanyWrite(companyId))

    // ASIL KAPI: parayı harcayan yer burası; menü gizlemesi kozmetik.
    const firma = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, slug: true } })
    if (!firma) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    if (!menuTaramaAcikMi(firma)) {
      return NextResponse.json({ error: "Menü tarama bu firma için açık değil" }, { status: 403 })
    }

    const dosya = fd.get("file")
    if (!dosya || typeof dosya === "string" || dosya.size === 0) {
      return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 })
    }
    if (dosya.size > MAX_BOYUT) return NextResponse.json({ error: "Dosya 15 MB sınırını aşıyor" }, { status: 400 })
    if (dosya.type && !IZINLI_TUR.includes(dosya.type)) {
      return NextResponse.json({ error: `Desteklenmeyen dosya türü: ${dosya.type}` }, { status: 400 })
    }

    // Oturum ayarları: KDV oranı ve "tamamı mı" (karar B, H). Var olan oturuma
    // eklenen dosya baş satırın ayarını değiştirmez — oturum GET'i baştan okur.
    const sessionHam = fd.get("sessionId")
    const sessionId = typeof sessionHam === "string" && /^[a-z0-9-]{8,64}$/i.test(sessionHam) ? sessionHam : randomUUID()
    // Param yoksa varsayılan; `Number(null)` 0 olduğu için doğrudan Number() kullanılmaz.
    const varsayilanKdv = kdvOraniOku(fd.get("kdv")) ?? VARSAYILAN_KDV
    const tamMenu = fd.get("tamami") === "1"

    const buf = Buffer.from(await dosya.arrayBuffer())
    const sha256 = createHash("sha256").update(buf).digest("hex")

    // Aynı dosya daha önce okunduysa yeniden para harcama. `force=1` ile yine de okunur.
    if (fd.get("force") !== "1") {
      const onceki = await prisma.documentScan.findFirst({
        where: { companyId, kind: "MENU", fileSha256: sha256, status: { in: ["AWAITING_APPROVAL", "SAVED"] } },
        select: { id: true, sessionId: true, status: true, createdAt: true, fileName: true },
        orderBy: { createdAt: "desc" },
      })
      if (onceki) {
        return NextResponse.json(
          {
            error: onceki.status === "SAVED" ? "Bu dosya daha önce okunup kaydedilmiş." : "Bu dosya daha önce okunmuş ve onay bekliyor.",
            code: "DUPLICATE_FILE",
            onceki,
          },
          { status: 409 }
        )
      }
    }

    // Sayfa sayısı okumadan önce sayılır ki sayaç GERÇEK sayfayı düşsün.
    let sayfa = 1
    const pdfMi = buf.subarray(0, 5).toString("latin1").startsWith("%PDF")
    if (pdfMi) {
      try {
        const { getDocumentProxy } = await import("unpdf")
        sayfa = (await getDocumentProxy(new Uint8Array(buf))).numPages || 1
      } catch {
        return NextResponse.json({ error: "PDF açılamadı (bozuk ya da şifreli olabilir)" }, { status: 400 })
      }
      if (sayfa > MAX_SAYFA) {
        return NextResponse.json({ error: `PDF ${sayfa} sayfa; tek seferde en çok ${MAX_SAYFA} sayfa okunur. Dosyayı bölün.` }, { status: 400 })
      }
    }

    // Sayaç MODELİ ÇAĞIRMADAN ÖNCE artar: sağlayıcı hata verirse bedava sayılmış
    // olur; tersi tavanı hiç görmemek demekti.
    try {
      await ensureUsageLimit(companyId, SAYAC_ANAHTARI, sayfa)
    } catch {
      return NextResponse.json({ error: "Bu ay için menü tarama sayfa sınırına ulaşıldı. Destek ile iletişime geçin." }, { status: 429 })
    }

    const istenenModel = fd.get("model")
    const model = typeof istenenModel === "string" && DENENEBILIR_MODELLER.some((m) => m.id === istenenModel) ? istenenModel : undefined

    // Satır ÖNCE açılır (READING): sonuç ve hata aynı satıra yazılır.
    const satir = await prisma.documentScan.create({
      data: {
        companyId,
        kind: "MENU",
        sessionId,
        fileName: dosya.name || "menu",
        mimeType: dosya.type || (pdfMi ? "application/pdf" : "application/octet-stream"),
        pageCount: sayfa,
        fileSha256: sha256,
        status: "READING",
        createdBy: user.id,
      },
      select: { id: true },
    })

    try {
      const sonuc = await menuTara(buf, { mime: dosya.type || "", ad: dosya.name || "" }, { model })
      const cikarim = menuSonucunuSatiraCevir(sonuc, { varsayilanKdv, tamMenu })
      const guncel = await prisma.documentScan.update({
        where: { id: satir.id },
        data: {
          status: "AWAITING_APPROVAL",
          pageCount: sonuc.sayfaSayisi,
          extraction: cikarim as unknown as Prisma.InputJsonValue,
          model: sonuc.model,
          costUsd: sonuc.kullanim.maliyetUsd != null ? new Prisma.Decimal(sonuc.kullanim.maliyetUsd) : null,
          durationMs: sonuc.sureMs,
        },
        select: { id: true, sessionId: true, fileName: true, pageCount: true, status: true, costUsd: true, durationMs: true, model: true },
      })
      const kalem = sonuc.sayfalar.reduce((a, s) => a + s.kalemler.length, 0)
      return NextResponse.json({ ...guncel, costUsd: guncel.costUsd == null ? null : Number(guncel.costUsd), kalem, yol: sonuc.yol })
    } catch (e: any) {
      const mesaj = e instanceof TaramaHatasi ? e.message : e?.message || "Menü okunamadı"
      await prisma.documentScan.update({ where: { id: satir.id }, data: { status: "FAILED", error: mesaj } })
      if (e instanceof TaramaHatasi) {
        return NextResponse.json({ error: mesaj, hamYanit: e.hamYanit?.slice(0, 4000), scanId: satir.id, sessionId }, { status: 502 })
      }
      console.error("Menü tarama hatası:", e)
      return NextResponse.json({ error: mesaj, scanId: satir.id, sessionId }, { status: 500 })
    }
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    throw error
  }
})
