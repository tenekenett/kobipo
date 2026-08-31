/**
 * Ödeme sonrası abonelik yazımı kararının testleri.
 *
 * Buradaki bir hata doğrudan müşterinin parasına ve erişimine dokunuyor: canlıda
 * modülsüz (yalnız kota) bir sipariş `applyEntitlements(root, [])` çağırıp kök firma
 * ile hesabın TÜM üyelerinin her modülünü kapatıyordu. Testler o senaryoyu, iki
 * kotanın (şube/firma) birbirini ezmemesini ve "ödenmiş süre kısalmasın" kuralını
 * kilitliyor.
 */

import { describe, expect, it } from "vitest"
import { planSubscriptionWrite } from "./paytr-payment"

const NOW = new Date("2026-08-13T12:00:00.000Z")

const order = (over: Partial<Parameters<typeof planSubscriptionWrite>[0]> = {}) => ({
  resolvedModules: ["sales", "stock"],
  branchQuota: 0,
  companyQuota: 0,
  billingCycle: "MONTHLY",
  ...over,
})

/** Mevcut abonelik — kotalar varsayılan 0, "takviye düşürmez" kuralı için doldurulur. */
const existing = (
  over: Partial<NonNullable<Parameters<typeof planSubscriptionWrite>[1]>> = {},
) => ({
  purchasedModules: [] as string[],
  periodEnd: null as Date | null,
  branchQuota: 0,
  companyQuota: 0,
  amount: null as number | null,
  ...over,
})

describe("planSubscriptionWrite — yalnız kota satın alma", () => {
  it("mevcut abonelikte modüllere ve döneme DOKUNMAZ, sadece kotayı yazar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 3 }),
      existing({ purchasedModules: ["sales", "stock"], periodEnd: new Date("2026-12-01T00:00:00.000Z") }),
      NOW,
    )
    expect(write).toEqual({
      kind: "quota-top-up",
      branchQuota: 3,
      companyQuota: 0,
      // Birim fiyat verilmeden hesap YAPILMAZ; ayrı describe bloğu bunu sınıyor.
      amount: null,
    })
  })

  // Firma kotası şubeden AYRI bir üründür: modülsüz "bir firma daha" siparişi de
  // kota takviyesi sayılmalı, yoksa aboneliği ACTIVE'e alıp modülleri sıfırlardı.
  it("yalnız FİRMA kotası alındığında da kota takviyesi yapar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], companyQuota: 2 }),
      existing({ purchasedModules: ["sales"], periodEnd: new Date("2026-12-01T00:00:00.000Z") }),
      NOW,
    )
    expect(write).toEqual({
      kind: "quota-top-up",
      branchQuota: 0,
      companyQuota: 2,
      // Birim fiyat verilmeden hesap YAPILMAZ; ayrı describe bloğu bunu sınıyor.
      amount: null,
    })
  })

  it("iki kotayı birlikte yazar — biri diğerini sıfırlamaz", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 4, companyQuota: 1 }),
      existing({ purchasedModules: [], periodEnd: null }),
      NOW,
    )
    expect(write).toEqual({
      kind: "quota-top-up",
      branchQuota: 4,
      companyQuota: 1,
      // Birim fiyat verilmeden hesap YAPILMAZ; ayrı describe bloğu bunu sınıyor.
      amount: null,
    })
  })

  it("deneme aboneliğinin süresini kısaltmaz (kota takviyesi dönemi hiç yazmaz)", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 11 }),
      existing({ purchasedModules: [], periodEnd: new Date("2027-04-29T00:00:00.000Z") }),
      NOW,
    )
    expect(write.kind).toBe("quota-top-up")
  })

  // CANLIDA YAŞANDI (15 Ağu 2026): hesap bir gün önce 1 ek şube almıştı; ertesi gün
  // yalnız EK FİRMA alan sipariş formdan branchQuota=0 taşıdı ve ödenmiş şube kotası
  // silindi. Takviye artık kota düşürmez.
  it("takviye mevcut kotayı DÜŞÜRMEZ — sipariş yalnız diğer ürünü artırıyorsa eskisi kalır", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 0, companyQuota: 3 }),
      existing({ branchQuota: 1, companyQuota: 2 }),
      NOW,
    )
    expect(write).toEqual({
      kind: "quota-top-up",
      branchQuota: 1,
      companyQuota: 3,
      // Birim fiyat verilmeden hesap YAPILMAZ; ayrı describe bloğu bunu sınıyor.
      amount: null,
    })
  })

  it("aboneliği olmayan hesapta satır açar ama MODÜL YETKİSİ UYGULAMAZ", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 2, companyQuota: 1 }),
      null,
      NOW,
    )
    expect(write).toMatchObject({
      kind: "activate",
      purchasedModules: [],
      branchQuota: 2,
      companyQuota: 1,
      applyEntitlements: false,
    })
  })
})

