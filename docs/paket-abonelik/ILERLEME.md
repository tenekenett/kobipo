# Paket / Abonelik — İlerleme Günlüğü

Adım adım yapılan işler. Mimari için bkz. [PLAN.md](./PLAN.md).

Branch: `feature/paket-abonelik`

---

## Aşama 0 — Keşif & Planlama ✅
- Kod tabanı incelendi: modül gating (`lib/modules.ts`, `disabledModules`), PayTR istemcisi
  (`lib/integrations/paytr/client.ts`), kontör deseni (`KontorPackage`/`KontorOrder`/`kontor-admin`),
  mevcut Plan/Subscription/UsageLimit iskeleti, süper admin guard, Supabase migration yöntemi.
- Ürün kararları kullanıcıyla netleştirildi (hibrit fiyat, hesap düzeyi + şube kotası,
  recurring ödeme, deneme kalsın). PLAN.md'ye işlendi.
- Görev listesi (7 aşama) ve dokümanlar oluşturuldu.

## Aşama 1 — Şema + migration ✅
- `prisma/schema.prisma`:
  - `Plan` genişletildi → `description`, `includedModules[]`, `includedBranches`, `highlighted`, `sortOrder`.
  - `PricingItem` (yeni) → à la carte tekil fiyatlar (`module:<key>`, `branch`).
  - `Subscription` genişletildi → `planId` opsiyonel (FK SET NULL), `billingCycle`,
    `purchasedModules[]`, `branchQuota`, `amount`, `autoRenew`, `cancelAtPeriodEnd`, `paymentRef`.
  - `PackageOrder` (yeni) + `PackageOrderStatus` enum → PayTR ödeme siparişi (id = merchant_oid).
  - `Company.packageOrders` ilişkisi.
- `supabase/migrations/20260707000002_package_subscription.sql` — idempotent, mevcut konvansiyonla
  uyumlu (enum DO-block, quoted camelCase kolonlar, `TEXT[] DEFAULT '{}'`, FK yeniden tanımı).
- `prisma validate` ✅, `prisma generate` ✅.
- **Not:** Şema DB'ye `prisma db push` veya migration SQL uygulanarak yansıtılmalı. DATABASE_URL
  uzak/paylaşımlı olabileceği için otomatik push YAPILMADI — deploy adımında uygulanacak.

## Aşama 2 — lib/billing ✅
- `lib/billing/constants.ts` — `BillingCycle`, `BRANCH_ITEM_KEY`, `modulePriceKey`,
  `defaultPricingItems()` (admin panelinde her modül + ek şube satırı), `ALL_MODULE_KEYS`.
- `lib/billing/pricing.ts` — `computeOrder()`: müşteri seçiminden **sunucuda** tutar +
  `resolvedModules` + `branchQuota` snapshot'ı hesaplar. İstemci tutarına asla güvenilmez;
  paket dahilleri tekrar ücretlendirilmez; bilinmeyen modül anahtarları elenir.
- `lib/billing/entitlements.ts` — hesap kökü çözümü (`resolveAccountRootId`),
  `getAccountSubscription`, `countAccountBranches`, deneme/ücretli aktiflik kontrolleri,
  `resolveGrantedModules`, `applyEntitlements` (disabled = TÜM − granted; ana firma + tüm
  şubelere yazar), `periodEndFor`.
- `tsc --noEmit` proje genelinde **0 hata**.
- Not: Write aracı bazı dosyaların sonuna hatalı `</content>` eklemişti; temizlendi.

## Aşama 3 — Admin paneli ✅
- `lib/billing/catalog.ts` — `ensureDefaultPricingItems()` (create-only tohum),
  `toPricingMap()`, `getSellablePlans()` (deneme planı `FREE_1Y` hariç), `TRIAL_PLAN_CODE`.
- API (süper admin korumalı):
  - `GET/POST /api/billing/packages` — bundle list/oluştur (kod otomatik, TR-safe).
  - `PUT/DELETE /api/billing/packages/[id]` — bundle güncelle/sil (FK SET NULL → güvenli silme).
  - `GET/PUT /api/billing/pricing` — à la carte fiyatlar (GET tohumlar, PUT toplu upsert,
    anahtar doğrulaması: `module:<geçerli>` veya `branch`).
- UI: `components/system-admin/package-admin.tsx` — Hazır Paketler (modül çipleri, dahil şube,
  önerilen/aktif, ekle/kaydet/sil) + Tekil Fiyatlar tablosu (aylık/yıllık/aktif, toplu kaydet).
- Sayfa: `system-admin/paketler` + `SystemAdminNav`'e "Paketler" öğesi (Package ikonu).
- `tsc --noEmit` **0 hata**.

## Aşama 4 — Müşteri ekranı ⏳
- (devam ediyor)

## Aşama 5 — Enforcement
- (bekliyor)

## Aşama 6 — Recurring
- (bekliyor)

---

## Canlı test gereksinimleri (dağıtımdan önce)
- `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT`, `PAYTR_TEST_MODE` env.
- PayTR mağaza panelinde bildirim (callback) URL: `https://<alan-adı>/api/billing/paytr/callback`.
- Recurring (yinelenen) ödeme özelliğinin PayTR hesabında **açık** olması.
- `BILLING_CRON_SECRET` env (recurring/reconcile cron endpoint koruması).
