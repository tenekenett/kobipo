# Paket / Abonelik Sistemi — Mimari Plan

> Kullanıcının ihtiyaç duyduğu modülleri seçip (hazır paket + tekil ekleme),
> aylık/yıllık olarak PayTR ile satın aldığı; fiyatların admin panelden
> belirlendiği; kullanıcının yalnızca satın aldığı kadarını kullanabildiği
> self-servis abonelik akışı.

İlgili günlük: [ILERLEME.md](./ILERLEME.md)

---

## 1. Ürün kararları (kullanıcı onaylı)

| Konu | Karar |
|------|-------|
| **Fiyatlandırma** | **Hibrit** — Hazır paketler (bundle) + üzerine tekil modül / ek şube ekleme |
| **Şube kapsamı** | **Hesap düzeyi + şube kotası** — Ana firma tek abonelik alır; seçilen modüller ana firma **ve tüm şubeleri** için geçerli. Ek şube fiyatlı bir *kota* olarak satılır; tüm şubeler aynı modül setini kullanır |
| **Ödeme periyodu** | **Otomatik yinelenen (recurring)** — PayTR kart saklama ile her dönem otomatik çekim (aylık/yıllık) |
| **Deneme** | **Kalsın** — İlk kayıtta 1 yıl deneme, tüm modüller açık. Deneme bitince yalnızca satın alınan modüller aktif kalır |

---

## 2. Mevcut altyapı (yeniden kullanılan)

- **Modül gating** — `lib/modules.ts` → `MANAGEABLE_MODULES` (6 modül: `sales`, `purchase`,
  `stock`, `finance`, `reports`, `hr`). Firma bazında `company.disabledModules[]` ile kapatılır.
  Uygulama noktaları: sidebar gizleme (`nav.tsx`), route engeli (`components/dashboard/module-guard.tsx`),
  server context (`lib/auth/user-context.ts`, `lib/middleware/company.ts`).
  **Kritik avantaj:** Satın alınan modülleri `disabledModules`'a türetilmiş olarak yazınca
  tüm mevcut gating hiç dokunmadan çalışır.
- **PayTR** — `lib/integrations/paytr/client.ts` (`createPaymentToken`, `verifyCallbackHash`).
  Uygulama geneli **tek** Kobipo merchant hesabı (env). Kontör akışı birebir örnek desen:
  sipariş → `paytr-token` → iframe → `callback` → fulfill.
- **Kontör deseni** — `KontorPackage`/`KontorOrder` modelleri, `components/system-admin/kontor-admin.tsx`
  (admin CRUD), `components/e-donusum/kontor-purchase-dialog.tsx` (iframe dialog). Paket akışı bunları
  taklit eder.
- **Süper admin guard** — `lib/auth/require-super-admin.ts`.
- **Migration yöntemi** — Prisma şeması ana kaynak; elle yazılan **idempotent** Supabase SQL
  dosyaları (`supabase/migrations/*.sql`, `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`).

---

## 3. Veri modeli

### 3.1 `Plan` (yeniden amaçlandırıldı = satılabilir hazır paket / bundle)
Mevcut `Plan` modeli genişletildi:
```
+ description        String?
+ includedModules    String[]  // bundle'ın içerdiği modül anahtarları
+ includedBranches   Int       // pakete dahil ek şube sayısı (ana firma hariç)
+ sortOrder          Int
+ highlighted        Boolean    // "Önerilen" rozeti
```
`monthlyPrice`, `yearlyPrice`, `isActive`, `maxUsers` korunur. `FREE_1Y` deneme planı da bu tabloda.

### 3.2 `PricingItem` (à la carte tekil fiyatlar) — YENİ
Admin, her tekil öğe için aylık/yıllık fiyat belirler.
```
key          String @id     // "module:sales", "module:stock", ..., "branch"
label        String
monthlyPrice Decimal
yearlyPrice  Decimal
isActive     Boolean
sortOrder    Int
```
- `module:<key>` — her `MANAGEABLE_MODULES` anahtarı için bundle dışı tekil ekleme fiyatı.
- `branch` — ek şube kotası birim fiyatı.

### 3.3 `Subscription` (firmanın/hesabın sahip olduğu aktif abonelik) — genişletildi
```
+ billingCycle       String?    // MONTHLY | YEARLY
+ purchasedModules   String[]   // efektif açık modül seti (snapshot)
+ branchQuota        Int        // ana firma hariç izin verilen ek şube sayısı
+ amount             Decimal?   // dönem tutarı (snapshot)
+ autoRenew          Boolean
+ cancelAtPeriodEnd  Boolean
+ paymentRef         String?
~ planId             String?    // artık opsiyonel (tam custom alımda bundle yok)
```
`status`: `TRIAL` | `ACTIVE` | `PAST_DUE` | `CANCELLED` | `EXPIRED`.
`providerSubscriptionId` PayTR recurring token için kullanılır.

