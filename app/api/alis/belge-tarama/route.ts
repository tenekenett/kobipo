/**
 * Belge tarama ucu — gelen kutusu.
 *
 *   POST → dosyayı (foto / PDF / UBL XML) boru hattından geçirir, sonucu
 *          document_scans satırına yazar, satırı döner.
 *   GET  → firmanın gelen kutusu (özet liste).
 *
 * KAYIT BURADA YAPILMAZ: onay kartı her türün kendi ucuna gider (fatura →
 * /api/e-donusum/invoices, irsaliye → /api/irsaliye, ödeme →
 * /api/finans/transactions (tek hareket + fatura dağıtımı), çek/senet →
 * /api/cek-senet). Bkz. plan §2.
 *
 * POST yazma yetkisi + beyaz liste + sayfa sayacı arıyor (fişteki üçlü): her
 * çağrı PARA HARCIYOR. Dosya SAKLANMAZ; `fileSha256` mükerrer izidir.
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { fisTaramaAcikMi } from "@/lib/fis-ocr/access"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import { ensureUsageLimit } from "@/lib/middleware/usage"
import { prisma } from "@/lib/db/prisma"
import { createHash } from "node:crypto"
import { belgeTara, MAX_SAYFA, TaramaHatasi } from "@/lib/belge-ocr/boru"
import { turNormalize } from "@/lib/belge-ocr/sinif/normalize"
import { taramaOzeti, taramaSonucunuSatiraCevir } from "@/lib/belge-ocr/kayit"

export const dynamic = "force-dynamic"
// Sınıf + tür çıkarımı: 10 sayfalık PDF'te 30-40 sn ölçüldü; tavan 60.
export const maxDuration = 60

const MAX_BOYUT = 15 * 1024 * 1024
const IZINLI_TUR = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "application/pdf",
  "text/xml",
  "application/xml",
]

/** Sayaç birimi SAYFA (plan §3.11). Anahtar fişinkinden ayrı; Faz 3'te birleşir. */
export const SAYAC_ANAHTARI = "belge_tarama_sayfa_monthly"

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  // İstek 60 sn'de bitmediyse satır READING'de asılı kalır (sonucu yazacak
  // kimse yok). Kutu "okunuyor" diye yalan söylemesin: 3 dk'dan eski READING
  // satırları FAILED'e çekilir, sebep yazılır; kullanıcı dosyayı yeniden yükler.
  await prisma.documentScan.updateMany({
    where: { companyId, kind: "BELGE", status: "READING", createdAt: { lt: new Date(Date.now() - 3 * 60 * 1000) } },
    data: { status: "FAILED", error: "Zaman aşımı: okuma 60 sn içinde bitmedi. Dosyayı yeniden yükleyin (büyükse bölün)." },
  })

  const durum = sp.get("status")
  // kind süzgeci: menü taramaları (lib/menu-ocr) aynı tabloda; süzülmezse
  // kafenin menüsü alış gelen kutusunda "Diğer" diye görünür.
  const rows = await prisma.documentScan.findMany({
    where: { companyId, kind: "BELGE", ...(durum ? { status: durum } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      pageCount: true,
      status: true,
      classification: true,
      targets: true,
      error: true,
      costUsd: true,
      durationMs: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json(rows.map(taramaOzeti))
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
    await ensureCompanyWrite(companyId)

    // ASIL KAPI: parayı harcayan yer burası; menü gizlemesi kozmetik.
    const firma = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        slug: true,
        name: true,
        taxNumber: true,
        parentCompany: { select: { taxNumber: true } },
        financialAccounts: { where: { iban: { not: null } }, select: { iban: true } },
      },
    })
    if (!firma) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    if (!fisTaramaAcikMi(firma)) {
      return NextResponse.json({ error: "Belge tarama bu firma için açık değil" }, { status: 403 })
    }

    const dosya = fd.get("file")
    if (!dosya || typeof dosya === "string" || dosya.size === 0) {
      return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 })
    }
    if (dosya.size > MAX_BOYUT) {
      return NextResponse.json({ error: "Dosya 15 MB sınırını aşıyor" }, { status: 400 })
    }
    if (dosya.type && !IZINLI_TUR.includes(dosya.type)) {
      return NextResponse.json({ error: `Desteklenmeyen dosya türü: ${dosya.type}` }, { status: 400 })
    }
    const buf = Buffer.from(await dosya.arrayBuffer())
    const sha256 = createHash("sha256").update(buf).digest("hex")

    // Aynı dosya daha önce okunduysa yeniden para harcama: mevcut satırı işaret
    // et. `force=1` ile yine de okunur (tür değiştirme, yeniden deneme).
    const force = fd.get("force") === "1"
    const zorlaTurHam = fd.get("tur")
    const zorlaTur = typeof zorlaTurHam === "string" && zorlaTurHam ? turNormalize(zorlaTurHam) : null
    if (!force) {
      const onceki = await prisma.documentScan.findFirst({
        where: { companyId, kind: "BELGE", fileSha256: sha256, status: { in: ["AWAITING_APPROVAL", "SAVED"] } },
        select: { id: true, status: true, createdAt: true, fileName: true },
        orderBy: { createdAt: "desc" },
      })
      if (onceki) {
        return NextResponse.json(
          {
            error:
              onceki.status === "SAVED"
                ? "Bu dosya daha önce okunup kaydedilmiş."
                : "Bu dosya daha önce okunmuş ve onay bekliyor.",
            code: "DUPLICATE_FILE",
            onceki,
          },
          { status: 409 }
        )
      }
    }

    // Sayfa sayısı: PDF'te okumadan önce sayılır ki sayaç GERÇEK sayfayı düşsün.
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
        return NextResponse.json(
          { error: `PDF ${sayfa} sayfa; tek seferde en çok ${MAX_SAYFA} sayfa okunur. Dosyayı bölün.` },
          { status: 400 }
        )
      }
    }

    // Sayaç MODELİ ÇAĞIRMADAN ÖNCE artar (fişteki gerekçe): sağlayıcı hata
    // verirse bedava sayılmış olur; tersi tavanı hiç görmemek demekti.
    try {
      await ensureUsageLimit(companyId, SAYAC_ANAHTARI, sayfa)
    } catch {
      return NextResponse.json(
        { error: "Bu ay için belge tarama sayfa sınırına ulaşıldı. Destek ile iletişime geçin." },
        { status: 429 }
      )
    }

    const istenenModel = fd.get("model")
    const model =
      typeof istenenModel === "string" && DENENEBILIR_MODELLER.some((m) => m.id === istenenModel)
        ? istenenModel
        : undefined

    // Satır ÖNCE açılır (READING): sonuç ve hata aynı satıra yazılır. İstek zaman
    // aşımına düşerse satır READING'de kalır; GET listesi 3 dk sonra FAILED'e çeker.
    const satir = await prisma.documentScan.create({
      data: {
        companyId,
        fileName: dosya.name || "belge",
        mimeType: dosya.type || (pdfMi ? "application/pdf" : "application/octet-stream"),
        pageCount: sayfa,
        fileSha256: sha256,
        status: "READING",
        createdBy: user.id,
      },
      select: { id: true },
    })

    try {
      const sonuc = await belgeTara(
        buf,
        { mime: dosya.type || "", ad: dosya.name || "" },
        {
          // Şube ana firmanın VKN'siyle çalışır (CLAUDE.md): belge o VKN'ye kesilir.
          firma: { vkn: firma.parentCompany?.taxNumber || firma.taxNumber, unvan: firma.name },
          bizimIbanlar: firma.financialAccounts.map((a) => a.iban!).filter(Boolean),
          model,
          zorlaTur: zorlaTur && zorlaTur !== "DIGER" ? zorlaTur : undefined,
        }
      )
      const veri = taramaSonucunuSatiraCevir(sonuc, {
        vkn: firma.parentCompany?.taxNumber || firma.taxNumber || null,
        unvan: firma.name,
      })
      const guncel = await prisma.documentScan.update({
        where: { id: satir.id },
        data: {
          status: "AWAITING_APPROVAL",
          pageCount: sonuc.sayfaSayisi,
          classification: veri.classification as Prisma.InputJsonValue,
          extraction: veri.extraction as Prisma.InputJsonValue,
          model: sonuc.model,
          costUsd: sonuc.kullanim.maliyetUsd != null ? new Prisma.Decimal(sonuc.kullanim.maliyetUsd) : null,
          durationMs: sonuc.sureMs,
        },
      })
      return NextResponse.json(guncel)
    } catch (e: any) {
      const mesaj = e instanceof TaramaHatasi ? e.message : e?.message || "Belge okunamadı"
      await prisma.documentScan.update({
        where: { id: satir.id },
        data: { status: "FAILED", error: mesaj },
      })
      if (e instanceof TaramaHatasi) {
        return NextResponse.json({ error: mesaj, hamYanit: e.hamYanit?.slice(0, 4000), scanId: satir.id }, { status: 502 })
      }
      console.error("Belge tarama hatası:", e)
      return NextResponse.json({ error: mesaj, scanId: satir.id }, { status: 500 })
    }
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    throw error
  }
})
