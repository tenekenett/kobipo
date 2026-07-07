import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  createPartnerProvider,
  PARTNER_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * Bayi (İş Ortağı) self-servis e-Dönüşüm hesap açma orkestrasyonu.
 * Müşteri Mysoft ile hiç muhatap olmadan Kobipo'dan hesabını açar:
 *   1) addTenant   → firmayı bayi altında açar
 *   2) addTenantActivation (ürün başına) → GİB'e aktivasyon başvurusu
 *   3) Company.eDonusum* durum alanlarını günceller + SystemLog
 *
 * Tüm çağrılar BAYİ kimliğiyle (createPartnerProvider) yapılır — firmanın kendi
 * Mysoft kullanıcısı yoktur. Aktivasyon GİB onayı asenkron olduğundan sonuç
 * ACTIVATION_PENDING'dir; durum /api/e-donusum/onboarding/status ile poll edilir.
 * Detaylı plan: docs/e-donusum-onboarding/PLAN.md
 *
 * NOT: Ortam (test/canlı) bayi kimliğine bağlıdır (MYSOFT_PARTNER_API_URL) — firma
 * bazlı test/canlı seçici burada geçerli değildir.
 */

// Türkçe metni sadeleştirir (vergi dairesi eşlemesi için): Türkçe karakter → ASCII,
// küçük harf, "vergi dairesi / mal müdürlüğü / vd" ekleri atılır, alfasayısal dışı silinir.
// Örn: "PAMUKKALE VERGİ DAİRESİ" ve "pamukkale" → "pamukkale".
function normalizeTr(s: string): string {
  const ascii = (s || "")
    .replace(/ı/g, "i").replace(/İ/g, "i")
    .replace(/ş/g, "s").replace(/Ş/g, "s")
    .replace(/ğ/g, "g").replace(/Ğ/g, "g")
    .replace(/ü/g, "u").replace(/Ü/g, "u")
    .replace(/ö/g, "o").replace(/Ö/g, "o")
    .replace(/ç/g, "c").replace(/Ç/g, "c")
    .toLowerCase()
  return ascii
    .replace(/vergi dairesi/g, "")
    .replace(/mal mudurlugu/g, "")
    .replace(/mudurlugu/g, "")
    .replace(/\bvd\b/g, "")
    .replace(/[^a-z0-9]/g, "")
}

// Firma adından 3 karakterlik varsayılan seri ön eki (prefix) üretir (A-Z0-9). Başvuruda
// kullanıcıya prefix SORULMAZ — Mysoft aktivasyonda zorunlu tuttuğu için otomatik atanır;
// kullanıcı sonradan Seri No Tanımları'ndan değiştirebilir.
function defaultPrefixFromName(name: string): string {
  const ascii = (name || "")
    .replace(/ı/g, "i").replace(/İ/g, "I").replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ö/g, "o").replace(/Ö/g, "O").replace(/ç/g, "c").replace(/Ç/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  const base = (ascii + "EFA").slice(0, 3) // en az 3 karakter garanti
  return /^[A-Z0-9]{3}$/.test(base) ? base : "EFA"
}