### 3.4 `PackageOrder` (PayTR ödeme siparişi) — YENİ
Ödeme asenkron (callback) olduğundan seçim önce siparişte tutulur, ödeme onaylanınca
`Subscription`'a yansır. `id` = PayTR `merchant_oid`.
```
id, companyId, planId?, planName?
selectedModules  String[]   // bundle dışı ekstra seçilen modüller
resolvedModules  String[]   // nihai açılacak modül seti (snapshot)
branchQuota      Int
billingCycle     String     // MONTHLY | YEARLY
amount           Decimal
currency         String
autoRenew        Boolean
status           PackageOrderStatus  // PENDING_PAYMENT | ACTIVE | FAILED | CANCELLED
paymentProvider, paidAt, paymentRef, paymentError, recurringToken
createdById, createdAt, updatedAt
```

---

## 4. Sunucu tarafı katman (`lib/billing/`)

- **`pricing.ts`** — `computeOrderAmount({ plan, selectedModules, branchQuota, billingCycle, pricingItems })`.
  Fiyat **her zaman sunucuda** hesaplanır; istemciden gelen toplam ASLA güvenilmez.
- **`entitlements.ts`**
  - `resolveAccountRoot(companyId)` — `parentCompanyId` zincirini kök (ana) firmaya çıkarır.
  - `resolveGrantedModules(sub)` — abonelik durumuna göre efektif açık modüller (TRIAL → hepsi).
  - `applyEntitlements(rootCompanyId, { purchasedModules })` — `disabledModules = TÜM − purchased`
    hesabını ana firma **ve tüm şubelerine** yazar.
  - `getAccountSubscription(companyId)` — hesabın (kök firma) tekil aktif aboneliği.
- **`catalog.ts`** (opsiyonel yardımcı) — aktif bundle + pricing item listesini toplar.

---

## 5. API uçları

### Admin (süper admin)
- `GET/POST /api/billing/packages` — bundle (Plan) list/oluştur. GET aktifler herkese; `?all=1` admin.
- `PUT/DELETE /api/billing/packages/[id]` — güncelle/sil.
- `GET/PUT /api/billing/pricing` — à la carte fiyat öğeleri. GET aktifler; PUT toplu (admin).

### Müşteri
- `GET /api/billing/catalog?companyId=` — aktif bundle'lar + pricing item'lar + mevcut abonelik + `paytrEnabled`.
- `POST /api/billing/orders` — `PackageOrder` oluştur (tutarı sunucu hesaplar), `order.id` döner.
- `POST /api/billing/orders/[id]/paytr-token` — PayTR token (recurring flag'li), iframe URL döner.
- `POST /api/billing/paytr/callback` — PayTR bildirimi (oturumsuz, HMAC). Başarılı ödeme →
  `Subscription` upsert + `applyEntitlements`. Idempotent.
- `POST /api/billing/subscription/cancel` — `autoRenew=false` / `cancelAtPeriodEnd=true`.

### Sistem (cron)
- `POST /api/billing/recurring/run` — secret korumalı. Vadesi gelen abonelikleri PayTR recurring
  API ile yeniler; süresi biten deneme/abonelikleri düşürüp modülleri kilitler (reconcile).

---

## 6. Uygulama (enforcement)

- **Modüller** — Abonelik aktifleşince `applyEntitlements` `company.disabledModules`'ı yazar
  (ana + tüm şubeler). Mevcut gating gerisini halleder. Deneme boyunca `disabledModules = []`
  (hepsi açık). Deneme/abonelik bitişinde reconcile modülleri kilitler.
- **Şube kotası** — `app/api/companies/route.ts` şube oluştururken (`parentCompanyId` set) kök
  hesabın `subscription.branchQuota` değeri ile mevcut şube sayısını karşılaştırır; aşımda
  `402 PLAN_LIMIT_EXCEEDED` + upsell.

---

## 7. Aşamalar

1. **Şema + migration** — Plan/PricingItem/Subscription/PackageOrder + Supabase SQL.
2. **lib/billing** — entitlements, pricing, catalog.
3. **Admin paneli** — packages + pricing API + `system-admin/paketler` UI + nav.
4. **Müşteri ekranı** — catalog/orders/paytr-token/callback API + `ayarlar/abonelik` UI.
5. **Enforcement** — şube kotası, modül yazımı, reconcile.
6. **Recurring** — PayTR yinelenen ödeme iskelesi + iptal + doküman.

> Recurring auto-charge canlı PayTR hesabı (recurring özelliği açık) + gerçek kart gerektirir;
> ilk dönem ödemesi ve tüm enforcement bu olmadan da tam çalışır. Recurring kısmı iskele +
> dokümanla bırakılır (Bkz. [ILERLEME.md](./ILERLEME.md) "Canlı test gereksinimleri").