/**
 * KOTA TAKVİYESİ YENİLEME TUTARINI DA YÜKSELTİR.
 *
 * Kaçak: takviye kotayı yükseltiyor ama `Subscription.amount`a dokunmuyordu; `runRecurring`
 * her dönem o tutarı çekiyor, yani modülsüz alınan kota bir kez ödenip sonsuza kadar
 * bedava sürüyordu. Canlıda kullanılmış bir yol (`resolvedModules: []` siparişler mevcut).
 */
describe("planSubscriptionWrite — takviye yenileme tutarını yükseltir", () => {
  const priced = (over: Partial<Parameters<typeof planSubscriptionWrite>[0]> = {}) =>
    order({
      resolvedModules: [],
      branchUnitPrice: 10,
      companyUnitPrice: 20,
      ...over,
    })

  it("tutar yalnız EKLENEN kota kadar artar — sahip olunan kota ikinci kez yazılmaz", () => {
    // Sipariş kotanın TAMAMINI ücretlendirir (paket yok), ama abonelik 1 şubeyi zaten
    // ödüyordu; onu bir kez daha eklemek her dönem çift tahsilat olurdu.
    const write = planSubscriptionWrite(
      priced({ branchQuota: 3 }),
      existing({ branchQuota: 1, amount: 70 }),
      NOW,
    )
    expect(write).toMatchObject({ kind: "quota-top-up", branchQuota: 3, amount: 90 })
  })

  it("iki üründen birden eklenirse ikisi de tutara girer", () => {
    const write = planSubscriptionWrite(
      priced({ branchQuota: 2, companyQuota: 3 }),
      existing({ branchQuota: 0, companyQuota: 1, amount: 100 }),
      NOW,
    )
    // 2 şube × 10 + 2 ek firma × 20 = 60
    expect(write).toMatchObject({ amount: 160 })
  })

  it("kota ARTMADIYSA tutara dokunulmaz", () => {
    // Takviye kota düşürmez; artmayan bir siparişte yenileme tutarı da değişmemeli.
    const write = planSubscriptionWrite(
      priced({ branchQuota: 1 }),
      existing({ branchQuota: 3, amount: 70 }),
      NOW,
    )
    expect(write).toMatchObject({ kind: "quota-top-up", branchQuota: 3, amount: null })
  })

  it("birim fiyat çözülemediyse tutara HİÇ dokunulmaz", () => {
    // Yarım bir artış, hiç artış olmamasından daha yanıltıcı; log/olay kaydı durumu duyurur.
    const write = planSubscriptionWrite(
      priced({ branchQuota: 3, branchUnitPrice: null }),
      existing({ branchQuota: 1, amount: 70 }),
      NOW,
    )
    expect(write).toMatchObject({ amount: null })
  })

  it("yalnız FİYATI BİLİNMEYEN üründen kota eklenmemişse hesap yapılır", () => {
    const write = planSubscriptionWrite(
      priced({ branchQuota: 1, companyQuota: 2, branchUnitPrice: null }),
      existing({ branchQuota: 1, companyQuota: 0, amount: 50 }),
      NOW,
    )
    expect(write).toMatchObject({ amount: 90 })
  })

  it("tutarı olmayan (deneme) abonelikte sıfırdan başlar", () => {
    const write = planSubscriptionWrite(
      priced({ branchQuota: 2 }),
      existing({ branchQuota: 0, amount: null }),
      NOW,
    )
    expect(write).toMatchObject({ amount: 20 })
  })

  it("yenilemelere işleyen kupon oranı eklenen kotaya da uygulanır", () => {
    // %50 indirimli ve "yenilemelerde de geçerli" bir kupon: eklenen kota da indirimli sürer.
    const write = planSubscriptionWrite(
      priced({ branchQuota: 2, renewalPriceRatio: 0.5 }),
      existing({ branchQuota: 0, amount: 40 }),
      NOW,
    )
    expect(write).toMatchObject({ amount: 50 })
  })

  it("tek seferlik kuponda tutar LİSTE fiyatından artar", () => {
    // `renewalPriceRatio` verilmezse 1'dir: kupon yalnız ilk ödemeye aitti.
    const write = planSubscriptionWrite(
      priced({ branchQuota: 2 }),
      existing({ branchQuota: 0, amount: 40 }),
      NOW,
    )
    expect(write).toMatchObject({ amount: 60 })
  })
})

