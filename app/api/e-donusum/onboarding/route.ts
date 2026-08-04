import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  createPartnerProvider,
  PARTNER_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * Bayi (İş Ortağı) self-servis e-Dönüşüm hesap açma orkestrasyonu.
 * Müşteri Mysoft ile hiç muhatap olmadan Kobipo'dan hesabını açar:
 *   1) yetkilendirme onayı + İVD kimliği doğrulanır (SystemLog'a onay kaydı)
 *   2) addTenant   → firmayı bayi altında açar
 *   3) addTenantActivation (ürün başına) → İVD kimliğiyle GİB'e aktivasyon başvurusu
 *   4) Company.eDonusum* durum alanlarını günceller + SystemLog
 *
 * KAPSAM (2026-08-03): yalnızca **e-Arşiv**. e-Fatura mükellefin mali mührünü gerektirir
 * (uygulama dışı adım), ÖKC/VUK507 ayrı bir uçtur — ikisi de OUT_OF_SCOPE_PRODUCTS ile
 * route seviyesinde kapalı. Gerekçe: docs/e-donusum-onboarding/PLAN.md §3.1.
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

// Aktivasyonu desteklediğimiz ürünler. 2026-08-03 kapsam kararı: YALNIZCA e-Arşiv.
// Gerekçe ve e-Arşiv/e-Fatura farkı: docs/e-donusum-onboarding/PLAN.md §3.1.
const SUPPORTED_PRODUCTS = new Set(["EArchive"])

// Mysoft'un desteklediği ama bizim şimdilik KAPSAM DIŞI bıraktığımız ürünler.
// UI'da gizlemek YETMEZ: bu uç canlı Mysoft ortamına gidiyor ve kazara gönderilen bir
// ürün gerçek (geri alınması zor) bir GİB başvurusu açar. O yüzden route seviyesinde
// de kapalı tutuluyor.
const OUT_OF_SCOPE_PRODUCTS: Record<string, string> = {
  EInvoice:
    "E-Fatura başvurusu şu anda Kobipo üzerinden yapılamıyor — mükellefin mali mührü (tüzel kişi) veya e-imzası (şahıs firması) gerekiyor.",
  EDespatch: "E-İrsaliye başvurusu şu anda Kobipo üzerinden yapılamıyor.",
  ESEVoucher: "E-Serbest Meslek Makbuzu başvurusu şu anda Kobipo üzerinden yapılamıyor.",
  EProducerVoucher: "E-Müstahsil Makbuzu başvurusu şu anda Kobipo üzerinden yapılamıyor.",
}

// Seri ön ek (3 karakter) zorunlu olan ürünler.
const PREFIX_REQUIRED = new Set(["EInvoice", "EArchive", "EDespatch"])

// e-Arşiv'de İKİ AYRI numaratör vardır: normal e-Arşiv ve internet satış e-Arşiv
// (`internetSerialNumberPrefix`). Aynı ön eki ikisine birden vermek iki seriyi
// çakıştırır. UI ön ek sormadığı için internet serisini normal ön ekten türetiyoruz:
// son karakter → "I"; zaten "I" ile bitiyorsa → "N".
function internetPrefixFrom(base: string): string {
  const b = (base || "").toUpperCase()
  if (!/^[A-Z0-9]{3}$/.test(b)) return "EAI"
  const candidate = `${b.slice(0, 2)}I`
  return candidate === b ? `${b.slice(0, 2)}N` : candidate
}

