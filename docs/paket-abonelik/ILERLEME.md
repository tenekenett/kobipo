# Paket / Abonelik — İlerleme Günlüğü

Adım adım yapılan işler. Mimari için bkz. [PLAN.md](./PLAN.md).

Branch: `main` (paket işi `main`'e merge edildi)

---

## ▶ DEVAM (kaldığın yer) — başka bilgisayarda devam ederken

**Durum:** Aşama 1–6 TAMAMLANDI (recurring **iskele** olarak; canlı çekim bağlanmayı bekliyor).
Kodlama tarafı bitti — **kalan tek iş DAĞITIM** (DB migration + env + cron + PayTR canlı ayarları).

**Yeni bilgisayarda kuruluma başlarken:**
1. `git checkout main && git pull` (tüm iş `main`'de)
2. `npm install`
3. `.env` / `.env.local` dosyalarını taşı (PayTR + DB + `BILLING_CRON_SECRET` repo'da YOK).
4. `npx prisma generate`
5. Şemayı DB'ye uygula: `npx prisma db push` **veya**
   `supabase/migrations/20260707000002_package_subscription.sql` dosyasını çalıştır.
   ✅ **Bu ortamın DB'sinde UYGULANMIŞ** (2026-07-07, `prisma db pull` introspection ile
   doğrulandı: `package_orders`, `pricing_items`, `subscriptions.branchQuota/purchasedModules/
   billingCycle`, `plans.includedModules` mevcut). **Prod ayrı bir DB ise orada da uygulanmalı.**
6. `npm run dev` ile başlat.

**KALAN — dağıtım adımları (kod değil):**
- [x] DB migration (bu ortamın DB'sinde uygulandı — prod DB ayrıysa orada tekrar uygula).
- [x] `.env.local`: PayTR anahtarları + `BILLING_CRON_SECRET` mevcut (cron secret bu oturumda eklendi).
- [ ] PayTR panelinde bildirim URL'si: `https://<alan>/api/billing/paytr/callback`.
- [ ] Cron: **ÖNCE** `POST /api/billing/recurring/run`, **SONRA** `POST /api/billing/reconcile`
  (ör. günlük). Header `Authorization: Bearer $BILLING_CRON_SECRET`.
- [ ] (Opsiyonel, otomatik yenileme için) PayTR recurring ürününü aç + `chargeRecurringPayment`
  stub'ını canlı API'ye bağla ([[lib/integrations/paytr/client.ts]]). İlk dönem ödemesi + iptal +
  tüm enforcement bu olmadan zaten çalışır.

**Yerel doğrulama (2026-07-07, dev sunucusu + gerçek DB):**
- Cron auth ✅ — secret yok/yanlış → 401; doğru (`Authorization: Bearer` **ve** `x-cron-secret`) → 200.
- `POST /api/billing/reconcile` ✅ 200 `{expired:0, accountsReconciled:0}` (süresi geçmiş sub yoktu).
- `POST /api/billing/recurring/run` ✅ 200 `{due:0,...}` (vadesi gelen sub yok; stub state'i değiştirmez).
- Müşteri uçları (catalog/orders/subscription-cancel/paytr-token) oturumsuz → **401** (route'lar
  derlendi + guard'lar çalışıyor). Dev log'da hata/Prisma uyarısı yok.
- **Kapsam dışı (canlı gerektirir):** oturumlu tam müşteri akışı (katalog verisi, sipariş, PayTR
  iframe, gerçek kartla ödeme) ve reconcile'ın gerçek expire+kilit geçişi (paylaşımlı DB'ye test
  verisi yazmamak için uydurulmadı).

> Nav: müşteri ekranı `/ayarlar/abonelik` (nav-config'te zaten var, ADMIN-only). Admin ekranı
> `/system-admin/paketler` (nav'e eklendi).

---

## 🔧 Yerel test & düzeltmeler (2026-07-07 seansı)

Gerçek DB + dev sunucusunda uçtan uca test edilirken bulunan bug'lar düzeltildi ve sistem-admin'e
yönetim paneli eklendi. (Aşama 4'ün "✅ uçtan uca çalışır" notu bu düzeltmelerden ÖNCEye aittir.)

**Bug düzeltmeleri:**
- **PayTR `merchant_oid` benzersizliği** — `order.id` doğrudan merchant_oid olarak gidiyordu; aynı
  sipariş için token ikinci kez istenince (sayfa yenileme / ödeme dönüşü / dev çift-mount) PayTR
  "merchant_oid daha önce kullanılmış" hatası veriyordu. Artık `newMerchantOid(order.id)` =
  `<id>X<base36 zaman><rastgele>` üretilir; callback `merchantOidBase()` ile sipariş id'sine geri
  çözer. (`lib/integrations/paytr/client.ts`, `app/api/billing/orders/[id]/paytr-token`,
  `app/api/billing/paytr/callback`)
- **okUrl/failUrl `company` param'ı** — PayTR dönüşünde firma bağlamı kaybolup ana firmaya
  düşüyordu; dönüş URL'lerine `&company=<slug>` eklendi.
- **Aktif firma kalıcılığı** — linkler `?company=` taşımadığından her gezinme ana firmaya düşüyordu.
  `getAuthContext` artık `activeCompanyId` cookie'sine düşer (öncelik: URL param > cookie > ilk
  firma); provider cookie'yi yazar; nav linkleri `withCompany()` ile param taşır.
  (`lib/middleware/authorization.ts`, `components/dashboard/dashboard-company-provider.tsx`,
  `components/dashboard/nav.tsx`)
- **Ödeme sonrası entitlement tazeleme** — abonelik aktifleşince açılan modüller navbar'a ancak tam
  reload'da düşüyordu; ödeme sayfası ACTIVE olunca bir kez `router.refresh()` çağırır.

**Yeni — Sistem-admin Abonelik & Sipariş paneli** (`/system-admin/abonelikler`):
- `GET /api/billing/admin/overview` — kök firmalar + en güncel abonelik + siparişler + kullanım.
- `POST /api/billing/admin/reset` `{companyId, mode: "trial"|"locked"}` — test için sıfırlama
  (taze deneme = tüm modüller açık / kilitli = satın almaya hazır). Mantık `lib/billing/admin.ts`
  (`applyEntitlements`'i tekrar kullanır, reconcile çıktısıyla tutarlı).
- `POST /api/billing/admin/orders/[id]/cancel` — yarıda kalan siparişi CANCELLED yapar (ACTIVE hariç).
- UI `components/system-admin/subscription-admin.tsx` + nav'a "Abonelikler" (CreditCard).

**Yerel test aracı:** `scripts/paytr-simulate-callback.js` — PayTR callback'ini yerelde simüle eder
(localhost'a PayTR ulaşamadığı için sipariş PENDING kalıyordu). Kullanım:
`node scripts/paytr-simulate-callback.js <orderId> [success|failed]` veya `npm run paytr:simulate -- <orderId>`.

**Not (kontör):** Kontör akışında da aynı `merchant_oid` deseni var ama dönüş URL'i farklı sayfaya
gittiğinden aktif bug tetiklenmiyor (latent) — bilinçli dokunulmadı.

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

## Aşama 4 — Müşteri ekranı ✅
- `lib/integrations/paytr/client.ts` — `recurringPayment?: boolean` opsiyonu eklendi
  (ilk ödemede kartı saklamak için `recurring_payment=1`; hash'i etkilemez).
- `GET /api/billing/catalog?companyId=` ✅ — satılabilir paketler + aktif fiyatlar + hesap
  abonelik özeti (deneme/ücretli aktiflik) + PayTR durumu + mevcut şube sayısı.
- `GET/POST /api/billing/orders` ✅ — sipariş listeleme (poll için) + oluşturma
  (tutar sunucuda `computeOrder` ile; ADMIN kontrolü; root firmaya yazar; snapshot alanlar).
- `POST /api/billing/orders/[id]/paytr-token` ✅ — kontör deseniyle: `ensureCompanyAccess(root)`,
  PENDING_PAYMENT kontrolü, `createPaymentToken({ recurringPayment: order.autoRenew,
  noInstallment: 1, ... })`, okUrl/failUrl `/ayarlar/abonelik/odeme/[id]`. iframeUrl döner.
- `POST /api/billing/paytr/callback` ✅ — hash doğrula → order → idempotent (status ACTIVE ise OK).
  Başarıda **sıra önemli**: (1) ödemeyi kaydet, (2) `activateSubscription` (en güncel sub'ı ACTIVE'e
  çevir ya da oluştur: provider PAYTR, purchasedModules=resolvedModules, branchQuota, amount,
  autoRenew, periodStart/periodEnd, userId=createdById → yoksa ilk ADMIN) + `applyEntitlements`,
  (3) siparişi ACTIVE'e al. **Deviation:** status ACTIVE en SON yazılır (tamamlanma işareti) —
  literal spec'teki "tek atomik claim" yerine; abonelik yazımı yarıda kalırsa PayTR tekrar dener
  ve müşteri ödediği halde modülsüz kalmaz (aktifleştirme idempotent). Bildirim URL'si:
  `/api/billing/paytr/callback`.
- UI `app/(dashboard)/ayarlar/abonelik/page.tsx` ✅ — catalog çek, Aylık/Yıllık toggle, paket
  kartları + "Özel (paketsiz)", modül seçimi (paket dahilleri kilitli-dahil), şube stepper
  (min = paket dahili), **canlı toplam** (`computeOrder` client-side; pricing.ts saf), otomatik
  yenile switch'i, PayTR kapalıysa buton pasif + uyarı. "Öde" → `POST /api/billing/orders` →
  checkout'a yönlendirir.
- UI `app/(dashboard)/ayarlar/abonelik/odeme/[id]/page.tsx` ✅ — paytr-token al, PayTR iframe
  (iframeResizer), `/api/billing/orders?companyId=` ile 4sn poll, status ACTIVE → başarı ekranı,
  FAILED/CANCELLED → hata ekranı.
- `tsc --noEmit` **0 hata**, eslint temiz. (Uçtan uca ödeme testi DB + PayTR env gerektirir —
  "Canlı test gereksinimleri" bölümüne bkz.)

## Aşama 5 — Enforcement ✅
- **Şube kotası** — `app/api/companies/route.ts`: `parentCompanyId` set (şube) oluşturulurken
  hesabın (kök = ana firma; şube zinciri yasak) aktif aboneliğindeki `branchQuota` kadar ek şube
  açılabilir. `getAccountSubscription` + `isPaidActive/isTrialActive` ile aktiflik; aktif abonelik
  yoksa kota 0 (fail closed). Aşımda `402 PLAN_LIMIT_EXCEEDED` (istemci zaten bu kodu işleyip
  `/ayarlar/abonelik`'e yönlendiriyor — `new-branch-dialog`, `companies/new`). Per-kullanıcı
  `maxCompanies` limiti artık YALNIZCA yeni **bağımsız** firma açarken uygulanır (şubelerde atlanır).
- **Reconcile** — `POST /api/billing/reconcile` (`lib/billing/cron-auth.ts` → `BILLING_CRON_SECRET`
  ile korumalı, oturumsuz). Süresi geçmiş `TRIAL` (trialEndsAt<now) + `ACTIVE` (periodEnd<now)
  abonelikleri `EXPIRED`'a çeker; etkilenen her hesap kökünde `resolveGrantedModules(enGüncelSub)`
  → `applyEntitlements` ile modülleri yeniden yazar (expired → hepsi kilitli). Idempotent.
- **Modül gating** — ek route guard gerekmedi: yetki callback'te `disabledModules`'a yazılıyor,
  mevcut gating gerisini hallediyor. Aşama 5 yalnızca ADET (şube) + SÜRE (reconcile) enforcement.
- `tsc --noEmit` **0 hata**, eslint temiz. (Not: gerçek şube açma/expiry testi DB migration ister.)

## Aşama 6 — Recurring + iptal ✅ (recurring iskele)
- **İptal** — `POST /api/billing/subscription/cancel` (ADMIN): aktif ücretli abonelikte
  `autoRenew=false` + `cancelAtPeriodEnd=true`. Sub `periodEnd`'e kadar ACTIVE ve modüller açık;
  süre dolunca reconcile EXPIRED yapar. Idempotent (zaten iptalliyse mevcut durumu döner).
- **UI** — `ayarlar/abonelik` mevcut durum kartı: ücretli abonelikte otomatik yenileme durumu +
  "Aboneliği iptal et" butonu (onay + iptal sonrası catalog yeniden yüklenir); iptalliyse
  "modüller şu tarihe kadar açık" gösterir. Catalog'a `cancelAtPeriodEnd` alanı eklendi.
- **Recurring çekim (İSKELE)** — `lib/integrations/paytr/client.ts` `chargeRecurringPayment()`
  bilinçli olarak `PAYTR_RECURRING_NOT_IMPLEMENTED` fırlatır (canlı PayTR recurring ürünü + saklı
  kart token'ı gerekir; yanlış/çift çekim riskine karşı state değiştirmez). Sözleşme + amaçlanan
  akış JSDoc'ta.
- **Recurring çalıştırıcı** — `POST /api/billing/recurring/run` (cron korumalı): vadesi gelmiş
  (`periodEnd ≤ now`) `autoRenew=true` & `provider=PAYTR` & `cancelAtPeriodEnd=false` abonelikleri
  bulur; her biri için `chargeRecurringPayment` dener. Stub fırlattığından hepsi `pending` (durum
  DEĞİŞMEZ). Canlı için başarı (dönem uzat + `applyEntitlements`) ve başarısızlık (PAST_DUE) dalları
  hazır; dönem başına deterministik `merchant_oid` ile çift çekim engellenir. **Sıra:** recurring
  ÖNCE, reconcile SONRA.
- `tsc --noEmit` **0 hata**, eslint temiz.

---

## Durum özeti — tüm aşamalar ✅ (kod)
Şema, lib/billing, admin paneli, müşteri ekranı (catalog/orders/token/callback + UI), enforcement
(şube kotası + reconcile), iptal ve recurring iskelesi tamam. **Kalan tek iş dağıtım** (DB migration
+ env + cron + opsiyonel PayTR canlı recurring). Bkz. "▶ DEVAM".

---

## Canlı test gereksinimleri (dağıtımdan önce)
- `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT`, `PAYTR_TEST_MODE` env.
- PayTR mağaza panelinde bildirim (callback) URL: `https://<alan-adı>/api/billing/paytr/callback`.
- Recurring (yinelenen) ödeme özelliğinin PayTR hesabında **açık** olması.
- `BILLING_CRON_SECRET` env (recurring/reconcile cron endpoint koruması).

---

## Ek — sistem-admin: elle şube kotası (2026-08-04)
Satın alma akışı dışında destek/demo amaçlı kota verebilmek için sistem-admin abonelik kartındaki
"şube kotası" artık düzenlenebilir.
- **Uç** — `POST /api/billing/admin/branch-quota` (süper-admin): `{ companyId, branchQuota,
  createTrialIfMissing? }`. `lib/billing/admin.ts` → `setAccountBranchQuota()` kök firmayı çözüp
  **en güncel** abonelik satırını günceller (şube ekleme kontrolü de aynı satırı okur).
- **Aboneliği olmayan hesap** — kota tek başına etkisizdir (şube ekleme aktif abonelik ister,
  fail-closed). Uç `409 NO_SUBSCRIPTION` döner; UI onay alıp `createTrialIfMissing:true` ile
  tekrar çağırır → 1 yıllık deneme satırı açılır. **Modül yetkilerine dokunulmaz** (kota vermek
  modül açmak değildir; `applyEntitlements` çağrılmaz).
- **UI** — `components/system-admin/subscription-admin.tsx` `BranchQuotaEditor`: sayı alanı +
  değişince "Kaydet" (Enter kaydeder, Esc geri alır), "kullanılan: N" ve uyarılar (abonelik pasif
  → kota etkisiz; kota mevcut şube sayısının altında → yeni şube eklenemez). Üst sınır
  `MAX_BRANCH_QUOTA` (`lib/billing/constants.ts`, 999).
- **"Taze trial" artık kotayı korur** — sıfırlama aboneliği silip yeniden kurduğu için elle
  verilen kota kayboluyordu; `resetAccountBilling` önceki `branchQuota`'yı yeni satıra taşır.
- `tsc --noEmit` 0 hata (yalnızca `.next/types` kaynaklı eski uyarı), eslint temiz.
