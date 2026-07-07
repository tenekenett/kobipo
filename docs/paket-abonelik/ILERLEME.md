# Paket / Abonelik — İlerleme Günlüğü

Adım adım yapılan işler. Mimari için bkz. [PLAN.md](./PLAN.md).

Branch: `feature/paket-abonelik`

---

## ▶ DEVAM (kaldığın yer) — başka bilgisayarda devam ederken

**Durum:** Aşama 1–3 tamamlandı ve commit'lendi. **Aşama 4 (müşteri ekranı) yarım** —
API'lerin bir kısmı yazıldı, ödeme token'ı + callback + UI eksik.

**Yeni bilgisayarda kuruluma başlarken:**
1. `git pull` / branch'i çek: `feature/paket-abonelik`
2. `npm install`
3. `.env` / `.env.local` dosyalarını taşı (PayTR + DB değişkenleri repo'da YOK).
4. `npx prisma generate`
5. Şemayı DB'ye uygula: `npx prisma db push` **veya**
   `supabase/migrations/20260707000002_package_subscription.sql` dosyasını çalıştır.
   (Bu adım henüz YAPILMADI — DB'de yeni tablolar/kolonlar yok.)
6. `npm run dev` ile başlat.

**Aşama 4'te KALAN işler (sıradaki adımlar):**
- [ ] `POST /api/billing/orders/[id]/paytr-token` — kontör token route'unu örnek al
  (`app/api/kontor/orders/[id]/paytr-token/route.ts`). `ensureCompanyAccess(order.companyId)`,
  status PENDING_PAYMENT kontrolü, `createPaymentToken({... recurringPayment: order.autoRenew,
  noInstallment: 1 ...})`, okUrl/failUrl `/ayarlar/abonelik/odeme/[id]`. iframeUrl döndür.
- [ ] `POST /api/billing/paytr/callback` — kontör callback'ini örnek al
  (`app/api/kontor/paytr/callback/route.ts`). Hash doğrula → order bul → idempotent
  ("ACTIVE" veya paidAt varsa OK) → başarı: atomik claim (paidAt null → paidAt, status ACTIVE) →
  **Subscription upsert** (root=companyId; en güncel sub'ı ACTIVE'e çevir ya da oluştur:
  planId, provider PAYTR, billingCycle, purchasedModules=order.resolvedModules,
  branchQuota=order.branchQuota, amount, autoRenew, periodStart=now,
  periodEnd=`periodEndFor(cycle)`, userId=order.createdById fallback ilk ADMIN) →
  `applyEntitlements(root, order.resolvedModules)` → OK dön. PayTR panel bildirim URL'si:
  `/api/billing/paytr/callback`.
- [ ] UI: `app/(dashboard)/ayarlar/abonelik/page.tsx`'i paket seçim ekranıyla DEĞİŞTİR.
  `?company=` slug'ını oku, `/api/billing/catalog?companyId=` çek. Aylık/Yıllık toggle,
  paket kartları (bundle) + "Özel (paketsiz)", modül çipleri (paket dahilleri kilitli-dahil,
  diğerleri ücretli ekstra), şube adedi stepper, **canlı toplam** (`computeOrder`'ı client'a
  import et — pricing.ts saf, server-only import yok). "Öde" → `POST /api/billing/orders` →
  `/ayarlar/abonelik/odeme/${id}?company=${slug}`'a git. PayTR kapalıysa buton pasif + uyarı.
- [ ] UI: `app/(dashboard)/ayarlar/abonelik/odeme/[id]/page.tsx` (checkout) — kontör ödeme
  sayfasını örnek al (`app/(dashboard)/e-donusum/kontor/odeme/[id]/page.tsx`): token al, PayTR
  iframe göm (iframeResizer script), `/api/billing/orders?companyId=` ile durumu poll et,
  status ACTIVE → başarı ekranı.

**Sonraki aşamalar:** 5) Enforcement (şube kotası `app/api/companies/route.ts`'te + reconcile
endpoint), 6) Recurring cron + iptal + doküman. Detay: [PLAN.md](./PLAN.md) §5–7.

> Nav: müşteri ekranı `/ayarlar/abonelik` (nav-config'te zaten var, ADMIN-only). Admin ekranı
> `/system-admin/paketler` (nav'e eklendi).

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

## Aşama 4 — Müşteri ekranı ⏳ (YARIM — bkz. "▶ DEVAM")
- `lib/integrations/paytr/client.ts` — `recurringPayment?: boolean` opsiyonu eklendi
  (ilk ödemede kartı saklamak için `recurring_payment=1`; hash'i etkilemez). Henüz kullanılmıyor.
- `GET /api/billing/catalog?companyId=` ✅ — satılabilir paketler + aktif fiyatlar + hesap
  abonelik özeti (deneme/ücretli aktiflik) + PayTR durumu + mevcut şube sayısı.
- `GET/POST /api/billing/orders` ✅ — sipariş listeleme (poll için) + oluşturma
  (tutar sunucuda `computeOrder` ile; ADMIN kontrolü; root firmaya yazar; snapshot alanlar).
- **KALAN:** paytr-token route, callback, config UI, checkout UI (yukarıdaki "▶ DEVAM" listesi).

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
