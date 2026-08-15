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
- [ ] Cron — **bilinçli olarak ERTELENDİ (2026-08-08).** Abonelik bitişi şimdilik zorlanmıyor;
  satın alan kullanmaya devam ediyor. Kod hazır ve uykuda: tek uç `GET|POST /api/billing/cron/daily`
  içeride sırayla notify → recurring → reconcile çalıştırıyor (sıra kodda, [[lib/billing/jobs.ts]]),
  hoşgörü süresi + testler yerinde. Açmak için gereken üç adım ve sıralama (önce gerçek
  yinelenen çekim, sonra cron): `docs/paket-abonelik/MODUL-KILIDI.md` → "Şu an ne çalışıyor".
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

**Not (kontör):** ~~Kontör akışında da aynı `merchant_oid` deseni var ama dönüş URL'i farklı sayfaya
gittiğinden aktif bug tetiklenmiyor (latent) — bilinçli dokunulmadı.~~
**2026-08-14 güncellemesi:** latent değilmiş — "Ödemeye devam et" / sayfa yenileme / "Tekrar dene"
aynı oid'i tekrar isteyip ödeme ekranını hiç açtırmıyordu. Kontör de aynı desene geçirildi
(`newMerchantOid` + callback'te `merchantOidBase`), dönüş URL'lerine `company` param'ı eklendi.

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

---

## Ek — canlı ödeme hiç aktifleşmiyordu: tek bildirim URL'si (2026-08-13)

**Belirti.** Abonelik ekranından ek şube alınıyor, PayTR ödemeyi alıyor, kullanıcı
`?odeme=ok` ile geri dönüyor ve ödeme sayfası **"Ödemeniz doğrulanıyor…"** ekranında
sonsuza dek kalıyordu. Canlıda `package_orders` içinde bugüne dek ACTIVE olmuş **tek bir
sipariş yoktu** (5 sipariş PENDING_PAYMENT, `paidAt` boş); buna karşılık kontör kart
siparişleri sorunsuz `LOADED` oluyordu.

**Kök neden.** PayTR'ın bildirim (callback) URL'si **mağaza hesabı başına TEKTİR** —
ödeme başına ayarlanamaz (`get-token`'daki `merchant_ok_url`/`merchant_fail_url` yalnız
tarayıcı yönlendirmesidir). Kobipo'nun iki ödeme akışı aynı PayTR mağazasını kullanıyordu
ama **iki ayrı uç** tutuyordu. Panelde kontör adresi yazılıydı; paket ödemesinin bildirimi
oraya düşüyor, `kontorOrder.findUnique({ id: merchant_oid })` bulamıyor ve **"OK"**
dönüyordu → PayTR bildirimi teslim edilmiş sayıp bir daha denemiyordu. Para çekiliyor,
sipariş sonsuza dek PENDING kalıyordu. (Ters kurulumda kontör ödemeleri aynı şekilde
yutulurdu — iki akış aynı anda asla çalışamazdı.)

**Çözüm — tek yönlendirici.** `lib/integrations/paytr/notification.ts` →
`handlePaytrNotification`: hash'i bir kez doğrular, `merchant_oid`'i önce
`packageOrder` (taban id `merchantOidBase` ile), sonra `kontorOrder` olarak arar ve doğru
akışa yönlendirir. İş kuralları domainlerinde kaldı: `lib/billing/paytr-payment.ts` ve
`lib/kontor/paytr-payment.ts`. Üç uç da (`/api/paytr/callback` — **kanonik**,
`/api/kontor/paytr/callback`, `/api/billing/paytr/callback`) aynı fonksiyonu çağırır, yani
**PayTR panelindeki adres değişmeden** iki akış da çalışır. Eşleşmeyen `merchant_oid` hâlâ
OK döner (sonsuz tekrar olmasın) ama artık **yüksek sesle loglanır** — sessiz para kaybı yok.

**Yanında çıkan ikinci hata — kota alımı modülleri siliyordu.** Modülsüz sipariş
(yalnız şube kotası) `purchasedModules = []` yazıp `applyEntitlements(root, [])`
çağırıyordu: ana firma **ve tüm şubelerde** her modül kapanırdı. Bildirim hiç ulaşmadığı
için canlıda patlamamıştı — düzeltme olmasa ilk başarılı ödemede patlardı. Karar artık saf
ve testli: `planSubscriptionWrite` (`lib/billing/paytr-payment.ts`,
`paytr-payment.test.ts`):
- **kota-only sipariş** → yalnız `branchQuota` yazılır; durum/dönem/modüller ve
  `applyEntitlements` ELLENMEZ (deneme süresi de kısalmaz). Sistem-admin elle kota verme
  kuralıyla aynı: "kota vermek modül açmak değildir".
- **modül/paket alımı** → ACTIVE yazılır, yetkiler uygulanır, `periodEnd` **asla geriye
  çekilmez** (dönem ortası yükseltmede kalan ödenmiş süre korunur).

**Arayüz.** `ayarlar/abonelik` artık mevcut aboneliği **ön-seçer** (paket, modüller, kota,
periyot, otomatik yenileme). Sipariş aboneliğin yeni hâlinin tam anlık görüntüsü olduğu
için boş sayfadan başlamak, "bir şube daha alayım" diyen müşteriye modüllerini sıfırlayan
bir sipariş kurdurtuyordu. Kota alanı artık açık şube sayısının altına inemez ve seçim
mevcut bir modülü düşürüyorsa özet kartında **uyarı** çıkar. Ödeme sayfası 90 saniye sonra
sonsuz spinner yerine sipariş no'su + "tekrar kontrol et" + destek yönlendirmesi gösterir.

**Kurtarma.** `POST /api/billing/admin/orders/<id>/activate` (süper-admin) — ödemesi PayTR
panelinden teyit edilmiş ama bildirimi ulaşmamış siparişi elle açar; sistem-admin abonelik
kartında sipariş satırındaki **"Aktifleştir"** butonu. PayTR'a sormaz, teyit insana aittir.

**Kalan iş (opsiyonel).** PayTR "ödeme durum sorgu" API'siyle otomatik doğrulama: uygulama
bildirimi beklemek yerine PayTR'a sorar. Denemeye özel `merchant_oid` saklanmadığı için
`package_orders`'a bir kolon (+migrasyon) ister.

- `tsc --noEmit` 0 hata, eslint temiz, `vitest run` 221 test geçti.

## 2026-08-15 — "Şube" ile "firma" ayrıldı; ek firma satılabilir hâle geldi ✅

**Sorun.** İki farklı kavram tek sayaca biniyordu. Yeni bağımsız firma açma hakkı
`Plan.maxCompanies` ile ölçülüyor, o değer de paket oluşturulurken **şube adedinden**
türetiliyordu (`maxCompanies = includedBranches + 1`). Sonuçları:
- Şube açmak firma hakkını yiyordu (sayaç kullanıcının TÜM üyeliklerini sayıyordu —
  başkasının firmasındaki üyelik dahil).
- Paketsiz (à la carte) alımda `planId` null olduğu için hak 1'e düşüyor, müşteri
  yalnız şube açabiliyordu.
- Satılabilir bir "ek firma" ürünü yoktu: hata mesajı "paketinizi yükseltin" diyordu ama
  abonelik ekranında yükseltecek bir kalem bulunmuyordu.
- Kotalar hesap kökünden (`companyId`), firma hakkı ise kullanıcıdan (`userId`)
  okunuyordu; paketi satın almayan ikinci ADMIN için hak her zaman 1 görünüyordu.

**Model.** Artık şube hiyerarşisi ile hesap (faturalama) üyeliği ayrı eksenler:

| | şube | ek firma |
|---|---|---|
| alan | `parentCompanyId` dolu | `parentCompanyId` null, `accountRootId` dolu |
| tüzel kişi | ana firmayla AYNI (VKN/vergi dairesi/e-Dönüşüm devralınır) | AYRI (kendi VKN'si, adresi, e-Dönüşüm hesabı) |
| abonelik | hesap kökünden | hesap kökünden |
| modüller | kökten akar | kökten akar |
| kota | `Subscription.branchQuota` | `Subscription.companyQuota` |
| fiyat kalemi | `PricingItem["branch"]` | `PricingItem["company"]` |
| pakete dahil | `Plan.includedBranches` | `Plan.includedCompanies` |

`Company.accountRootId` hesabın TÜM üyelerinde (şubeler + ek firmalar) kökün id'sini
taşır → hesap tek sorguda çözülür, zincir yürünmez. Ek firmanın şubesi de doğrudan kökü
gösterir. FK `ON DELETE SET NULL`: kök silinirse ek firma silinmez, kendi kökü olur
(ayrı tüzel kişinin verisi başkasının silinmesiyle yok olmamalı).

**Firma oluşturmanın üç modu** (`POST /api/companies`):
- `parentCompanyId` → şube; `branchQuota` denetlenir (`BRANCH_QUOTA_EXCEEDED`, 402).
- `accountCompanyId` → ek firma; hesabın **ADMIN**'i olmak şart (`ADMIN_REQUIRED`, 403) ve
  `companyQuota` denetlenir (`COMPANY_QUOTA_EXCEEDED`, 402). Kimlik devralınmaz, yalnız
  kökün `disabledModules`'ü devralınır.
- ikisi de yok → ilk firma; **yalnızca** kullanıcının kendi hesabı yoksa serbest
  (`ACCOUNT_REQUIRED`, 400). Ölçü "kaç firmaya üyeyim" değil "ADMIN'i olduğum kök firma
  var mı" — başkasının firmasında çalışan biri kendi ilk firmasını hâlâ açabilir.

**Dokunulan yerler.** `Plan.maxCompanies` DB'den düşürüldü (migrasyon
`20260815000001_account_company_quota.sql`). `getBranchQuotaStatus` → `getAccountQuotas`
(iki kotayı birlikte döner, tek kural); `countAccountBranches` artık ek firmaların
şubelerini de sayar; `applyEntitlements` hesabın tüm üyelerine yazar.
`/api/companies/branch-quota` → `/api/companies/quota`,
`/api/billing/admin/branch-quota` → `/api/billing/admin/quota` (iki kota, verilmeyen alana
dokunmaz). Abonelik ekranında "Ek firma kotası" adımlayıcısı, Firma ve Şube Yönetimi'nde
iki kota kartı + "Yeni Firma" butonunun kotaya bağlanması. Ölü `new-branch-dialog.tsx`
silindi: "Yeni Şube" diyordu ama `parentCompanyId` göndermediği için aslında bağımsız
firma açıyordu.

- `tsc --noEmit` 0 hata, `vitest run` geçti.

### Ek: ek firma, hesabın diğer ADMIN'lerine de görünür ✅

İlk turda ek firmaya erişim yalnız açık üyelikle veriliyordu (oluşturan ADMIN). Şubelerdeki
"üst firmanın admini otomatik erişir" davranışı ek firmaya da yayıldı:
`lib/auth/branch-access.ts` artık iki daldan bakıyor —
`parentCompanyId IN adminIds` (ADMIN olunan firmanın şubeleri; ek firmanın kendi admini
onun şubelerini bu daldan görür) **veya** `accountRootId IN adminIds` (ADMIN olunan hesabın
üyeleri: ek firmalar + onların şubeleri). `canManageCompany` de aynı iki yolu kabul ediyor.

`getManagedBranches` → `getManagedCompanies` (dönen kayıt artık `isBranch` ve
`accountRootId` taşıyor). Ek firma `isBranch: false` gelir: firma seçicide normal firma
gibi görünür, şube bağlam şeridi çizilmez. Firma ve Şube Yönetimi listesinde **"Ek firma ·
&lt;hesap&gt;"** rozeti çıkar. Şube müdürü uçları (`/api/company/branch-managers`) da aynı
kapsamı listeler — liste ile yetkinin ayrışmaması için.

### Ek: firma oluşturma tek kapıya indirildi ✅

Kota denetimi `POST /api/companies` içine yazılmıştı; ama firma oluşturan İKİNCİ bir uç
daha vardı — `POST /api/system-admin/companies` (sistem yönetimi > Firma Yönetimi >
"Yeni Firma"). O uç kendi `prisma.company.create`'ini çağırıyor, dolayısıyla kotayı,
`accountRootId`'yi ve varsayılan "Ana Depo"yu hiç bilmiyordu.

Kural artık tek modülde: **`lib/company/create-company.ts`**.
- `resolveCompanyPlacement()` — erişim + rol + kota; başarısızsa `CompanyCreationError`
  (kod + HTTP durumu taşır, uçlar yalnız iletir).
- `createCompany()` — kayıt + (istenirse) ADMIN üyeliği + varsayılan depo, tek transaction.

Üç yerleşim: `branch` (branchQuota), `account-company` (companyQuota + ADMIN şartı),
`new-account` (kota yok, bu yüzden kapı dar: kendi hesabı olmayan kullanıcı ya da
açıkça `allowAdditionalAccount` veren süper-admin).

Süper-admin ucu daima `new-account` kullanır: müşteri için YENİ HESAP açar, var olan bir
hesaba ek firma/şube ekleyemez (gövdeden parentCompanyId/accountCompanyId okunmaz), yani
o kapıdan kota atlanamaz. Yan fayda: o uçtan açılan firmalar artık varsayılan depoyla
doğuyor (eskiden deposuz doğup ilk stok işleminde patlıyordu).

Yeni kapıların sessizce açılmaması için mekanik kontrol — `check:rls` ile aynı desen:

```bash
npm run check:company-create   # ortak modül dışında company.create çağrısı → exit 1
```

Kontrolün gerçekten yakaladığı, geçici bir ihlal dosyasıyla doğrulandı.

### Ek: denetim turu — kota yarışı ve "kalıcı olmayan modül grantı" kapatıldı ✅

Canlı veri üzerinde 12 yapısal değişmez tarandı (accountRootId zinciri, kökü ana
firmasından farklı şube, kök olmayan firmaya bağlı abonelik/sipariş, deposuz firma,
kotasının üstünde şube/firma, modülleri kökten sapmış üye…). Tümü temiz; tek bulgu
arayüz etiketiydi: **doğrudan üyeliği olan şube** (canlıda 3 üyeli bir örnek var)
`accountRootId` dolu + `isBranch` boş olduğu için "Ek firma" rozeti alıyordu. Rozet artık
ham `parentCompanyId`den çözülüyor; `isBranch` bilinçli olarak değiştirilmedi — o bayrak
"üyeliksiz, parent-admin erişimiyle görülen şube" demek ve firma seçici ile şube bağlam
şeridi ona bakıyor.

**1. Kota yarışı.** Kota kontrolü ile INSERT arasındaki pencerede eşzamanlı iki istek
ikisi de geçip kotanın bir fazlasını açabiliyordu. `createCompany` artık transaction
içinde hesabın abonelik satırını `FOR UPDATE` ile kilitleyip sayımı tekrarlıyor
(`assertQuotaUnderLock`): ikinci istek birincinin COMMIT'ini bekler ve onun firmasını da
sayar (READ COMMITTED'da kilit serbest kalınca ifade güncel veriyle yeniden okunur).
Aktiflik ölçüsü `getAccountQuotas` ile aynı tutuldu ki kapı ile gösterge ayrışmasın.

**2. Elle açılan modüller kalıcı değildi.** Süper-admin modül kartı yalnızca
`company.disabledModules` yazıyordu; yetkinin gerçek kaynağı `purchasedModules` olduğu
için grant, ilk yeniden hesaplamada (reconcile, yinelenen ödeme `jobs.ts`, kilitle/sıfırla,
yeni sipariş) siliniyordu — 15 Ağustos'taki modül kaybının ikizi hâlâ kuruluydu. Artık
`setAccountModules()` var: aboneliğin `purchasedModules`'una yazar **ve** hesabın tümüne
uygular. Uç, yazacak ücretli-aktif abonelik yoksa `warning` döndürüyor, modül kartı da
bunu kırmızı bildirimle gösteriyor (sessizce "başarılı" demek yanıltıcıydı).
`resetAccountBilling("trial")` de açtığı modülleri artık aboneliğe yazıyor.