describe("planSubscriptionWrite — modülsüz sipariş yetki YAZAMAZ", () => {
  // Canlıda yaşandı: `companyQuota`yı bilmeyen bir sürüm, yalnız firma kotası içeren
  // siparişi "modül alımı" sanıp `applyEntitlements(root, [])` çağırdı ve hesabın tüm
  // modüllerini kapattı. Kota koşulu ileride yine eksik kalabilir; bu test, modülsüz
  // hiçbir siparişin yetkiye dokunamayacağını kilitler.
  it("hiçbir kota koşuluna uymasa bile applyEntitlements=false kalır", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 0, companyQuota: 0 }),
      existing({ purchasedModules: ["sales", "stock"], periodEnd: null }),
      NOW,
    )
    expect(write).toMatchObject({ kind: "activate", applyEntitlements: false })
  })
})

describe("planSubscriptionWrite — modül/paket satın alma", () => {
  it("modülleri yazar ve yetkileri uygular", () => {
    const write = planSubscriptionWrite(order({ branchQuota: 1, companyQuota: 2 }), null, NOW)
    expect(write).toMatchObject({
      kind: "activate",
      purchasedModules: ["sales", "stock"],
      branchQuota: 1,
      companyQuota: 2,
      applyEntitlements: true,
    })
  })

  it("dönem GELECEKTEYSE onun üstüne ekler — erken yenileyen gün kaybetmez", () => {
    // Eski kural `max(mevcutBitiş, bugün+periyot)` idi ve tam burada para/erişim
    // kaybettiriyordu: 1 Ocak'a kadar süresi olan müşteri bugün aylık yenilerse
    // 13 Eylül'e düşüyordu, yani üç buçuk ayını kaybediyordu.
    const laterEnd = new Date("2027-01-01T00:00:00.000Z")
    const write = planSubscriptionWrite(
      order(),
      existing({ purchasedModules: ["sales"], periodEnd: laterEnd }),
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2027-02-01T00:00:00.000Z"),
    )
  })

  it("yıllık erken yenilemede kalan süre korunur", () => {
    const laterEnd = new Date("2026-09-02T00:00:00.000Z") // 20 gün kaldı
    const write = planSubscriptionWrite(
      order({ billingCycle: "YEARLY" }),
      existing({ purchasedModules: ["sales"], periodEnd: laterEnd }),
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2027-09-02T00:00:00.000Z"),
    )
  })

  it("mevcut dönem geçmişse yeni dönemi yazar (aylık → +1 ay)", () => {
    const write = planSubscriptionWrite(
      order(),
      existing({ purchasedModules: ["sales"], periodEnd: new Date("2026-07-01T00:00:00.000Z") }),
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2026-09-13T12:00:00.000Z"),
    )
  })

  it("yıllık periyotta dönemi +1 yıl uzatır", () => {
    const write = planSubscriptionWrite(order({ billingCycle: "YEARLY" }), null, NOW)
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2027-08-13T12:00:00.000Z"),
    )
  })

  it("siparişte olmayan mevcut modülleri düşen olarak raporlar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: ["sales"] }),
      existing({ purchasedModules: ["sales", "stock", "hr"], periodEnd: null }),
      NOW,
    )
    expect(write.kind === "activate" && write.droppedModules).toEqual(["stock", "hr"])
  })

  it("bilinmeyen periyot aylığa düşer", () => {
    const write = planSubscriptionWrite(order({ billingCycle: "HAFTALIK" }), null, NOW)
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2026-09-13T12:00:00.000Z"),
    )
  })
})
