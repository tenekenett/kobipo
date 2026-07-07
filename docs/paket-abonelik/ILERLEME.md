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

## Aşama 2 — lib/billing ⏳
- (devam ediyor)

## Aşama 3 — Admin paneli
- (bekliyor)

## Aşama 4 — Müşteri ekranı
- (bekliyor)

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
</content>
