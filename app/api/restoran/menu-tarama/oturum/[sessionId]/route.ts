/**
 * Menü tarama OTURUMU — aynı `sessionId`li document_scans satırları.
 *
 *   GET   → oturumun dosyaları + tekilleştirilmiş kalemler + oturum denetimleri +
 *           FARK LİSTESİ (mevcut ürünlerle o anki eşleşme) + hedef izleri.
 *           Fark listesi her okumada yeniden kurulur: ürünler değişmiş olabilir.
 *   PATCH → reddet | hedef (i. satır şu ürüne dönüştü) | tamamla (SAVED).
 *           KAYDETMEZ — ürün /api/stok/products'a, seçenek grubu
 *           /api/restoran/urun-secenekleri'ne gider; burası yalnız izi yazar.
 *
 * Hedef izleri oturumun BAŞ satırında durur (kayit.ts → oturumBasi).
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { prisma } from "@/lib/db/prisma"
import { cikarimOku, hedefleriOku, oturumBasi, oturumDosyalari, oturumDurumu, oturumSirala, type MenuSatiri } from "@/lib/menu-ocr/kayit"
import { oturumBirlestir } from "@/lib/menu-ocr/tekillestir"
import { menuyeBenziyorMu, oturumDenetle } from "@/lib/menu-ocr/validate"
import { farkListesiKur, kovaSay } from "@/lib/menu-ocr/eslestir"
import { mevcutUrunler } from "@/lib/menu-ocr/urunler"
import { kdvOraniOku, VARSAYILAN_KDV } from "@/lib/menu-ocr/fiyat"
import type { MenuHedefi } from "@/lib/menu-ocr/turler"

export const dynamic = "force-dynamic"

const HEDEF_TURLERI = new Set(["PRODUCT", "OPTION_GROUP", "PRICE", "UNLISTED"])

async function oturumSatirlari(companyId: string, sessionId: string): Promise<MenuSatiri[]> {
  return prisma.documentScan.findMany({
    where: { companyId, kind: "MENU", sessionId },
    select: { id: true, sessionId: true, fileName: true, pageCount: true, status: true, extraction: true, targets: true, error: true, costUsd: true, createdAt: true, updatedAt: true },
  })
}

export const GET = withApiErrors(async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sessionId } = await params
    const sp = new URL(request.url).searchParams
    const companyId = await resolveCompanyId(sp.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const satirlar = oturumSirala(await oturumSatirlari(companyId, sessionId))
    if (satirlar.length === 0) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 404 })
    const bas = oturumBasi(satirlar)!
    const ayar = cikarimOku(bas.extraction)
    // Ekrandan oran değiştirilebilir (kalıcı ayar yok, plan §3.5); yoksa oturumun kendi oranı.
    // `Number(null)` 0'dır ve 0 GEÇERLİ bir orandır: param yokken "%0" seçilmiş
    // sayılıyordu, tüm yeni ürünler net=brüt yazılıyordu (uçtan uca testte yakalandı).
    const oturumKdv = kdvOraniOku(sp.get("kdv")) ?? ayar?.varsayilanKdv ?? VARSAYILAN_KDV
    const tamMenu = sp.has("tamami") ? sp.get("tamami") === "1" : ayar?.tamMenu ?? false

    const birlesim = oturumBirlestir(oturumDosyalari(satirlar))
    const denetimler = oturumDenetle(birlesim)
    const urunler = await mevcutUrunler(companyId)
    const fark = menuyeBenziyorMu(birlesim) ? farkListesiKur(birlesim.kalemler, urunler, { oturumKdv, tamMenu }) : []
    const hedefler = hedefleriOku(bas.targets)

    return NextResponse.json({
      sessionId,
      status: oturumDurumu(satirlar),
      dosyalar: satirlar.map((s) => ({ id: s.id, fileName: s.fileName, status: s.status, error: s.error, pageCount: s.pageCount, costUsd: s.costUsd == null ? null : Number(s.costUsd) })),
      oturumKdv,
      tamMenu,
      menuyeBenziyor: menuyeBenziyorMu(birlesim),
      bolumler: birlesim.bolumler,
      kalemler: birlesim.kalemler,
      denetimler,
      fark,
      kovalar: kovaSay(fark),
      hedefler,
      createdAt: bas.createdAt.toISOString(),
    })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) return accessDeniedResponse(error, error.message)
    throw error
  }
})

export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sessionId } = await params
    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(typeof body?.companyId === "string" ? body.companyId : null)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const satirlar = await oturumSatirlari(companyId, sessionId)
    if (satirlar.length === 0) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 404 })
    const bas = oturumBasi(satirlar)!
    const action = String(body?.action ?? "")

    if (action === "reddet") {
      if (satirlar.some((s) => s.status === "SAVED")) return NextResponse.json({ error: "Kaydedilmiş oturum reddedilemez" }, { status: 400 })
      await prisma.documentScan.updateMany({ where: { companyId, kind: "MENU", sessionId }, data: { status: "REJECTED" } })
      return NextResponse.json({ ok: true, status: "REJECTED" })
    }

    if (action === "hedef") {
      const anahtar = String(body?.anahtar ?? "").trim()
      const type = String(body?.type ?? "")
      const id = String(body?.id ?? "").trim()
      if (!anahtar || !HEDEF_TURLERI.has(type) || !id) return NextResponse.json({ error: "anahtar, type ve id zorunlu" }, { status: 400 })
      const mevcut = hedefleriOku(bas.targets)
      // Aynı satır aynı türle ikinci kez bağlanamaz: ekran bir kez "yazıldı" der,
      // ikinci kayıt mükerrer ürün doğururdu.
      if (mevcut.some((h) => h.anahtar === anahtar && h.type === type && !h.geriAlma)) {
        return NextResponse.json({ error: "Bu satır zaten kaydedilmiş" }, { status: 409 })
      }
      const hedef: MenuHedefi = { anahtar, type: type as MenuHedefi["type"], id, no: body?.no ? String(body.no) : null, at: new Date().toISOString() }
      await prisma.documentScan.update({ where: { id: bas.id }, data: { targets: [...mevcut, hedef] as unknown as Prisma.InputJsonValue } })
      return NextResponse.json({ ok: true, hedef })
    }

    if (action === "tamamla") {
      // Onay turu bitti: okunmuş satırlar SAVED. FAILED satır dokunulmaz (zaten kalem taşımıyor).
      await prisma.documentScan.updateMany({
        where: { companyId, kind: "MENU", sessionId, status: "AWAITING_APPROVAL" },
        data: { status: "SAVED" },
      })
      return NextResponse.json({ ok: true, status: "SAVED" })
    }

    return NextResponse.json({ error: "action: reddet | hedef | tamamla" }, { status: 400 })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) return accessDeniedResponse(error, error.message)
    throw error
  }
})
