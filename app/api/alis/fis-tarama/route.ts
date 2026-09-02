/**
 * Fiş tarama TEST ucu — görseli modele okutur, çıkarımı ve ölçümleri döner.
 *
 * KAYIT YAPMAZ. Ne görseli depoya koyar ne fiş/fatura üretir; amacı doğruluk ve
 * maliyet ölçmek. Kayda geçirme adımı kullanıcı onayıyla ayrıca tasarlanacak.
 *
 * Yazma yetkisi arıyor (`ensureCompanyWrite`) çünkü her çağrı PARA HARCIYOR —
 * salt-okunur üyelik hesabın faturasını kabartabilmemeli.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { fisTara, TaramaHatasi } from "@/lib/fis-ocr/extract"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import { denetle, insanaSorulmali } from "@/lib/fis-ocr/validate"
import { fisTaramaAcikMi } from "@/lib/fis-ocr/access"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"
// Model yanıtı ölçümde 3-7 sn sürüyor; düşünme açıkken zaman zaman daha uzun.
export const maxDuration = 60

const MAX_BOYUT = 15 * 1024 * 1024 // 15 MB — ham telefon fotoğrafı rahat sığsın
const IZINLI_TUR = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic"]

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const fd = await request.formData().catch(() => null)
    if (!fd) return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 })

    const rawCompany = fd.get("companyId")
    const companyId = await resolveCompanyId(typeof rawCompany === "string" ? rawCompany : null)
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    await ensureCompanyWrite(companyId)

    // ASIL KAPI. Menü gizlemesi kozmetiktir; parayı harcayan yer burası, o yüzden
    // beyaz liste burada okunuyor. Adres çubuğuna elle yazan da buraya çarpar.
    const firma = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, slug: true },
    })
    if (!fisTaramaAcikMi(firma)) {
      return NextResponse.json(
        { error: "Fiş tarama bu firma için açık değil" },
        { status: 403 }
      )
    }

    const dosya = fd.get("file")
    if (!dosya || typeof dosya === "string" || dosya.size === 0) {
      return NextResponse.json({ error: "Fotoğraf gerekli" }, { status: 400 })
    }
    if (dosya.size > MAX_BOYUT) {
      return NextResponse.json(
        { error: "Fotoğraf 15 MB sınırını aşıyor" },
        { status: 400 }
      )
    }
    // HEIC gibi türleri tarayıcı bazen boş type ile gönderiyor; sharp yine de
    // çözebiliyor. Tür BİLİNİYOR ve listede değilse reddet, boşsa dene.
    if (dosya.type && !IZINLI_TUR.includes(dosya.type)) {
      return NextResponse.json(
        { error: `Desteklenmeyen görsel türü: ${dosya.type}` },
        { status: 400 }
      )
    }

    const istenenModel = fd.get("model")
    const model =
      typeof istenenModel === "string" &&
      DENENEBILIR_MODELLER.some((m) => m.id === istenenModel)
        ? istenenModel
        : undefined

    const sonuc = await fisTara(Buffer.from(await dosya.arrayBuffer()), { model })

    // Denetimler sunucuda koşar: istemciye "doğrulandı" bayrağı değil, hangi
    // denetimin neden patladığı gider — ekran karar vermez, gösterir.
    const fisler = sonuc.fisler.map((fis) => {
      const denetimler = denetle(fis)
      return { fis, denetimler, insanaSorulmali: insanaSorulmali(denetimler, fis) }
    })

    return NextResponse.json({
      fisler,
      olcum: {
        model: sonuc.model,
        saglayici: sonuc.saglayici,
        sureMs: sonuc.sureMs,
        kullanim: sonuc.kullanim,
        gorsel: sonuc.gorsel,
        // Karedeki fiş sayısına bölünmüş birim maliyet: "fişleri tek karede çek"
        // tavsiyesinin sayısal karşılığı burada görünür.
        fisBasinaUsd:
          sonuc.kullanim.maliyetUsd != null && sonuc.fisler.length > 0
            ? sonuc.kullanim.maliyetUsd / sonuc.fisler.length
            : null,
      },
    })
  } catch (error: any) {
    if (error instanceof TaramaHatasi) {
      return NextResponse.json(
        { error: error.message, hamYanit: error.hamYanit?.slice(0, 4000) },
        { status: 502 }
      )
    }
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Fiş tarama hatası:", error)
    return NextResponse.json({ error: error?.message || "Fiş taranamadı" }, { status: 500 })
  }
})
