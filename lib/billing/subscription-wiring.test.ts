/**
 * ABONELİK EKRANI ↔ SUNUCU BAĞLANTISININ nöbetçisi.
 *
 * Saf kural testleri kuralın DOĞRU olduğunu gösterir; ekranın o kuralı gerçekten
 * ÇAĞIRDIĞINI göstermez. 2026-09-04'te iki hata da tam buradan geçti: kural sunucuda
 * düzeldi, ekran eski satırı çağırmaya devam etti ve hiçbir test ikisini karşılaştırmadı.
 *
 * Bu dosya `lib/page-api-coverage.test.ts` ile aynı deseni izler: gerçek yüzey dosya
 * sisteminde olduğu için kaynağı okur. Kırılgan görünebilir — kasıtlı: bu satırlar
 * sessizce değiştirilmemeli, değiştirilecekse testi de değiştiren biri gerekçeyi görsün.
 */

import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8")

/**
 * "Bu artık YOK" iddiaları KOD üzerinde sınanır, yorum üzerinde değil.
 *
 * Kaldırılan bir seçeneğin neden kaldırıldığını anlatan yorum, dosyanın en değerli
 * parçası — kaba bir metin araması onu "seçenek hâlâ duruyor" sanıp testi kırar ve
 * geliştiriciyi açıklamayı silmeye iter. Bu yüzden negatif iddialardan önce yorumlar
 * ayıklanır.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

const SUBSCRIPTION_PAGE = "app/(dashboard)/ayarlar/abonelik/page.tsx"
const BILLING_INFO_ROUTE = "app/api/invoicing/billing-info/route.ts"
const BILLING_INFO_FORM = "components/invoicing/billing-info-form.tsx"
const CATALOG_ROUTE = "app/api/billing/catalog/route.ts"
const ORDERS_ROUTE = "app/api/billing/orders/route.ts"

describe("fatura bilgisi SATIN ALAN firmadan okunur", () => {
  // Sipariş ucu faturayı `companyId`ye kesiyor (orders/route.ts → buyerCompany). Ekran
  // hesap kökünü yükleseydi ek firmanın ekranında ana firmanın VKN'si görünür ve ödeme
  // anında `companyFillFromBilling` onu ek firmanın boş alanlarına YAZARDI.
  it("abonelik ekranı useBillingInfo'ya kapsam argümanı GEÇMEZ", () => {
    const src = read(SUBSCRIPTION_PAGE)
    const call = src.match(/useBillingInfo\([^)]*\)/)
    expect(call, "abonelik ekranı fatura bilgisini hiç yüklemiyor").not.toBeNull()
    expect(call![0]).not.toMatch(/["']account["']/)
  })

  it("fatura bilgisi ucu hesap kökünü ÇÖZMEZ", () => {
    const src = codeOnly(read(BILLING_INFO_ROUTE))
    expect(src).not.toContain("resolveAccountRootId")
    expect(src).not.toMatch(/scope/i)
  })

  it("useBillingInfo kancasında kapsam parametresi kalmadı", () => {
    const src = codeOnly(read(BILLING_INFO_FORM))
    expect(src).not.toMatch(/scope\s*[:=]/)
  })
})

describe("satın alma yetkisi tek kaynaktan okunur", () => {
  // Kural iki yere ayrı yazıldığında `catalog` "firmada ADMIN olma" şartını atlamıştı:
  // ekran "satın alabilirsin" derken uç 403 döndürebiliyordu.
  for (const route of [CATALOG_ROUTE, ORDERS_ROUTE]) {
    it(`${route} → resolvePurchaseAuthority çağırır`, () => {
      expect(read(route)).toContain("resolvePurchaseAuthority(")
    })
  }

  it("hiçbir uç kuralı elle yeniden yazmaz (rol karşılaştırması kopyalanmasın)", () => {
    for (const route of [CATALOG_ROUTE, ORDERS_ROUTE]) {
      expect(codeOnly(read(route)), route).not.toMatch(/access\.role\s*!==\s*["']ADMIN["']/)
    }
  })
})

describe("ekranın kararları ortak modülden gelir", () => {
  const src = () => read(SUBSCRIPTION_PAGE)

  it("kota seçimi resolveQuotaSelection'dan geçer", () => {
    expect(src()).toContain("resolveQuotaSelection(")
  })

  it("ödeme düğmesi resolvePayButton'dan geçer", () => {
    expect(src()).toContain("resolvePayButton(")
  })

  it("engel cümlesi purchaseNoticeFor'dan gelir", () => {
    expect(src()).toContain("purchaseNoticeFor(")
  })

  it("kota kartı koşulu elle yazılmaz", () => {
    // `!catalog.isAccountRoot ?` biçiminde bir koşul geri gelirse kural iki yere düşer.
    expect(src()).toContain("showsQuotaCards(")
    expect(codeOnly(src())).not.toMatch(/!\s*catalog\.isAccountRoot\s*\?/)
  })
})

describe("ödenen tutar doğrulanır", () => {
  it("paket callback'i checkPaidAmount çağırır", () => {
    // Hash yalnız "PayTR gönderdi" der; tutarın SİPARİŞİN bedeli olduğunu söylemez.
    expect(read("lib/billing/paytr-payment.ts")).toContain("checkPaidAmount(")
  })
})
