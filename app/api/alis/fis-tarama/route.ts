/**
 * Fiş tarama ucu.
 *
 *   POST → görseli modele okutur, çıkarımı + denetimleri + ölçümü döner.
 *   GET  → mükerrer denetimi (aşağıda).
 *
 * KAYIT BURADA YAPILMAZ: onaydan sonra ekran, Hızlı Alış'ın kullandığı
 * `/api/e-donusum/invoices` ucuna gider. Fiş kesme mantığının (stok, cari,
 * numara serisi, kota) ikinci bir kopyasını açmıyoruz — tek yazma kapısı.
 *
 * POST yazma yetkisi arıyor (`ensureCompanyWrite`) çünkü her çağrı PARA
 * HARCIYOR — salt-okunur üyelik hesabın faturasını kabartabilmemeli.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveReportDateFilter } from "@/lib/raporlar/satis-alis-shared"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { fisTara, TaramaHatasi } from "@/lib/fis-ocr/extract"
import { DENENEBILIR_MODELLER } from "@/lib/fis-ocr/models"
import { denetle, insanaSorulmali } from "@/lib/fis-ocr/validate"
import { fisTaramaAcikMi } from "@/lib/fis-ocr/access"
import { ensureUsageLimit } from "@/lib/middleware/usage"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"
// Model yanıtı ölçümde 3-7 sn sürüyor; düşünme açıkken zaman zaman daha uzun.
export const maxDuration = 60

const MAX_BOYUT = 15 * 1024 * 1024 // 15 MB — ham telefon fotoğrafı rahat sığsın
const IZINLI_TUR = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic"]

/**
 * MÜKERRER DENETİMİ — aynı fiş iki kez taranırsa iki alış fişi doğmasın.
 *
 * Fotoğraf SAKLANMIYOR, yani "bu kareyi daha önce okudum" diyebileceğimiz bir iz
 * yok; elimizdeki tek kanıt daha önce kesilmiş fişin kendisidir. Anahtar
 * tedarikçi + gün + tutar üçlüsü: üçü de fişten okunuyor ve üçü birden tutan
 * ikinci bir kayıt neredeyse her zaman aynı fişin ikinci taramasıdır.
 *
 * TEDARİKÇİ SEÇİLMEDİYSE koruma kalkmaz, DARALIR: bu kez tedarikçisiz alış
 * fişleri arasında gün + tutar aranır. Yanlış eşleşme olasılığı artar (iki ayrı
 * satıcıdan aynı gün aynı tutar), ama sonuç zaten bir uyarı olduğu için bedeli
 * fazladan bir soru; korumayı tamamen kapatmanın bedeli ise sessiz mükerrer kayıt.
 *
 * "Neredeyse": aynı marketten aynı gün aynı tutarda İKİNCİ BİR GERÇEK alışveriş
 * mümkündür. Bu yüzden sonuç bir ENGEL değil UYARIDIR — uç bulduğunu söyler,
 * kararı ekran ve kullanıcı verir. Engel yapsaydık meşru ikinci fiş hiç
 * girilemezdi ve kullanıcı akışı elle atlatmak zorunda kalırdı.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  const supplierId = sp.get("supplierId") || null
  const gun = sp.get("date")
  const toplam = Number(sp.get("total"))
  if (!companyId || !gun || !Number.isFinite(toplam)) {
    return NextResponse.json(
      { error: "companyId, date ve total zorunlu" },
      { status: 400 }
    )
  }
  await ensureCompanyAccess(companyId)

  // Gün sınırı raporlarla AYNI eksende (UTC) çözülüyor: iki yer ayrı gün tanımı
  // kullanırsa gece yarısına yakın kesilen fiş birinde bulunup diğerinde kaybolur.
  const aralik = resolveReportDateFilter(gun, gun)

  const adaylar = await prisma.invoice.findMany({
    where: {
      companyId,
      type: "PURCHASE",
      isReceipt: true,
      // null verilirse Prisma IS NULL arar — tedarikçisiz fişler kendi aralarında.
      supplierId,
      ...(aralik ? { date: aralik } : {}),
      // İptal edilmiş fiş mükerrer sayılmaz: kullanıcı zaten silmiş, yenisini
      // girmesi meşru. CONVERTED ise sayılır — fatura hâline gelmiş olsa da
      // ekonomik etki duruyor.
      status: { not: "CANCELLED" },
    },
    select: { id: true, invoiceNo: true, slug: true, date: true, totalAmount: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  })

  const mukerrer =
    adaylar.find((a) => Math.abs(Number(a.totalAmount) - toplam) < 0.01) ?? null

  return NextResponse.json({
    mukerrer: mukerrer
      ? {
          id: mukerrer.id,
          invoiceNo: mukerrer.invoiceNo,
          slug: mukerrer.slug,
          date: mukerrer.date,
          totalAmount: Number(mukerrer.totalAmount),
        }
      : null,
  })
})

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

    // AYLIK TAVAN. Beyaz liste KİMİN tarayabildiğini sınırlıyor, KAÇ KEZ
    // tarayabildiğini değil — kayıt akışı geldiğine göre hacim de artacak ve
    // her tarama sağlayıcıya para ödüyor. Tavan sayaç satırından (usage_limits)
    // okunuyor; bir firmaya daha fazlası gerekiyorsa maxValue elle yükseltilir.
    //
    // Sayaç MODELİ ÇAĞIRMADAN ÖNCE artıyor: sağlayıcı hata dönerse bedava bir
    // tarama sayılmış olur. Tersi (sonra artırmak) başarısız isteği tekrar
    // tekrar denemenin tavanı hiç görmemesi demekti.
    try {
      await ensureUsageLimit(companyId, "fis_tarama_monthly", 1)
    } catch {
      return NextResponse.json(
        { error: "Bu ay için fiş tarama sınırına ulaşıldı. Destek ile iletişime geçin." },
        { status: 429 }
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