// Aktivasyonu desteklediğimiz ürünler (Swagger activationProductType enum alt kümesi).
const SUPPORTED_PRODUCTS = new Set([
  "EInvoice",
  "EArchive",
  "EDespatch",
  "ESEVoucher",
  "EProducerVoucher",
])
// Seri ön ek (3 karakter) zorunlu olan ürünler.
const PREFIX_REQUIRED = new Set(["EInvoice", "EArchive", "EDespatch"])

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        taxNumber: true,
        taxOffice: true,
        address: true,
        city: true,
        email: true,
        phone: true,
        eDonusumOnboardingStatus: true,
        eDonusumTenantCreatedAt: true,
        eDonusumActivatedProducts: true,
        eFaturaPrefix: true,
        eArchivePrefix: true,
      },
    })
    if (!company) return NextResponse.json({ success: false, error: "Firma bulunamadı" }, { status: 404 })

    const vkn = (company.taxNumber || "").replace(/\D/g, "")
    if (!/^\d{10,11}$/.test(vkn)) {
      return NextResponse.json(
        { success: false, error: "Firma VKN/TCKN geçersiz. Firma Ayarları'ndan 10 (VKN) veya 11 (TCKN) haneli numarayı girin." },
        { status: 400 },
      )
    }

    // Ürünleri normalize + doğrula
    const rawProducts: any[] = Array.isArray(body?.products) ? body.products : []
    const products = rawProducts
      .map((p) => ({
        type: String(p?.type || "").trim(),
        serialNumberPrefix:
          typeof p?.serialNumberPrefix === "string" ? p.serialNumberPrefix.trim().toUpperCase() : "",
        internetSerialNumberPrefix:
          typeof p?.internetSerialNumberPrefix === "string"
            ? p.internetSerialNumberPrefix.trim().toUpperCase()
            : "",
        aliasPrefix: typeof p?.aliasPrefix === "string" ? p.aliasPrefix.trim() : "",
        aliasDomain: typeof p?.aliasDomain === "string" ? p.aliasDomain.trim() : "",
      }))
      .filter((p) => p.type)

    if (products.length === 0) {
      return NextResponse.json(
        { success: false, error: "En az bir ürün seçilmeli (ör. EInvoice, EArchive)." },
        { status: 400 },
      )
    }
    for (const p of products) {
      if (!SUPPORTED_PRODUCTS.has(p.type)) {
        return NextResponse.json({ success: false, error: `Desteklenmeyen ürün: ${p.type}` }, { status: 400 })
      }
      // Prefix Mysoft aktivasyonunda zorunlu (E-Fatura/E-Arşiv/E-İrsaliye). Kullanıcıya
      // SORMUYORUZ: gönderildiyse geçerli olmalı, gönderilmediyse otomatik atanır
      // (önce firmada kayıtlı prefix, yoksa firma adından türetilmiş).
      if (PREFIX_REQUIRED.has(p.type)) {
        if (p.serialNumberPrefix) {
          if (!/^[A-Z0-9]{3}$/.test(p.serialNumberPrefix)) {
            return NextResponse.json(
              { success: false, error: `${p.type} için seri ön ek 3 karakter (harf/rakam) olmalı.` },
              { status: 400 },
            )
          }
        } else {
          const existing =
            p.type === "EInvoice"
              ? company.eFaturaPrefix
              : p.type === "EArchive"
                ? company.eArchivePrefix
                : ""
          const ex = (existing || "").toUpperCase()
          p.serialNumberPrefix = /^[A-Z0-9]{3}$/.test(ex) ? ex : defaultPrefixFromName(company.name)
        }
      }
    }

    const provider = createPartnerProvider()
    if (!provider) {
      return NextResponse.json({ success: false, error: PARTNER_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    const registerNo =
      typeof body?.registerNo === "string" && body.registerNo.trim() ? body.registerNo.trim() : vkn
    const email =
      typeof body?.email === "string" && body.email.trim()
        ? body.email.trim()
        : company.email || user.email || ""
    if (!email) {
      return NextResponse.json(
        { success: false, error: "Firma e-posta adresi gerekli — Firma Ayarları'ndan girin." },
        { status: 400 },
      )
    }

    // 1) Firma aç — daha önce BAŞARIYLA açıldıysa atla (idempotent). Test/teşhis için
    // body.force=true gönderilirse atlamayı bypass edip addTenant'ı yeniden dener
    // (ham Mysoft yanıtını görmek için).
    let tenantId: number | undefined
    const force = body?.force === true
    const alreadyCreated =
      !force &&
      (Boolean(company.eDonusumTenantCreatedAt) ||
        ["TENANT_CREATED", "ACTIVATION_PENDING", "ACTIVE"].includes(
          company.eDonusumOnboardingStatus || "",
        ))

    if (!alreadyCreated) {
      // Vergi dairesini Mysoft'un tanımlı listesiyle eşle. Serbest metin ("pamukkale")
      // reddediliyor (00081); Mysoft kod + resmi ad bekler. Eşleşme bulunamazsa taxOffice
      // GÖNDERİLMEZ (addTenant required listesinde değil) — böylece en azından firma açılır.
      let taxOfficeCode: string | undefined
      let taxOfficeName: string | undefined
      if (company.taxOffice && company.taxOffice.trim()) {
        const offices = await provider.listTaxOffices()
        if (offices.success) {
          const target = normalizeTr(company.taxOffice)
          const match =
            offices.data.find((o) => normalizeTr(o.name) === target) ||
            (target.length >= 3
              ? offices.data.find((o) => normalizeTr(o.name).includes(target))
              : undefined)
          if (match) {
            taxOfficeCode = match.code
            taxOfficeName = match.name
          } else {
            console.warn(
              `[onboarding] Vergi dairesi eşleşmedi: "${company.taxOffice}" — taxOffice gönderilmeyecek`,
            )
          }
        } else {
          console.warn("[onboarding] Vergi dairesi listesi alınamadı:", offices.error)
        }
      }

      // Adres — Mysoft ZORUNLU tutuyor (00094 "Firma Adres bilgisi alanları zorunludur").
      // Ülke sabit TR; şehir kodu city lookup'tan (adres modeli kod bekliyor).
      const cityName = (company.city || "").trim()
      if (!cityName) {
        await prisma.company.update({
          where: { id: companyId },
          data: {
            eDonusumOnboardingStatus: "FAILED",
            eDonusumActivationError: "Firma adresi eksik: şehir (il) zorunlu.",
          },
        })
        return NextResponse.json(
          {
            success: false,
            stage: "createTenant",
            error: "Firma adresi eksik: şehir (il) zorunlu. Firma Ayarları'ndan şehir bilgisini girin.",
          },
          { status: 400 },
        )
      }
      let cityCode: string | undefined
      let officialCityName = cityName
      const cities = await provider.listCities()
      if (cities.success) {
        const target = normalizeTr(cityName)
        const cm =
          cities.data.find((c) => normalizeTr(c.name) === target) ||
          (target.length >= 3
            ? cities.data.find((c) => normalizeTr(c.name).includes(target))
            : undefined)
        if (cm) {
          cityCode = cm.code
          officialCityName = cm.name
        } else {
          console.warn(`[onboarding] Şehir eşleşmedi: "${cityName}"`)
        }
      } else {
        console.warn("[onboarding] Şehir listesi alınamadı:", cities.error)
      }

      const created = await provider.createTenant({
        tenantName: company.name,
        shortName: company.name.slice(0, 50),
        vknTckn: vkn,
        email,
        registerNo,
        taxOfficeCode,
        taxOfficeName,
        telephone: company.phone || undefined,
        address: {
          countryCode: "TR",
          countryName: "TÜRKİYE",
          cityCode,
          cityName: officialCityName,
          citySubdivision: cityName, // ilçe bilinmiyor → il ile doldur (zorunlu alan)
          streetName: (company.address || "").trim() || "-",
          buildingNumber: "1",
        },
      })
      if (!created.success) {
        // createTenant başarısız → NET hata dön ve DUR. Aktivasyona GEÇME (yoksa firma
        // gerçekte açılmadığı için 00180 "firma bulunamadı" ile kafa karışır). Timestamp
        // YAZMA ki sonraki deneme addTenant'ı tekrar denesin ve ham yanıt görünür kalsın.
        const msg = created.error || "Firma açılamadı"
        const code = created.raw?.errorCode || null
        await prisma.company.update({
          where: { id: companyId },
          data: {
            eDonusumOnboardingStatus: "FAILED",
            eDonusumTenantVkn: vkn,
            eDonusumActivationError: code ? `[${code}] ${msg}` : msg,
          },
        })
        return NextResponse.json(
          { success: false, stage: "createTenant", mysoftErrorCode: code, error: msg },
          { status: 502 },
        )
      }
      tenantId = created.tenantId
      await prisma.company.update({
        where: { id: companyId },
        data: {
          eDonusumProvider: "mysoft",
          eDonusumIntegrator: "OZEL_ENTEGRATOR",
          eDonusumTenantVkn: vkn,
          eDonusumOnboardingStatus: "TENANT_CREATED",
          eDonusumTenantCreatedAt: new Date(),
          eDonusumActivationError: null,
        },
      })
    }

    // 2) Ürünleri aktive et (GİB başvurusu). Her biri bağımsız — biri patlarsa
    // diğerleri denenmeye devam eder, sonuçlar toplanır.
    const activations: Array<{ type: string; ok: boolean; activationId?: number; error?: string }> = []
    for (const p of products) {
      // E-Arşiv'de internetSerialNumberPrefix da ZORUNLU (Swagger). UI vermezse
      // normal seri ön ekle aynısını gönder — böylece aktivasyon eksik-alandan patlamaz.
      const internetPrefix =
        p.internetSerialNumberPrefix || (p.type === "EArchive" ? p.serialNumberPrefix : "")
      const r = await provider.activateProduct({
        vknTckn: vkn,
        activationProductType: p.type,
        serialNumberPrefix: p.serialNumberPrefix || undefined,
        internetSerialNumberPrefix: internetPrefix || undefined,
        aliasPrefix: p.aliasPrefix || undefined,
        aliasDomain: p.aliasDomain || undefined,
      })
      activations.push({ type: p.type, ok: r.success, activationId: r.activationId, error: r.error })
    }

    const okTypes = activations.filter((a) => a.ok).map((a) => a.type)
    const anyFail = activations.some((a) => !a.ok)
    const mergedProducts = Array.from(
      new Set([...(company.eDonusumActivatedProducts || []), ...okTypes]),
    )
    const status = okTypes.length > 0 ? "ACTIVATION_PENDING" : "FAILED"
    const firstError = activations.find((a) => !a.ok)?.error || null

    // Aktivasyonda kullanılan (çoğunlukla otomatik atanmış) prefix'i firmaya yaz — böylece
    // Seri No Tanımları ekranında görünür ve fatura gönderiminde aynı numaratör kullanılır.
    const prefixByType: Record<string, string> = {}
    for (const p of products) if (p.serialNumberPrefix) prefixByType[p.type] = p.serialNumberPrefix

    await prisma.company.update({
      where: { id: companyId },
      data: {
        eDonusumOnboardingStatus: status,
        eDonusumActivatedProducts: mergedProducts,
        eDonusumActivationError: anyFail ? firstError : null,
        ...(okTypes.includes("EInvoice") && prefixByType.EInvoice
          ? { eFaturaPrefix: prefixByType.EInvoice }
          : {}),
        ...(okTypes.includes("EArchive") && prefixByType.EArchive
          ? { eArchivePrefix: prefixByType.EArchive }
          : {}),
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: user.id,
        action: "EDONUSUM_ONBOARDING",
        entity: "Company",
        entityId: companyId,
        details: `Firma ${company.name} (VKN ${vkn}) onboarding — tenant: ${
          tenantId ?? "mevcut"
        }, aktivasyon: ${activations.map((a) => `${a.type}:${a.ok ? "OK" : "HATA"}`).join(", ")}`,
        level: anyFail ? "WARN" : "INFO",
      },
    })

    return NextResponse.json({
      success: okTypes.length > 0,
      tenantId,
      status,
      activations,
      error: okTypes.length === 0 ? firstError || "Aktivasyon başarısız" : undefined,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
    }
    console.error("e-donusum onboarding POST error:", error)
    return NextResponse.json({ success: false, error: message || "Onboarding sırasında hata oluştu" }, { status: 500 })
  }
}
