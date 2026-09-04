/**
 * Sohbet ucu.
 *
 * Sinyaller BURADA DA hesaplanıyor (brifing için) — istemcinin gönderdiği
 * kartlara güvenilmiyor. Güvenilseydi, isteği elle kurup "brifing" alanına
 * uydurma rakam yazan biri modele yanlış zemin verebilirdi; üstelik başka bir
 * firmanın rakamlarını da yazabilirdi.
 *
 * YAZMA YETKİSİ ARANMIYOR, ama kota var: `ensureCompanyWrite` fiş taramada her
 * çağrı para harcadığı için kullanılıyordu. Burada okuma yetkisi yeter çünkü
 * asistan salt-okunur bir rapor aracı ve VIEWER rolünün en çok işine yarayacağı
 * yer tam da burası. Maliyet kontrolü aylık kotayla yapılıyor.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, pagePermissionsOf } from "@/lib/middleware/company"
import { ensureUsageLimit } from "@/lib/middleware/usage"
import { withApiErrors } from "@/lib/api/errors"
import { asistanAcikMi } from "@/lib/asistan/erisim"
import { sinyalleriHesapla } from "@/lib/asistan/sinyaller"
import { sohbetEt, SohbetHatasi } from "@/lib/asistan/sohbet"
import { istanbulDay } from "@/lib/format"
import { companyDisplayName } from "@/lib/company/display-name"
import { istekOnbellegi } from "@/lib/asistan/veri/onbellek"
import type { SohbetMesaji } from "@/lib/asistan/tipler"

export const dynamic = "force-dynamic"
// Araç turlarıyla birlikte 30 sn'yi bulabiliyor; tur sınırı 4.
export const maxDuration = 90

/** Geçmişin son N turu gönderilir — tamamı her istekte token olarak ödenirdi. */
const GECMIS_SINIRI = 12
const SORU_SINIRI = 2000

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const govde = await request.json().catch(() => null)
  if (!govde || typeof govde !== "object") {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 })
  }

  const companyId = await resolveCompanyId(govde.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  const soru = typeof govde.soru === "string" ? govde.soru.trim() : ""
  if (!soru) return NextResponse.json({ error: "Soru boş" }, { status: 400 })
  if (soru.length > SORU_SINIRI) {
    return NextResponse.json({ error: "Soru çok uzun" }, { status: 400 })
  }

  const uyelik = await ensureCompanyAccess(companyId)

  const firma = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, slug: true, name: true, branchName: true },
  })
  if (!asistanAcikMi(firma)) {
    return NextResponse.json({ error: "Asistan bu firma için açık değil" }, { status: 403 })
  }

  try {
    await ensureUsageLimit(companyId, "asistan_monthly", 1)
  } catch {
    return NextResponse.json(
      { error: "Bu ay için asistan sınırına ulaşıldı. Destek ile iletişime geçin." },
      { status: 429 }
    )
  }

  // Geçmiş istemciden geliyor ama içeriği modele "kullanıcı/asistan" olarak
  // giriyor, talimat olarak değil — sistem prompt'u istemciden ASLA alınmaz.
  const gecmis: SohbetMesaji[] = Array.isArray(govde.gecmis)
    ? govde.gecmis
        .filter(
          (m: unknown): m is SohbetMesaji =>
            Boolean(m) &&
            typeof m === "object" &&
            typeof (m as SohbetMesaji).metin === "string" &&
            ((m as SohbetMesaji).rol === "kullanici" || (m as SohbetMesaji).rol === "asistan")
        )
        .slice(-GECMIS_SINIRI)
        .map((m: SohbetMesaji) => ({ rol: m.rol, metin: m.metin.slice(0, SORU_SINIRI) }))
    : []

  const izinler = pagePermissionsOf(uyelik)
  const kapaliModuller = uyelik.disabledModules ?? []
  // Brifing ile araçlar AYNI önbelleği paylaşır: yaşlandırma (bu ucun en pahalı
  // işi) tek soruda dört kez hesaplanabiliyordu — iki vade sinyali, sonra
  // modelin çağırdığı `vadesi_gecenler` ve `cari_ara`.
  const onbellek = istekOnbellegi()
  const sinyaller = await sinyalleriHesapla({ companyId, izinler, kapaliModuller, onbellek })

  try {
    const sonuc = await sohbetEt({
      brifing: {
        firmaAdi: companyDisplayName(firma!),
        bugun: istanbulDay(),
        sinyaller: sinyaller.sinyaller,
        kapaliAlanlar: sinyaller.kapaliAlanlar,
      },
      gecmis,
      soru,
      aracBaglami: { companyId, izinler, kapaliModuller, onbellek },
      model: typeof govde.model === "string" ? govde.model : undefined,
    })

    return NextResponse.json({
      cevap: sonuc.cevap,
      model: sonuc.model,
      saglayici: sonuc.saglayici,
      // Hangi araçlar çalıştı — ekranda "neye baktı" olarak gösteriliyor.
      // Şeffaflık burada süs değil: kullanıcı rakamın nereden geldiğini
      // göremezse asistana ya körü körüne inanır ya da hiç kullanmaz.
      //
      // `olcum` açıkken araç ÇIKTILARI da dönüyor: ölçüm tezgâhı, cevaptaki her
      // sayının bir araç sonucunda gerçekten var olup olmadığını böyle sınıyor.
      // Sızıntı değil — kullanıcının zaten yetkisi olan kendi verisi; normal
      // yanıtta yok çünkü gövdeyi gereksiz şişirir.
      araclar: sonuc.araclar.map((a) => ({
        ad: a.ad,
        girdi: a.girdi,
        sureMs: a.sureMs,
        ...(govde.olcum === true ? { cikti: a.cikti } : {}),
      })),
      ...(govde.olcum === true
        ? { brifingSinyalleri: sinyaller.sinyaller, kapaliAlanlar: sinyaller.kapaliAlanlar }
        : {}),
      kullanim: sonuc.kullanim,
    })
  } catch (e) {
    if (e instanceof SohbetHatasi) {
      return NextResponse.json({ error: e.message }, { status: 502 })
    }
    throw e
  }
})