// Bizim ürün kodlarımız ↔ Mysoft tarife detayındaki Türkçe etiketler
// (getBusinessPartnerTariff → tariffProductDetailList[].activationProductTypeEnumText).
// Tarife seçerken "bu tarife istediğim ürünü kapsıyor mu?" kontrolü için kullanılır.
const PRODUCT_TARIFF_TEXT: Record<string, string> = {
  EArchive: "E-Arşiv Fatura",
  EInvoice: "E-Fatura",
  EDespatch: "E-İrsaliye",
  ESEVoucher: "E-SMM",
  EProducerVoucher: "E-MM",
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)
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
      const outOfScope = OUT_OF_SCOPE_PRODUCTS[p.type]
      if (outOfScope) {
        return NextResponse.json(
          { success: false, code: "PRODUCT_OUT_OF_SCOPE", error: outOfScope },
          { status: 400 },
        )
      }
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

    // --- İnteraktif Vergi Dairesi kimliği (mükellefin yetkilendirmesi) ---
    // GİB başvuru dosyasını Mysoft bu kimlikle oluşturuyor. Mali mühür/e-imza yerine
    // geçen mekanizma budur (PLAN.md §3.1).
    //
    // 🔒 Bu şifre mükellefin TÜM vergi hesabına erişim verir (beyanname, borç, tebligat).
    // Yalnızca bu isteğin ömrü boyunca bellekte durur ve doğrudan Mysoft'a iletilir:
    // DB'ye, SystemLog'a, console'a veya hata mesajına ASLA yazılmaz.
    const ivdUsername = typeof body?.ivdUsername === "string" ? body.ivdUsername.trim() : ""
    const ivdPassword = typeof body?.ivdPassword === "string" ? body.ivdPassword : ""
    if (!ivdUsername || !ivdPassword) {
      return NextResponse.json(
        {
          success: false,
          code: "IVD_REQUIRED",
          error:
            "İnteraktif Vergi Dairesi kullanıcı kodu ve şifresi gerekli — GİB başvurusu bu kimlikle yapılıyor.",
        },
        { status: 400 },
      )
    }

    // --- Yetkilendirme onayı ---
    // Kullanıcı, İVD kimliğinin bizim üzerimizden GİB'e iletilmesine açık onay vermeden
    // başvuru başlatılmaz. Onay kaydı başvurunun SONUCUNDAN BAĞIMSIZ tutulur: ispat için
    // gereken şey onayın alınmış olmasıdır, başvurunun başarılı olması değil.
    if (body?.consentAccepted !== true) {
      return NextResponse.json(
        {
          success: false,
          code: "CONSENT_REQUIRED",
          error: "Devam etmek için yetkilendirme onayını işaretlemeniz gerekiyor.",
        },
        { status: 400 },
      )
    }
    const consentIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "bilinmiyor"
    await prisma.systemLog.create({
      data: {
        userId: user.id,
        action: "EDONUSUM_ONBOARDING_CONSENT",
        entity: "Company",
        entityId: companyId,
        details:
          `${company.name} (VKN ${vkn}) için e-Dönüşüm başvuru yetkilendirmesi onaylandı. ` +
          `Ürünler: ${products.map((p) => p.type).join(", ")}. IP: ${consentIp}. ` +
          `İVD kullanıcı kodu uzunluğu: ${ivdUsername.length} (kimlik bilgisi saklanmaz).`,
        level: "INFO",
      },
    })

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

    // 1.5) TARİFE (SÖZLEŞME) ÖN KOŞULU
    // addTenant'taki `addTariffToTenant:true` tek başına yetmiyor: tenant'ta tarife
    // yoksa addTenantActivation "Üzerinize tanımlı aktivasyon ürün bilgisi
    // bulunmamaktadır." döner. 2026-08-03'te canlıda doğrulandı (tenant 53949 açıldı,
    // aktivasyon bu hatayla reddedildi). Bu yüzden aktivasyondan ÖNCE bayinin tarifesini
    // firmaya tanımlıyoruz. Zaten tanımlıysa atlanır (idempotent — kullanıcı tekrar
    // başvurduğunda ikinci sözleşme açılmasın).
    //
    // `forcePreContract:true` → mevcut sözleşme kaydı olsa bile tarifeyi YENİDEN tanımla.
    // Kurtarma kapısıdır: 2026-08-04'te tenant'ta sözleşme GÖRÜNDÜĞÜ hâlde aktivasyon yine
    // "aktivasyon ürün bilgisi yok" dedi — yani kayıt işe yaramaz olabiliyor. Teşhis ucu
    // (/api/e-donusum/onboarding/diagnose?vkn=) ile kaydın içeriği görüldükten sonra kullan.
    const forcePreContract = body?.forcePreContract === true
    let contractInfo: string | null = null
    const existingContracts = await provider.getPreContract(vkn)
    if (forcePreContract || existingContracts.data.length === 0) {
      const tariffs = await provider.getBusinessPartnerTariff(50)
      const covers = (t: any, productType: string) => {
        const want = normalizeTr(PRODUCT_TARIFF_TEXT[productType] || "")
        if (!want) return false
        return (
          Array.isArray(t?.tariffProductDetailList) &&
          t.tariffProductDetailList.some(
            (d: any) => normalizeTr(String(d?.activationProductTypeEnumText || "")) === want,
          )
        )
      }
      const active = tariffs.data.filter((t: any) => !t?.isPassive && t?.tariffCode)
      // Önce istenen ürünlerin HEPSİNİ kapsayan aktif tarife; yoksa herhangi bir aktif tarife.
      const match = active.find((t: any) => products.every((p) => covers(t, p.type))) || active[0]

      if (!match) {
        const detail = tariffs.success
          ? "Bayi hesabında aktif tarife bulunamadı."
          : `Tarife listesi alınamadı: ${tariffs.error || "bilinmeyen hata"}`
        await prisma.company.update({
          where: { id: companyId },
          data: { eDonusumOnboardingStatus: "FAILED", eDonusumActivationError: detail },
        })
        return NextResponse.json({ success: false, stage: "preContract", error: detail }, { status: 502 })
      }

      // Paket adedi tarifenin en küçük kademesi. isLoadCredit:false olduğu için kontör
      // YÜKLENMEZ — sadece sözleşme tanımlanır. Otomatik yükleme bayi kontör havuzunu
      // sessizce düşürür ve mevcut satın alma akışıyla (/e-donusum/kontor) çakışırdı.
      const qtys: number[] = Array.isArray(match.tariffDetailList)
        ? match.tariffDetailList
            .map((d: any) => Number(d?.qty))
            .filter((n: number) => Number.isFinite(n) && n > 0)
        : []
      const qty = qtys.length > 0 ? Math.min(...qtys) : 250

      const pc = await provider.addPreContract({
        vknTckn: vkn,
        tariffCode: match.tariffCode,
        qty,
        isLoadCredit: false,
      })
      if (!pc.success) {
        const msg = pc.error || "Firmaya tarife tanımlanamadı"
        await prisma.company.update({
          where: { id: companyId },
          data: { eDonusumOnboardingStatus: "FAILED", eDonusumActivationError: msg },
        })
        return NextResponse.json({ success: false, stage: "preContract", error: msg }, { status: 502 })
      }
      contractInfo = `${match.tariffCode} (${qty} kontörlük paket, kontör yüklenmedi${
        forcePreContract ? ", ZORLANDI" : ""
      })`
    } else {
      // Atlandıysa NE olduğunu logla — "mevcut" tek başına teşhis için işe yaramadı
      // (2026-08-04). tariffCode ve kayıt sayısı bir sonraki denemede doğrudan görünsün.
      const codes = existingContracts.data
        .map((c: any) => c?.tariffCode)
        .filter(Boolean)
        .join(" / ")
      contractInfo = `mevcut (${existingContracts.data.length} kayıt${codes ? `: ${codes}` : ""})`
    }

    // 2) Ürünleri aktive et (GİB başvurusu). Her biri bağımsız — biri patlarsa
    // diğerleri denenmeye devam eder, sonuçlar toplanır.
    const activations: Array<{ type: string; ok: boolean; activationId?: number; error?: string }> = []
    for (const p of products) {
      // E-Arşiv'de internetSerialNumberPrefix da ZORUNLU (Swagger). UI sormadığı için
      // normal ön ekten TÜRETİLİR — eskiden aynısı gönderiliyordu, bu iki seriyi
      // çakıştırıyordu (bkz. internetPrefixFrom).
      const internetPrefix =
        p.internetSerialNumberPrefix ||
        (p.type === "EArchive" ? internetPrefixFrom(p.serialNumberPrefix) : "")
      const r = await provider.activateProduct({
        vknTckn: vkn,
        activationProductType: p.type,
        serialNumberPrefix: p.serialNumberPrefix || undefined,
        internetSerialNumberPrefix: internetPrefix || undefined,
        aliasPrefix: p.aliasPrefix || undefined,
        aliasDomain: p.aliasDomain || undefined,
        ivdUsername,
        ivdPassword,
      })
      activations.push({ type: p.type, ok: r.success, activationId: r.activationId, error: r.error })
    }

    const okTypes = activations.filter((a) => a.ok).map((a) => a.type)
    const anyFail = activations.some((a) => !a.ok)
    const mergedProducts = Array.from(
      new Set([...(company.eDonusumActivatedProducts || []), ...okTypes]),
    )

    // BİLİNEN DURUM (PLAN.md günlük 23): bayi API kullanıcımızın aktivasyon yetkisi yok —
    // `addTenantActivation` her üründe bu mesajı dönüyor, aynı işlem Mysoft PANELİNDEN elle
    // yapılınca çalışıyor. Bu hâlde başvuruyu BAŞARISIZ saymak yanlış: tenant açıldı, tarife
    // ve kontör tanımlandı; geriye yalnız bizim elle tamamlayacağımız adım kaldı.
    // Kullanıcıya "alındı, işleniyor" denir; biz panelden aktive edince "Durumu Yenile"
    // gerçeği görüp firmayı ACTIVE yapar (onboarding/status route'undaki senkron).
    // Mysoft yetkiyi tanımladığında bu dal kendiliğinden devre dışı kalır — kod değişmez.
    const MANUAL_ACTIVATION_HINT = /aktivasyon ürün bilgisi bulunmamaktadır/i
    const needsManualActivation =
      okTypes.length === 0 &&
      activations.length > 0 &&
      activations.every((a) => !a.ok && MANUAL_ACTIVATION_HINT.test(a.error || ""))

    const status = okTypes.length > 0 || needsManualActivation ? "ACTIVATION_PENDING" : "FAILED"
    // TÜM başarısız ürünlerin mesajı tutulur. Eskiden yalnız ilki yazılıyordu ve
    // 2026-08-03'te EInvoice'un hata metni tamamen kayboldu (bkz. PLAN.md günlük 22).
    const failed = activations.filter((a) => !a.ok)
    const firstError =
      failed.length > 0
        ? failed.map((a) => `${a.type}: ${a.error || "mesaj yok"}`).join(" | ")
        : null

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
        }, tarife: ${contractInfo ?? "-"}, aktivasyon: ${activations
          // Her ürünün hata METNİ ayrı yazılır. Eskiden yalnız "HATA" yazılıyor ve
          // eDonusumActivationError'a sadece İLK başarısız ürünün mesajı düşüyordu →
          // 2026-08-03'te EInvoice'un gerçek hata metni tamamen kayboldu ve "bu kayıt
          // bizden mi?" sorusu günlerce cevaplanamadı.
          .map((a) => `${a.type}:${a.ok ? "OK" : `HATA(${a.error || "mesaj yok"})`}`)
          .join(", ")}`,
        level: anyFail ? "WARN" : "INFO",
      },
    })

    return NextResponse.json({
      success: okTypes.length > 0 || needsManualActivation,
      tenantId,
      status,
      activations,
      /** true → başvuru alındı, aktivasyonu biz Mysoft panelinden tamamlayacağız. */
      manualActivationPending: needsManualActivation,
      // Teknik metin her hâlde döner (ekranda "Teknik yanıt" bloğunda görünür) — manuel
      // dalda bile gizlemiyoruz, teşhis için gerekli.
      error:
        okTypes.length === 0 && !needsManualActivation
          ? firstError || "Aktivasyon başarısız"
          : undefined,
      activationDetail: firstError || undefined,
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
