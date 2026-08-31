# Abonelik sistemini tamamlama — plan ve ilerleme

**Durum:** TÜM FAZLAR BİTTİ (0-7) · Faz 8 KONUSUZ KALDI · 2026-08-27
**Kapsam:** otomatik yenileme, müşteri abonelik ekranı, sistem-admin süre verme, cron'un
ayağa kaldırılması, periyoda göre hoşgörü, arşiv kademesi.

---

## ▶ DEVAM NOKTASI (başka makinede buradan başla)

**Son durum: planın TAMAMI yazıldı (Faz 0-7) ve TARAYICIDA UÇTAN UCA SINANDI.**
`npx tsc --noEmit` temiz · `npx vitest run` → 46 dosya / **559 test** geçti.
Migrasyon **canlıya uygulandı**. Faz 8 (dönemleri bugünden başlatan betik) canlı veriye
bakıldığında **gereksiz çıktı** — gerekçesi aşağıda.

Test turu ve çıkan altı bulgu: **§2.5** ve **§2.6**. Beşi kapatıldı; açık kalan tek madde
17 kırılgan hesap (kullanıcı kararıyla ertelendi).

**Kalan tek sahada iş:** Vercel'de `BILLING_CRON_SECRET`'in tanımlı olduğunu ve ilk
koşumdan sonra `cron_runs`ta satır oluştuğunu doğrulamak (§3).

### 1. Migrasyon: UYGULANDI ✅

`20260827000001_abonelik_olay_cron_arsiv.sql` canlıda. 2026-08-27'de doğrulandı:
`subscription_events` + `cron_runs` tabloları ve altı yeni kolon (`companies.archivedAt`,
`subscriptions.lockedAt / lastNoticeThreshold / lastNoticeSentAt / cardBrand / cardLast4`)
yerinde.

> **Tuzak — üretilmiş Prisma istemcisi eskiydi.** Migrasyon uygulanmış olmasına rağmen
> `npx tsc --noEmit` 30+ "Property 'subscriptionEvent' does not exist" hatası verdi.
> Çözüm `npx prisma generate`; ALTER gerekmez. Başka bir makinede kod ilk kez
> çalıştırılırken aynısı olacak.

### 2. Faz 8 KONUSUZ KALDI — kilitlenecek hesap yok

Faz 8'in tek gerekçesi "canlıda dönemi çoktan geçmiş satırlar var, cron ilk koştuğunda
hepsi kilitlenir" idi. 2026-08-27'de canlı veriye bakıldı, **öyle bir satır yok**:

| Durum | Adet | Periyot | En erken bitiş |
|---|---|---|---|
| `ACTIVE` | 4 | MONTHLY | 2026-09-13 |
| `TRIAL` | 14 | — | `trialEndsAt` 2027-04-27 |

`runReconcile`'ın aday filtresine (`trialEndsAt <= now OR periodEnd <= now`) **bugün 0
satır** giriyor. `cron_runs` boş — iş henüz hiç koşmadı. Yani enforcement açıldığında
kimse kilitlenmiyor, uyarı e-postası bile gitmiyor.

**Karar: betik yazılmadı.** İhtiyaç doğarsa (elle bir dönem geriye alınırsa, ya da
enforcement uzun süre kapalı kalıp veri birikirse) planın Faz 8 bölümündeki alan listesi
ve iki açık sorusu olduğu gibi duruyor — oradan yazılır.

**Sırada duran gerçek tarih: 2026-09-13.** O gün ilk `ACTIVE` aboneliğin dönemi bitiyor.
`PAYTR_RECURRING_ENABLED` kapalı olduğu için otomatik çekim OLMAYACAK; müşteri elle
ödemezse akış tasarlandığı gibi `PAST_DUE` → 7 gün hoşgörü → `EXPIRED` yürüyecek. Zincirin
canlıdaki ilk gerçek sınavı budur; o tarihten önce `cron_runs`a bakıp işin koştuğu
doğrulanmalı.

### 2.5 UÇTAN UCA TEST TURU — 2026-08-27 ✅

Tarayıcı + canlı DB üzerinde yapıldı. Test hedefi **Reypo Medya Ajansı** (kullanıcı
seçimi); tüm yazmalar önce anlık görüntüye alındı, sonunda geri yüklendi.

**Otomatik katman:** `prisma generate` (migrasyon uygulanmış olsa da istemci eskiydi —
30+ tip hatası veriyordu) · `tsc --noEmit` temiz · `vitest` 46 dosya / **554 test** ·
`check:rls` temiz (84 tablo, RLS'siz 0 — yeni iki tablo dahil) · `check:company-create` temiz.

**Cron (`/api/billing/cron/daily`):**

| Sınama | Sonuç |
|---|---|
| Header'sız / yanlış secret | 401, 401 ✅ |
| Doğru secret | 200, beş adım da koştu (notify, recurring, reconcile, archive, invoiceRetry) ✅ |
| `cron_runs` kaydı | status OK, 3.5 sn, `failedSteps` boş, adım gövdesi JSON'da ✅ |
| Aynı gün ikinci çağrı | `skipped:true` + önceki koşum bilgisi ✅ (çift koşum kilidi) |
| Yan etki | Hiçbir abonelik değişmedi, `subscription_events` 0'da kaldı ✅ |

> Koşum bugün 0 satır işledi (adaylar 2027'de). Test satırı **silindi**, böylece Vercel'in
> 06:00 UTC koşumu kilide takılmayacak.

**Faz 5 — süre verme (iki yüzey de):** liste ve firma detayı. Dönem uzatıldı, olay
günlüğüne `MANUAL_GRANT` zengin `detail` ile düştü, hesabın **üç firmasında da** modüller
açık kaldı, "ödeme alındı" işaretlenmediği için sipariş/fatura üretilmedi ✅

**Faz 4 — Aboneliğim:** durum rozeti, dönem + kalan gün, periyot/tutar, otomatik yenileme
anahtarı, açık modüller, kota çubukları, ödeme geçmişi (7 sipariş, fatura durumu), abonelik
geçmişi ✅ · `autoRenew` yazıldı ve `AUTO_RENEW_CHANGED` olayı **actor=USER** ile düştü ✅ ·
uç oturumsuz 401 ✅

**Faz 2 — hoşgörü (canlı yolda):**

| Periyot | Dönem sonu | `locksAt` | Fark |
|---|---|---|---|
| MONTHLY | 25 Ağustos | 1 Eylül | **7 gün** ✅ |
| YEARLY | 25 Ağustos | 9 Eylül | **15 gün** ✅ |

Şerit `grace` hâlinde kırmızı, kapatılamaz, doğru tarihleri ve geri sayımı basıyor;
`EXPIRED`'a geçince metin "sona erdi"ye dönüyor ✅ Bu, Faz 2'nin en kritik regresyonuydu
(`billingCycle`'ın select'ten düşmesi) — birim testlerin yanı sıra canlı yolda da doğrulandı.

**Faz 7 — arşiv:** kapılar yerinde (`ensureCompanyWrite` → `AccountArchivedError`, dışa
aktarma muaf, `write-guard` düğmeleri kilitliyor, `LockedAccount` arşiv ekranı taşıyor).
`archivedAt` hesabın **tüm üyelerine** yazılıyor ✅

**Denenmeyenler ve sebepleri:**

- **"Ödeme alındı (havale/elden)"** — `KOBIPO_AUTO_INVOICE_ENABLED=true`,
  `START_AT=2026-08-24`, `STOP_AT_DRAFT` tanımsız: test GERÇEK e-Arşiv/e-Fatura keserdi.
  Kullanıcı kararıyla atlandı; sahada ilk gerçek havale tahsilatında doğrulanacak.
- **Tam cron'u arşiv senaryosuyla koşturmak** — `notify` adımı Reypo yöneticilerine
  gerçek e-posta gönderirdi (`RESEND_API_KEY` dolu). Arşiv durumu doğrudan kurularak
  arayüz sınandı; `runArchive` mantığı 14 birim testiyle kapsanıyor.
- **Kilitli hesap ekranı** — modülleri kapatmak gerekirdi; test hedefi 288 faturalı
  gerçek firma olduğu için yapılmadı.

**Abonelik iptali ✅ (2026-08-27, ikinci turda):** uç sayfa bağlamından çağrılarak
sınandı — 200, `cancelAtPeriodEnd:true`, `autoRenew:false`; `CANCELLED` olayı **actor=USER**
ile yazıldı; rozet "Dönem sonunda iptal"e döndü, dönem kutusunda geri alma yolu anlatıldı,
"Aboneliği iptal et" düğmesi kayboldu, modüller açık kaldı (erişim dönem sonuna kadar sürer).

> **Not — `window.confirm` otomasyonu kilitliyor.** `my-subscription.tsx` iptal düğmesi
> `window.confirm()` çağırıyor; tarayıcı uzantısı modal diyalogda yanıt veremez hâle geliyor.
> Bu turda uç doğrudan çağrılarak aşıldı, ama iptal akışının DÜĞMEDEN sonu hiç otomatik
> sınanamaz. Projedeki diğer onaylar `AlertDialog` kullanıyor; bir gün buraya da geçilirse
> hem görsel tutarlılık hem sınanabilirlik kazanılır.

### 2.6 Test turunda çıkan BULGULAR

| # | Bulgu | Durum |
|---|---|---|
| 1 | **17 hesap kırılgan:** `disabledModules` boş (modüller açık) ama `purchasedModules` da boş → ilk `applyEntitlements`te ücretli modüllerin hepsi kapanır. Gerçek veri taşıyanlar: Reypo Medya (288 fatura), EREN FORKLİFT (116), EREN VİNÇ (45), REYPO BİLİŞİM (20). Kaynağı `MODUL-KILIDI.md`'nin "mevcut firmalara dokunma, backfill YOK" kararı; yeni "Süre ver" düğmesi bu mayına basmayı kolaylaştırıyor. Cron açısından acil değil (tarihler 2027), tehlike elle müdahalede. | ⏸ **AÇIK — bilinçli bırakıldı.** Kullanıcı kararı (2026-08-27): "hesapları ellemeyelim, sonra bakacağım." Reypo'nunki test sırasında kapandı (modül seti yazıldı), kalan 16'sı duruyor. Ele alınırsa: bugün açık olan modülleri `purchasedModules`a yazan tek seferlik betik (önce `--dry-run`). |
| 2 | **`addedDays` yanlış hesaplanıyordu:** adı ve yorumu "eklenen gün" derken `periodEnd − now` hesaplıyordu. "1 ay uzat" → yönetici "275 gün" bildirimi görüyordu. Mevcut test yalnız `mode:"set"`i kapsadığı için kaçmış. | **DÜZELTİLDİ** — `addedDays` artık tabandan sayılıyor, `totalDaysFromNow` ayrı alan, bildirim ikisini de gösteriyor. 3 regresyon testi eklendi. |
| 3 | **Abonelik sayfasında yapışkan hata:** `loadCatalog` başarılı yüklemede `loadError`'ı temizlemiyordu. `useSearchParams()` ilk client render'ında boş dönünce "Firma seçili değil." yazılıyor ve katalog sonradan yüklense bile ekranda kalıyordu. **Bu iş öncesinden var** (`af7e42f`'te de aynı). | **DÜZELTİLDİ** — başarılı denemede `setLoadError(null)`. |
| 4 | **Arşivden çıkışın testi yok.** `applyEntitlements` ücretli modül açılınca `archivedAt`'i siliyor (doğru yazılmış, ücretsizleri ölçüye katmıyor) ama birim testi yok. Dokümanın kendisi bunu "ödeme akışının en pahalı sessiz hatası" diye niteliyor: kural bozulursa müşteri "ödedim ama hiçbir şey kaydedemiyorum" durumuna düşer. | ✅ **DÜZELTİLDİ** — kural `shouldUnarchive(granted, free)` saf fonksiyonuna çıkarıldı (DB'siz sınanabilsin diye) ve 5 test yazıldı. En kritik olanı: "yalnız ÜCRETSİZ modüller açılıyorsa arşive DOKUNMA" — kapanan hesapta `applyEntitlements` ücretsizlerle çağrılır, "granted boş değil" ölçüsü kullanılsaydı arşiv sessizce bozulurdu. |
| 5 | **Admin gerekçesi müşteriye görünüyor.** "Süre ver" formundaki zorunlu gerekçe, müşterinin "Abonelik geçmişi" bölümünde birebir gösteriliyor. Formun yardım metni bunu bir destek/iz alanı gibi tarif ediyor; iç notlar ("şikâyet telafisi" vb.) müşteriye düşer. | ✅ **DÜZELTİLDİ** — kullanıcı kararı: gerekçe yazdırmak gereksiz, alan tamamen KALDIRILDI (form + uç + `GrantPeriodInput` + olay özeti + `detail.reason` + `paymentRef`). İz yapısal olarak duruyor: `actorUserId`, önceki/sonraki dönem, modül seti, tutar, mod. Olay özeti artık yalnız olguyu anlatıyor. |
| 6 | Otomatik yenileme anahtarı AÇIK iken metin "Otomatik tahsilat şu anda kapalı" diyor (recurring bayrağı kapalı olduğu için doğru ama yan yana çelişkili okunuyor). | ✅ **DÜZELTİLDİ** — metin artık anahtarın durumunu tanıyor: açıkken "Otomatik yenileme açık, ancak otomatik tahsilat henüz devrede değil…", kapalıyken "Otomatik tahsilat devrede değil…". |

### 2.7 ⚠️ İLK CANLI KOŞUMDAN ÖNCE — üretim env kontrolü (2026-08-27)

Üretim doğrulandı: `www.kobipo.com` ayakta, **yeni kod dağıtılmış**
(`/api/billing/subscription` → 401, olmayan uç → 404, yani 401 anlamlı),
`/api/billing/cron/daily` → 401 (korumalı). `origin/main`'deki `vercel.json` `crons`
girdisini taşıyor.

**Canlı veriye bakılarak ilk koşumun ne yapacağı ölçüldü:**

| Adım | Etkilenecek satır | Risk |
|---|---|---|
| notify | **0** | e-posta gitmez |
| recurring | **0** | çekim denenmez |
| reconcile | **0** | kimse kilitlenmez |
| archive | **0** | kimse arşivlenmez |
| **invoiceRetry** | **8 paket + 8 kontör siparişi** (hepsi `isTest=false`) | ⚠️ **gerçek mali belge** |

İlk dört adım güvenli. Beşincisi ÜRETİMDEKİ iki değişkene bağlı:

- `KOBIPO_AUTO_INVOICE_ENABLED` — `false` ise hiçbir belge kesilmez.
- `KOBIPO_AUTO_INVOICE_START_AT` — **tanımsızsa da hiçbir belge kesilmez** (kapı fail-safe).
  Tanımlıysa, bu tarihten SONRA ödenen faturasız siparişlere belge kesilir.

Faturasız 16 siparişin en yenisi **2026-08-20** ödemeli, en eskisi 2026-06-26. Yereldeki
`START_AT=2026-08-24` bu yüzden hepsini eliyor (yerel koşumda `invoiceRetry: scanned 0`).
**Üretimde `START_AT` bundan erkense ya da farklıysa, ilk gece 16 kadar GERÇEK e-Arşiv/
e-Fatura geriye dönük kesilir.** Bu tam olarak `START_AT` kapısının önlemek için yazıldığı
senaryodur (bkz. `lib/invoicing/config.ts` — "geriye dönük süpürmeyi engelleyen kapı").

**Vercel panelinde doğrulanacaklar (Settings → Environment Variables → Production):**

1. `BILLING_CRON_SECRET` **veya** `CRON_SECRET` tanımlı mı? (yoksa uç 401 döner, iş hiç koşmaz)
2. `KOBIPO_AUTO_INVOICE_ENABLED` değeri ne?
3. `KOBIPO_AUTO_INVOICE_START_AT` değeri ne? (yereldeki: `2026-08-24T00:00:00Z`)

### 3. Doğrulanacak: Vercel'de cron secret

`BILLING_CRON_SECRET` yerel `.env.local`'de tanımlı — bu **Vercel'de de tanımlı olduğu
anlamına gelmez**. Yoksa uç 401 döner, iş hiç koşmaz ve `cron_runs` boş kalır (şu anda
boş olması normal: `vercel.json` girdisi bugün eklendi, iş ilk 06:00 UTC'de koşacak).
İlk koşumdan sonra `cron_runs`ta bir satır GÖRÜNMELİ.

### 4. Sıradaki iş

Plan bitti. Kalan iş kodda değil, sahada:

| Sıra | İş | Not |
|---|---|---|
| **1.** | Vercel'de `BILLING_CRON_SECRET` doğrula | Yoksa uç 401, iş hiç koşmaz |
| 2. | İlk koşumdan sonra `cron_runs`a bak | Satır oluşmalı; `failedSteps` boş olmalı |
| 3. | Tarayıcıda elle e2e | "Aboneliğim", "Süre ver", arşiv ekranı hiç açılmadı |
| 4. | PayTR "Tekrarlayan Ödeme" ürününü sor | `PAYTR-RECURRING-KONTROL.md` |
| — | Faz 8 | Konusuz kaldı (yukarı bkz.) |

### 5. Bekleyen dış bağımlılık — PayTR

Otomatik yenileme kodu tam ama **`PAYTR_RECURRING_ENABLED` ile kapalı doğdu**: mağaza
hesabında "Tekrarlayan Ödeme" ürününün açık olup olmadığı bilinmiyor. Ne sorulacağı,
açma sırası ve test adımları → `PAYTR-RECURRING-KONTROL.md`.

Bayrak kapalıyken sistem tutarlı: tahsilatı müşteri başlatır, hiçbir yanlış işlem olmaz.

### 6. Dokunulan dosyalar

**Faz 0-3 turu:**

```
YENİ  docs/paket-abonelik/ABONELIK-TAMAMLAMA.md      (bu dosya — plan + ilerleme)
YENİ  docs/paket-abonelik/PAYTR-RECURRING-KONTROL.md
YENİ  supabase/migrations/20260827000001_abonelik_olay_cron_arsiv.sql
YENİ  lib/billing/events.ts                          (olay günlüğü)
YENİ  lib/billing/cron-run.ts                        (koşum kaydı + kilit)
      prisma/schema.prisma                           (2 yeni model, 6 yeni alan)
      vercel.json                                    (crons)
      lib/billing/constants.ts                       (graceDaysFor)
      lib/billing/notice.ts                          (grace türü, eşik durumu)
      lib/billing/entitlements.ts                    (isInGracePeriod → periyoda göre)
      lib/billing/jobs.ts                            (3 iş: uyarı/yenileme/uzlaştırma)
      lib/billing/paytr-payment.ts                   (kart saklama + olay)
      lib/integrations/paytr/client.ts               (recurring çekim + bayrak)
      lib/integrations/paytr/notification.ts         (kart alanları)
      lib/email/templates.ts                         (3 hâlli uyarı e-postası)
      app/api/billing/cron/daily/route.ts            (koşum kaydı + kilit + alarm)
      app/api/billing/notice/route.ts                (autoRenewActive)
      components/dashboard/subscription-notice-banner.tsx (grace şeridi)
      lib/billing/notice.test.ts                     (yeniden yazıldı)
      lib/billing/entitlements.test.ts               (periyoda göre hoşgörü testleri)
```

**Faz 7 turu:**

```
YENİ  lib/billing/archive.ts                         (arşiv kuralı + 403 hatası)
YENİ  lib/billing/archive.test.ts                    (14 test)
      lib/billing/jobs.ts                            (runArchive)
      app/api/billing/cron/daily/route.ts            (5. adım: archive)
      lib/billing/entitlements.ts                    (arşivden ÇIKIŞ)
      lib/middleware/company.ts                      (yazma kapısı + export istisnası)
      lib/module-access.ts                           (isArchiveExportPath)
      lib/api/errors.ts                              (ACCOUNT_ARCHIVED kodu)
      lib/auth/user-context.ts                       (isArchived bağlamda)
      lib/auth/branch-access.ts                      (archivedAt seçimi)
      lib/middleware/authorization.ts                (UserRole.isArchived)
      components/dashboard/locked-account.tsx        (arşiv ekranı)
      components/dashboard/write-guard.tsx           (arşivde düzenleme yok)
      components/dashboard/dashboard-company-provider.tsx
      app/api/companies/route.ts                     (isArchived listede)
      app/(dashboard)/dashboard/*/page.tsx           (6 sayfa: isArchived geçişi)
```

**Faz 5-6 turu:**

```
YENİ  lib/billing/period.ts                          (dönem matematiği — tek kural)
YENİ  lib/billing/period.test.ts                     (18 test)
YENİ  app/api/billing/admin/period/route.ts          (POST — elle süre ver)
YENİ  components/system-admin/grant-period-form.tsx  (ortak form)
      lib/billing/admin.ts                           (grantAccountPeriod)
      lib/billing/entitlements.ts                    (periodEndFor → period.ts)
      lib/billing/paytr-payment.ts                   (erken yenileme düzeltmesi)
      app/api/billing/admin/overview/route.ts        (kart token'ı maskelendi)
      components/system-admin/subscription-admin.tsx ("Süre ver" + form)
      app/(system-admin)/system-admin/companies/[id]/page.tsx (Abonelik süresi kartı)
      app/(dashboard)/ayarlar/subeler/page.tsx       (haksız kotada "—")
      components/billing/my-subscription.tsx         (aynı)
      lib/page-api-coverage.test.ts                  (yeni uç muafiyeti)
      lib/billing/paytr-payment.test.ts              (erken yenileme testleri)
      lib/billing/entitlements.test.ts               (ay kırpma testi)
```

**Faz 4 turu:**

```
YENİ  app/api/billing/subscription/route.ts          (GET — tam abonelik görünümü)
YENİ  app/api/billing/subscription/auto-renew/route.ts (POST — aç/kapat)
YENİ  components/billing/my-subscription.tsx         ("Aboneliğim" bölümü)
YENİ  lib/billing/subscription-view.ts               (rozet + kota cümlesi, saf)
YENİ  lib/billing/subscription-view.test.ts          (8 test)
      lib/billing/events.ts                          (AUTO_RENEW_CHANGED türü)
      prisma/schema.prisma                           (olay türü yorumu)
      app/api/billing/subscription/cancel/route.ts   (CANCELLED olayı yazılıyor)
      app/(dashboard)/ayarlar/abonelik/page.tsx      (eski durum kartı → MySubscription)
```

---

## Neden

Abonelik sisteminin **durum makinesi yazılmış ama hiç çalışmıyor**. 2026-08-27'de yapılan
uçtan uca incelemede çıkan tablo:

| Parça | Bulgu |
|---|---|
| `/api/billing/cron/daily` | Yazılmış, sırası doğru, `CRON_SECRET` korumalı — **ama hiçbir zamanlayıcı çağırmıyor**. `vercel.json`'da `crons` yok, `.github/workflows` yok, pg_cron yok. |
| Dönem takibi | `periodStart/periodEnd/billingCycle` var ve doğru yazılıyor. Sorun takipte değil, takibin sonucunda kimsenin bir şey yapmamasında. |
| Otomatik yenileme | `chargeRecurringPayment` daima `NotImplemented` fırlatıyor. Dahası zincir **her halkada kopuk**: `createPaymentToken` `recurringPayment` parametresini tip olarak tanıyor ama form gövdesine `recurring_payment` alanını hiç yazmıyor; `PackageOrder.recurringToken` ve `Subscription.providerSubscriptionId` alanları hiçbir yerde doldurulmuyor (grep: yalnız `jobs.ts:172` okuyor). |
| Hoşgörü | `GRACE_PERIOD_DAYS = 7` **sabit** — periyoda duyarlı değil. |
| Uyarı barı | Var ve kapatılamıyor (doğru), ama yalnız `expiring`/`expired` üretiyor; "ödemeniz aksadı" (PAST_DUE) diye bir hâli yok. Metni de bilinçli yumuşatılmış (`subscription-notice-banner.tsx:56` yorumu: cron zamanlanmadığı için kesinti duyurulmuyor). |
| Olay geçmişi | Yok. Durum geçişleri iz bırakmıyor — oysa bu projede modüller canlıda **iki kez** sessizce kapandı (`ILERLEME.md`). |
| Silme/arşiv | Hiç yok. |

Tek cümleyle: **ödeme alınıyor, dönem yazılıyor, sonra hiçbir şey olmuyor.**

### Sıralamayı belirleyen tuzak

Cron'u bugün olduğu gibi açmak **yanlış** olur: otomatik yenileme çalışmadığı için ilk
gece her abonelik dönem sonunda `PAST_DUE`'ya, hoşgörü bitince `EXPIRED`'a yürür ve
**hiçbir ödeme denenmez**. Yani "enforcement"ı açmadan önce "tahsilat"ın kurulması şart.
Bu yüzden Faz 3 (recurring), Faz 1'in (cron) canlıda açılmasının ön şartıdır — kod olarak
Faz 1 önce yazılır, `crons` girdisi Faz 3 bitmeden **production'a alınmaz**.

---

## Kararlar (2026-08-27, kullanıcı onayı)

1. **Otomatik yenileme olacak.** PayTR "Tekrarlayan Ödeme" ürününün hesapta açık olup
   olmadığı bilinmiyor → canlı çekim istemcisi yazılır ama `PAYTR_RECURRING_ENABLED`
   ile **kapalı doğar**. Yanına PayTR'a sorulacakların kontrol listesi çıkarılır
   (`PAYTR-RECURRING-KONTROL.md`).
2. **Veri saklama:** `EXPIRED` → **30 gün** → `ARŞİV` (salt-okunur). Silme YALNIZ
   kullanıcının açık talebiyle. Gerekçe: fatura/e-fatura/defter kayıtları VUK gereği
   saklanmak zorunda; "ödemedi, sildik" hukuken yapılamaz.
3. **Sistem-admin süre verme:** formda "ödeme alındı (havale/elden)" kutusu olacak.
   İşaretlenmezse yalnız dönem uzar (hediye/telafi), işaretlenirse `PackageOrder` +
   otomatik fatura üretilir.
4. **Yıllık fiyat zorunluluğu bu turda YOK.** (İncelemede çıkan "yıllık fiyatı girilmemiş
   kalem bedava geçiyor" bulgusu bilinçli olarak ertelendi.)
5. **Hoşgörü periyoda bağlı:** MONTHLY → 7 gün, YEARLY → 15 gün.

---

## Fazlar

### Faz 0 — Şema temeli

Tek migrasyon, çünkü sonraki her faz bu alanları okuyor.

| Değişiklik | Neden |
|---|---|
| `SubscriptionEvent` (yeni tablo) | Append-only olay günlüğü: durum geçişi, yenileme, elle süre verme, modül değişikliği. "Modüllerim neden kapandı" sorusunun cevabı bugün hiçbir yerde yok. |
| `CronRun` (yeni tablo) | Günlük işin ne zaman koştuğu, ne kadar sürdüğü, hangi adımın patladığı. Aynı zamanda **çift koşum kilidi**. |
| `Subscription.lastNoticeOn` | E-posta eşiği (7/3/1) bugün "cron günde tam bir kez koşar" varsayımına dayanıyor; iki kez koşarsa çift e-posta, bir gün kaçarsa eşik sessizce atlanıyor. |
| `Subscription.cardBrand` / `cardLast4` | Müşteri ekranında "kayıtlı kart" gösterimi. |
| `Subscription.lockedAt` | `EXPIRED` yazıldığı an — arşiv sayacı buradan işler. |
| `Company.archivedAt` | Salt-okunur kapısı. `disabledModules` ile **aynı desende** hesabın tüm üyelerine yazılır ki istek başına ek sorgu gerekmesin. |

Migrasyonun sonuna CLAUDE.md kuralı gereği iki yeni tablo için
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

### Faz 1 — Cron'u ayağa kaldır + gözlem

- `vercel.json` → `crons` girdisi (`/api/billing/cron/daily`, günlük).
- `CronRun` kaydı: başlangıç/bitiş/adım sonuçları. Aynı gün ikinci koşum kilitle engellenir.
- Başarısız adımda sistem-admin'e e-posta — kilitleme yapan bir iş sessizce üç gün
  çalışmazsa bugün kimse fark etmez.
- `lastNoticeOn` ile e-posta idempotency + **kaçan eşiği yakalama** (eşik gününü tam
  tutturmak yerine "bu eşik için henüz gönderilmedi mi" sorulur).

> Bu fazın `vercel.json` kısmı Faz 3 bitmeden production'a alınmaz (yukarıdaki tuzak).

### Faz 2 — Periyoda göre hoşgörü + "ödemeniz aksadı" barı

- `GRACE_PERIOD_DAYS` → `graceDaysFor(cycle)`: MONTHLY 7, YEARLY 15.
- **Dikkat:** `NoticeSubscription` ve `SubStatusView` tipleri `billingCycle` taşımıyor.
  Tiplere eklenip **ilgili her `select`'e** `billingCycle: true` girmezse yıllık müşteri
  sessizce 8 gün erken kilitlenir. Testle sabitlenecek.
- `subscriptionNotice`'a üçüncü tür: `"grace"` — ödeme alınamadı, erişim sürüyor,
  `locksAt`'te kapanacak.
- Banner: `grace` hâlinde kırmızı, kapatılamaz, "Ödemeniz alınamadı — erişiminiz
  <tarih>'e kadar açık" + geri sayım. Cron açıldığı için artık kapanış tarihi
  söylenebilir (mevcut yorumun beklediği şart).

### Faz 3 — Otomatik yenileme

Zincirin dört halkası da kopuk, dördü de kurulacak:

1. `createPaymentToken` → form gövdesine `recurring_payment: "1"` (abonelik siparişlerinde).
2. Callback → PayTR'ın döndürdüğü kart token'ı `PackageOrder.recurringToken` ve
   `Subscription.providerSubscriptionId`'ye yazılır (+ `cardBrand`/`cardLast4`).
3. `chargeRecurringPayment` → canlı PayTR isteği, `PAYTR_RECURRING_ENABLED` ile gated.
   Kapalıyken bugünkü davranış (aboneliğe dokunma) korunur.
4. `runRecurring` → başarıda dönem **`periodEnd`'den** uzatılır (bugün doğru yapıyor),
   yenileme için `PackageOrder` + `issueInvoiceQuietly` (jobs.ts'teki TODO kapanır).
   Başarısızlıkta `PAST_DUE` + hoşgörü boyunca her gün yeniden denenir.

Müşteri tarafı: otomatik yenilemeyi aç/kapat, kayıtlı kartı değiştir.
PayTR'a sorulacaklar → `PAYTR-RECURRING-KONTROL.md`.

### Faz 4 — Müşteri abonelik bilgileri ekranı

`GET /api/billing/subscription` + `/ayarlar/abonelik` sayfasının üstünde genişletilmiş
"Aboneliğim" bölümü (satın alma akışı aynı sayfada kalır — katalog ve abonelik zaten
orada yükleniyor, ikinci sayfa ikinci istek demek olurdu):

- Durum rozeti: Aktif / Ödeme bekleniyor (hoşgörü) / Süresi doldu / Dönem sonunda iptal
- Dönem: başlangıç – bitiş, **kalan gün**
- Periyot (Aylık/Yıllık), dönem tutarı
- Otomatik yenileme aç/kapat + kayıtlı kart (maskeli)
- Açık modüller
- Şube / ek firma kotası kullanımı
- **Ödeme geçmişi** + fatura indirme (uçlar zaten var:
  `/api/billing/orders/[id]/invoice-pdf`)

### Faz 5 — Sistem-admin süre verme

- `grantAccountPeriod()` (`lib/billing/admin.ts`) + `POST /api/billing/admin/period`.
- Girdi: `days` / `months` / `untilDate`, `mode: "extend" | "set"`, opsiyonel modül seti,
  `paymentReceived` (→ `PackageOrder` + fatura), zorunlu `reason`.
- `SubscriptionEvent` kaydı — elle müdahale her zaman iz bırakır.
- Arayüz: `system-admin/abonelikler` (bugün `SubscriptionAdmin`'i saran 23 satırlık kabuk)
  ve `system-admin/companies/[id]`.
- **Tuzak:** `provider="PAYTR"` + `autoRenew=true` bir abonelikte süre uzatmak, recurring'in
  o dönemi çekmesini engellemez. `mode` ve `autoRenew` ilişkisi açıkça yazılacak.

### Faz 6 — İncelemede çıkan düzeltmeler

- **Erken yenileyen gün kaybediyor.** `planSubscriptionWrite` `max(existingEnd, now+cycle)`
  yazıyor; yıllık müşteri 20 gün erken yenilerse o 20 günü siliniyor. `runRecurring` ise
  doğrusunu yapıyor (`newStart = sub.periodEnd`). Aynı soruya iki farklı cevap var → tek
  kurala indirilecek: dönem gelecekteyse **ondan** uzat.
- `notifyExpiring` yöneticileri yalnız `userCompany`'den buluyor (`jobs.ts:83`) —
  üyeliksiz yönetici erişimi kapsam dışı; kök firmada ADMIN satırı yoksa kimse
  uyarılmıyor **ve bu sessiz**.
- `EXPIRED` hesapta kota ekranı "0 hakkınız var / 3 kullanılmış" diyor — mesaj netleşecek.

### Faz 8 — Mevcut hesapların dönemi BUGÜNDEN başlasın ⚠️ KONUSUZ KALDI (betik yazılmadı)

**İstek (2026-08-27, kullanıcı):** "hesapların aboneliği bu günden başlamalı."

> **2026-08-27 — GEREKÇE DÜŞTÜ.** Canlı veriye bakıldı: `runReconcile`'ın aday filtresine
> giren **0 satır** var (4 `ACTIVE` aboneliğin en erkeni 2026-09-13'te, 14 `TRIAL`
> satırının hepsi 2027-04'ten sonra bitiyor). Kilitlenecek hesap olmadığı için betik
> yazılmadı. Aşağıdaki tasarım, ihtiyaç doğduğu gün olduğu gibi kullanılabilir —
> özellikle "Betiğin yapması gerekenler" ve "kalan iki açık soru" bölümleri.

**Neden gerekli.** Cron bugüne kadar hiç koşmadı; bu yüzden canlıda dönemi çoktan geçmiş,
`periodEnd`'i boş ya da yıllar önce kalmış abonelik satırları var. Enforcement açıldığı
gece bunların hepsi `PAST_DUE` → `EXPIRED` yürür ve **hiç uyarılmamış müşteriler bir
sabah kilitli uyanır**. Faz 1'de not düşülen "bu dağıtım enforcement'ı açar" uyarısının
çözümü budur: enforcement'ı açmadan ÖNCE mevcut hesapların dönemi bugüne sabitlenir,
sayaç herkes için sıfırdan başlar.

**Yapılacak** — tek seferlik bir betik (`scripts/rebase-subscription-periods.mjs`),
migrasyon DEĞİL: veri düzeltmesi, şema değişikliği değil; ne zaman koşacağına
enforcement'ın açılma günü karar verir.

```
periodStart = <çalıştırma günü>
periodEnd   = periodStart + billingCycle   (MONTHLY → +1 ay, YEARLY → +1 yıl)
lockedAt            = null
lastNoticeThreshold = null   // yeni dönem = temiz sayfa, uyarılar baştan
lastNoticeSentAt    = null
```

Kapsam ve sınırlar:

- Yalnız **ücretli** satırlar (`ACTIVE`, `PAST_DUE`, `EXPIRED`, `CANCELLED`). `TRIAL`
  satırları `trialEndsAt` ile yürür, onlara dokunulmaz.
- `cancelAtPeriodEnd = true` olanlara **dokunulmamalı**: kullanıcı bitmesini kendisi
  istedi, süre uzatmak onu şaşırtır. (Bu bir karar — kullanıcıya teyit ettirilecek.)
- Statüsü `EXPIRED` olan hesabın modülleri kapalıdır; dönemi uzatmak tek başına açmaz.
  Açılması isteniyorsa `applyEntitlements` da çağrılmalı → **açık soru, aşağıya bkz.**
- Her satır için `SubscriptionEvent` yazılmalı (`MANUAL_GRANT`, `actor: "ADMIN"`,
  özet: "Enforcement açılışı — dönem bugünden yeniden başlatıldı"). Elle müdahale
  daima iz bırakır.
- **Idempotent olmalı** ve `--dry-run` desteklemeli: kaç satırın nasıl değişeceğini
  önce yazdırsın. Canlı veriye dokunan bir betik körlemesine koşturulmaz.

**KARAR (2026-08-27): kapanma geri alınabilir olduğu için enforcement önden açıldı.**
Kullanıcı main'e push'u onayladı — "hesaplar şu anlık kapanabilir, önemi yok, düzeltince
geri açılacaksa." Faz 8 artık **kapanmayı önleyen** değil, **geri alan** iş.

**Geri dönüşün neden garanti olduğu (kodda doğrulandı):** kilitleme yolu
(`runReconcile`) abonelik satırında YALNIZ `status` ve `lockedAt` yazar;
`applyEntitlements` de yalnız `company.disabledModules` yazar. **`purchasedModules`,
`branchQuota`, `companyQuota` ve hiçbir müşteri verisi silinmez.** `purchasedModules`'a
yazan üç yer var, üçü de kilitleme dışı: satın alma (`paytr-payment.ts`), elle grant
(`setAccountModules`), admin reset (`admin.ts`). Yani dönem ileri alınıp
`applyEntitlements` çağrıldığında modüller **aynen geri açılır**.
(Arşiv/salt-okunur kademesi henüz YAZILMADI, dolayısıyla veri kilitlenmesi de yok.)

**Betiğin yapması gerekenler (yukarıdaki alan listesine ek):**

- Dönem yazıldıktan sonra **`applyEntitlements(root, resolveGrantedModules(sub))`
  ÇAĞRILMALI.** Yalnız tarih ileri almak yetmez: `disabledModules` kilitli kaldığı için
  müşteri "süresi var ama paneli boş" görür.
- `status` `EXPIRED`/`PAST_DUE` ise `ACTIVE`'e alınmalı.

**Kalan iki açık soru (betik yazılmadan önce sorulacak):**

1. **Süre ne kadar?** `billingCycle` kadar mı (aylık satıra 1 ay, yıllığa 1 yıl), yoksa
   herkese eşit bir geçiş süresi mi (ör. 30 gün)? `billingCycle` boş olan satırlarda ne
   varsayılacak?
2. **İptal işaretli (`cancelAtPeriodEnd`) satırlar kapsam dışı mı?** (Öneri: evet, dışı —
   kullanıcı bitmesini kendisi istemişti.)

**Kapsam dışı kalan ve ELLE düzeltilecek durum:** `TRIAL` satırları bu betiğe dahil değil
(deneme `trialEndsAt` ile yürür). Süper-admin'in `resetAccountBilling("trial")` ile açtığı
**demo/destek hesapları** kilitlenirse betik onları geri açmaz; o hesaplar sistem-admin
panelinden yeniden "taze deneme"ye alınmalı.

### Faz 7 — Arşiv kademesi (30 gün)

- `runArchive` işi: `lockedAt + 30 gün` → `Company.archivedAt` (hesabın tüm üyelerine).
- Salt-okunur kapı: arşivdeki hesapta yazma uçları 403, okuma ve **dışa aktarma** açık.
- "Verilerinizi indirin" ekranı — `lib/export` katmanı üzerine.
- Silme akışı yazılmaz; yalnız kullanıcının açık talebiyle, elle.

---

## İlerleme

- [x] **Faz 0 — şema temeli** (2026-08-27)
- [x] **Faz 1 — cron + gözlem** (2026-08-27)
- [x] **Faz 2 — hoşgörü + grace şeridi** (2026-08-27)
- [x] **Faz 3 — otomatik yenileme** (2026-08-27, bayrakla kapalı)
- [x] **Faz 4 — müşteri abonelik ekranı** (2026-08-27)
- [x] **Faz 5 — sistem-admin süre verme** (2026-08-27)
- [x] **Faz 6 — düzeltmeler** (2026-08-27)
- [x] **Faz 7 — arşiv kademesi** (2026-08-27)
- [~] **Faz 8 — mevcut dönemleri bugünden başlat** — KONUSUZ KALDI, betik yazılmadı

### Faz 0 — şema temeli ✅

`supabase/migrations/20260827000001_abonelik_olay_cron_arsiv.sql` — **canlıya henüz
uygulanmadı**, komutu kullanıcı çalıştırır:

```bash
node scripts/apply-migration.js supabase/migrations/20260827000001_abonelik_olay_cron_arsiv.sql
```

| Ne | Nerede |
|---|---|
| `Company.archivedAt` | Arşiv kapısı. `disabledModules` deseniyle hesabın tüm üyelerine yazılacak (Faz 7). Kısmi indeks: yalnız arşivdekiler. |
| `Subscription.lockedAt` | Erişimin GERÇEKTEN kapandığı an. Arşiv sayacı buradan işler; `periodEnd`'den saymak hoşgörüde geçen günleri iki kez saymak olurdu. |
| `Subscription.lastNoticeThreshold` / `lastNoticeSentAt` | E-posta eşik durumu. |
| `Subscription.cardBrand` / `cardLast4` | Saklı kartın GÖSTERİM bilgisi. Kart numarası/CVV tutulmaz. |
| `subscription_events` (yeni) | Append-only olay günlüğü. `lib/billing/events.ts` — **asla fırlatmaz**, ama sessiz de geçmez (yazamazsa `console.error`). |
| `cron_runs` (yeni) | Koşum kaydı: gözlem + çift koşum kilidi. `jobKey` benzersiz. |

İkisi de RLS açık, policy'siz (CLAUDE.md).

### Faz 1 — cron + gözlem ✅

- `vercel.json` → `crons`: `/api/billing/cron/daily`, her gün **06:00 UTC** (TR 09:00).
- `lib/billing/cron-run.ts` — `startCronRun` / `finishCronRun` / `alertCronFailure`.
  - **Kilit yarışa dayanıklı:** "önce SELECT sonra INSERT" değil, doğrudan INSERT + P2002
    yakalama. Aksi halde eşzamanlı iki tetikleme arasında ikisinin de yazdığı pencere kalırdı.
  - **Takılı `RUNNING` bilinçli engel:** süreç ortada ölürse o günün kaydı `RUNNING`
    kalır ve aynı gün yeniden koşulamaz. Yarıda kalmış bir tahsilat turunu körlemesine
    tekrarlamak, kilidin engellediği riskten büyük.
  - Başarısız adım süper-admin'lere e-postayla bildirilir (fırlatmaz).
- Aynı gün ikinci tetikleme **200 + `skipped:true`** döner — hata değil, "yapacak iş yok".

> ⚠️ **Bu dağıtım enforcement'ı açar.** Cron canlıda ilk koştuğunda dönemi çoktan bitmiş
> hesaplar `PAST_DUE` → `EXPIRED` yürümeye başlar. Öncesinde `BILLING_CRON_SECRET`
> tanımlı olmalı ve Faz 3'ün durumu bilinçli seçilmiş olmalıdır.

### Faz 2 — hoşgörü + grace şeridi ✅

- `GRACE_PERIOD_DAYS` (sabit 7) → `GRACE_DAYS_BY_CYCLE` + `graceDaysFor(cycle)`:
  **aylık 7, yıllık 15**. Periyot bilinmiyorsa **uzun** olan varsayılır
  (`DEFAULT_GRACE_DAYS`) — erken kilitlemek, fazladan birkaç gün erişimden pahalıdır.
- Tiplere `billingCycle` eklendi (`NoticeSubscription`, `SubStatusView`) **ve
  `jobs.ts`'teki iki `select`'e**. Bu alan düşerse yıllık müşteri 8 gün erken kilitlenir;
  iki test (`notice.test.ts`, `entitlements.test.ts`) tam olarak bunu tutuyor.
- Üçüncü uyarı türü: **`grace`** — "ödemeniz alınamadı, erişiminiz N gün sonra kapanacak".
  Şerit kırmızı, kapatma butonu yok, `locksAt` geri sayımlı. E-posta şablonu da üç hâlli.
- **Sorunsuz ödeyen müşteri artık uyarı görmüyor:** kart saklı + otomatik yenileme
  gerçekten kuruluysa (`isAutoRenewActive` — dört şart) "bitiyor" şeridi bastırılır.
  Çekim başarısız olursa `grace` devreye girer.
- E-posta eşiği durum tabanlı oldu (`pendingNoticeThreshold`): aynı eşik iki kez
  gitmiyor, **kaçan eşik ilk koşuda yakalanıyor**. Eşikler tek yönlü: 7 → 3 → 1 → 0 → -1.
- `runReconcile` artık `lockedAt` damgalıyor ve her geçişi olay günlüğüne yazıyor.
- `notifyExpiring` yöneticileri **hesabın tamamından** buluyor (kök + şubeler + ek
  firmalar), e-postayı tekilleştiriyor ve ADMIN bulunamazsa **sessiz geçmiyor**
  (`noAdmin` sayacı + `console.warn`). — Faz 6'nın bu maddesi burada kapandı.

Doğrulama: `npx tsc --noEmit` temiz · `npx vitest run` 43 dosya / 512 test geçti
(billing: 7 dosya / 101 test).

### Faz 3 — otomatik yenileme ✅ (kapalı doğdu)

Zincirin **dört halkası da kopuktu**; dördü de bağlandı:

| # | Halka | Önceki durum | Şimdi |
|---|---|---|---|
| 1 | Kart saklama işareti | `recurringPayment` parametresi tipte vardı ama form gövdesine **hiç yazılmıyordu** | `recurring_payment=1` gönderiliyor — yalnız `isRecurringEnabled()` iken (ürün kapalıyken bu alan ödemeyi reddettirir) |
| 2 | Token saklama | `PackageOrder.recurringToken` ve `Subscription.providerSubscriptionId` **hiçbir yerde yazılmıyordu** | Bildirimden okunup ikisine de yazılıyor (+ `cardBrand`/`cardLast4`) |
| 3 | Çekim | `chargeRecurringPayment` daima `NotImplemented` fırlatıyordu | Canlı istek yazıldı, `PAYTR_RECURRING_ENABLED` ile gated |
| 4 | Yenilemenin mali izi | `TODO` — dönem uzuyor ama satış kaydı yok | `recordRenewalOrder`: `PackageOrder` + `issueInvoiceQuietly` |

Tasarımdaki iki kritik ayrım:

- **Üç sonuç, üç davranış.** `success` → dönem uzar. `success:false` (PayTR açıkça
  reddetti) → `PAST_DUE`, hoşgörü boyunca her gün yeniden denenir. **Fırlatma** (ağ
  hatası / tanınmayan gövde) → abonelik **değiştirilmez**. Sonucu bilmediğimiz bir çekimi
  "başarısız" saymak, parası çekilmiş müşteriyi hoşgörüye düşürürdü.
- **`undefined` = "dokunma".** Kart alanları yalnız geldiyse yazılıyor; kota takviyesi
  gibi kartsız bir sipariş çalışan bir otomatik yenilemeyi **silmemeli**.

Ayrıca: yeni dönem başlarken `lastNoticeThreshold` / `lastNoticeSentAt` / `lockedAt`
sıfırlanıyor — aksi halde yeni dönemin "7 gün kaldı" uyarısı "daha acilini göndermiştim"
diye atlanır ve arşiv sayacı ödemiş hesabı saymaya devam ederdi.

**Açılış prosedürü ve PayTR'a sorulacaklar:** `PAYTR-RECURRING-KONTROL.md`.
Teyit edilecek üç nokta (uç adresi, hash içeriği, token alan adı) kodda işaretli;
üçüncüsü ilk gerçek ödemede log'dan **kendiliğinden ortaya çıkacak** şekilde kuruldu.

### Faz 4 — müşteri abonelik ekranı ✅ (2026-08-27)

`/ayarlar/abonelik` sayfasının üstündeki 20 satırlık "Mevcut durum" kartı, kendi ucundan
beslenen bir **"Aboneliğim"** bölümüyle değiştirildi. Satın alma formu aynı sayfada kaldı.

| Ne | Nerede |
|---|---|
| `GET /api/billing/subscription` | Ekranın TEK ucu: durum, dönem, kart, açık modüller, kota, ödeme geçmişi, olay günlüğü. Katalogdan ayrı tutuldu — katalog satın alma formunu besler, her tur sipariş geçmişi çekmesi gereksiz. |
| `POST /api/billing/subscription/auto-renew` | Otomatik yenilemeyi aç/kapat (ADMIN). |
| `components/billing/my-subscription.tsx` | Bölümün kendisi. SWR ile yüklenir, işlem sonrası üst sayfanın kataloğunu da tazeler. |
| `lib/billing/subscription-view.ts` (+ test) | Rozet sırası ve kota cümlesi — saf, DB'siz. |

Tasarımdaki dört ayrım:

- **Otomatik yenileme kapatmak İPTAL DEĞİLDİR.** Fark hoşgörüdedir ve müşteri açısından
  günler eder: `autoRenew=false` → dönem sonunda `PAST_DUE` + hoşgörü (7/15 gün) →
  `EXPIRED`; `cancelAtPeriodEnd=true` → doğrudan `EXPIRED`, hoşgörü YOK. Bu yüzden iki
  ayrı uç. Anahtarı AÇMAK ayrıca `cancelAtPeriodEnd`i kaldırır — "iptali geri al" diye
  ikinci bir düğme aratmamak için.
- **Rozet sırası kararın kendisi.** Hoşgörü, `isPaidActive` DEĞİL ama erişimi açık bir
  hâl; iptal işaretli abonelik ise HÂLÂ `isPaidActive`. "Açık mı" ile "sorun var mı" ayrı
  eksenler olduğu için önce sorunlu hâller sorulur — aksi halde ödemesi alınamamış
  müşteri yeşil "Aktif" görür. `subscription-view.test.ts` tam bu sırayı tutuyor.
- **"Açık" ile "gerçekten çalışacak" ayrı gösterilir.** `autoRenew` bir niyet;
  `isAutoRenewActive` (dört şart) gerçek. Kayıtlı kart yoksa ya da PayTR ürünü kapalıysa
  anahtar açıkken de kimse tahsilat yapmaz — ekran bunu açıkça yazar, olay günlüğü de
  `effective` alanında saklar.
- **Fatura indirme butonu yalnız GİB'e gönderilmiş faturada görünür.** Uç aksi hâlde 409
  döndürüyor; tıklandığında indirmeyen bir bağlantı bırakmamak için durum uçtan geliyor
  (`invoiceReady`).

Yan kazanımlar:

- Müşterinin kendi eylemleri artık **iz bırakıyor**: iptal `CANCELLED`, anahtar
  `AUTO_RENEW_CHANGED` (yeni tür) olayı yazıyor. Faz 0'da kurulan günlüğe yazan ilk
  `USER` aktörlü yollar bunlar — o güne kadar günlüğe yalnız cron ve callback yazıyordu.
- **Faz 6'nın kota mesajı maddesi kapandı:** aboneliksiz hesapta "0 hakkınız var /
  3 kullanılmış" yerine "Aboneliğiniz aktif değil — yeni açma hakkı yok, mevcutlar
  duruyor." yazıyor (`quotaHint`). Faz 6'da erken yenileme (`planSubscriptionWrite`)
  ve `notifyExpiring` maddeleri kaldı — ikincisi zaten Faz 2'de kapanmıştı.

Doğrulama: `npx tsc --noEmit` temiz · `npx vitest run` 44 dosya / 520 test · `npm run build` temiz.
Tarayıcıda elle e2e YAPILMADI (yerel `.env` canlı veritabanına bakıyor; anahtar yazma
işlemi denemek için önce demo hesap gerekir).

### Faz 5 — sistem-admin süre verme ✅ (2026-08-27)

Bugüne kadar elle süre vermenin tek yolu `resetAccountBilling("trial")` idi: hesabın
**siparişlerini siliyor** ve taze deneme kuruyordu. Telafi/hediye için fazla yıkıcı,
ücretli müşteride ise geçmişi yok edici. Yeni yol yalnız dönemi yazar.

| Ne | Nerede |
|---|---|
| `grantAccountPeriod()` | `lib/billing/admin.ts` — iş kuralının tamamı. |
| `POST /api/billing/admin/period` | Süper-admin korumalı ince sarmalayıcı. |
| `GrantPeriodForm` | `components/system-admin/grant-period-form.tsx` — iki ekranda ortak. |
| Arayüz | Abonelik listesinde her hesap kartında "Süre ver"; firma detayında "Abonelik süresi" kartı. |

Girdi: `mode` (uzat / bugünden başlat), `days` \| `months` \| `untilDate` (tam olarak biri),
opsiyonel `billingCycle` / `autoRenew` / `modules`, `paymentReceived` + `amount`, **zorunlu**
`reason`.

Beş karar:

- **`extend` dönem GELECEKTEYSE ondan uzatır, geçmişte kalmışsa bugünden başlar.**
  Geçmişten uzatmak "1 ay verdim" denen hesaba fiilen birkaç gün vermek olurdu.
  `set` ise kalan günleri siler — fark yalnız dönemi bitmemiş hesapta görünür ve form
  bunu satır altında yazıyor.
- **Uyarı/kilit damgaları sıfırlanır** (`lockedAt`, `lastNoticeThreshold`,
  `lastNoticeSentAt`). Yeni dönem temiz sayfadır; aksi halde "7 gün kaldı" uyarısı
  "daha acilini göndermiştim" diye atlanır ve arşiv sayacı süresi uzatılmış hesabı
  saymaya devam eder.
- **Yetkiler YENİDEN UYGULANIR.** Yalnız tarihi ileri almak yetmez: `EXPIRED` hesapta
  `disabledModules` kilitli kaldığı için müşteri "süresi var ama paneli boş" görür.
  Modül seti verilirse `setAccountModules` (ikisini birden yazar), verilmezse mevcut
  setle kilit açılır.
- **TUZAK: süre uzatmak yinelenen çekimi DURDURMAZ.** `provider=PAYTR` + `autoRenew` +
  saklı kart üçlüsü kuruluysa yeni `periodEnd`de kart yine çekilir — "3 ay hediye"
  verilen müşteriden 3 ay sonra para çıkar. Form bunu kırmızı uyarı olarak gösteriyor,
  uç da `warnings` dizisinde döndürüyor; çözüm `autoRenew: false` geçmek.
- **Ödeme alındı** işaretlenirse `PackageOrder` (`paymentProvider: "MANUAL"`, `isTest:
  false`) + otomatik satış faturası üretilir. Sipariş/fatura üretilemese bile SÜRE
  VERİLİR — geri almak müşteriyi kapı dışında bırakırdı; hata `warnings`e taşınır.

Her çağrı `MANUAL_GRANT` olayı yazar (önceki/sonraki tarih, mod, modüller, tutar,
gerekçe). Elle müdahale iz bırakmadan geçmez.

**Yan düzeltme — saklı kart token'ı artık tarayıcıya gitmiyor.** `/api/billing/admin/overview`
`providerSubscriptionId`i ham hâliyle döndürecekti (uyarı için lazımdı); token çekim
yetkisi olduğu için `hasStoredCard: boolean`a indirildi.

### Faz 6 — düzeltmeler ✅ (2026-08-27)

Üç maddenin üçü de kapandı:

1. **Erken yenileyen gün kaybediyordu.** `planSubscriptionWrite`
   `max(mevcutBitiş, bugün+periyot)` yazıyordu: 1 Ocak'a kadar süresi olan müşteri bugün
   yenilerse 13 Eylül'e düşüyor, yani üç buçuk ayını kaybediyordu. `runRecurring` zaten
   doğrusunu yapıyordu (`newStart = sub.periodEnd`) — aynı soruya iki cevap vardı. Kural
   tek: **dönem gelecekteyse ONUN üstüne bir periyot eklenir.** Sonucu, dönem ortasında
   yükseltme yapan müşteri de kalan süresinin üstüne tam periyot alır; tam periyot bedeli
   ödediği için doğru olan budur. İki test kilitliyor.
2. **`notifyExpiring` kapsamı** — Faz 2'de kapanmıştı (hesabın tamamı taranıyor, ADMIN
   yoksa sessiz geçmiyor).
3. **Aboneliksiz hesapta kota mesajı.** "0 hakkınız var / 3 kullanılmış" cümlesi
   "şubelerim silinmiş" paniği yaratıyordu. Artık sayı yerine `3/—` basılıyor ve altında
   sebebi yazıyor: "Aboneliğiniz aktif değil — yeni açma hakkı yok, mevcutlar duruyor."
   (`quotaHint`, hem "Aboneliğim" hem şubeler ekranında.)

**Ayrıca ay ekleme kuralı düzeltildi (bilinçli davranış değişikliği).** Ham `setMonth`
taşırıyordu: 31 Ocak + 1 ay = **3 Mart**. Yani ay sonunda ödeyen müşteriye sessizce 2-3
gün fazla. Kural artık `lib/billing/period.ts`te tek yerde ve ayın son gününe kırpıyor
(31 Ocak + 1 ay = 28/29 Şubat). `periodEndFor` (satın alma + yinelenen çekim) ve elle
süre verme aynı fonksiyonu kullanıyor. Eski davranışı kayıt altına alan test
"ileride bilerek değiştirilsin" notuyla duruyordu — değiştirildi.

Doğrulama (Faz 5 + 6): `npx tsc --noEmit` temiz · `npx vitest run` 45 dosya / 538 test ·
`npm run build` temiz. Tarayıcıda elle e2e YAPILMADI.

### Faz 7 — arşiv kademesi ✅ (2026-08-27)

`EXPIRED` → **30 gün** → salt-okunur arşiv. Silme akışı YAZILMADI ve yazılmayacak:
fatura/e-fatura/defter kayıtları VUK gereği saklanmak zorunda, "ödemedi, sildik"
hukuken yapılamaz. Silme yalnız kullanıcının açık talebiyle, elle.

| Ne | Nerede |
|---|---|
| Kural (saf) | `lib/billing/archive.ts` — `shouldArchive`, `archiveDueAt`, 403 hatası |
| İş | `lib/billing/jobs.ts` → `runArchive`, cron'un **5.** adımı |
| Yazma kapısı | `lib/middleware/company.ts` → `ensureCompanyWrite` |
| 403 kodu | `ACCOUNT_ARCHIVED` (`lib/api/errors.ts`) |
| Ekran | `LockedAccount`'un arşiv varyantı — "verileriniz duruyor" + indirme yolu |

Altı karar:

- **Sayaç `lockedAt`ten işler, `periodEnd`den değil.** Aradan hoşgörü süresi geçtiği
  için periodEnd'den saymak o günleri iki kez saymak olurdu.
- **Arşiv adımı reconcile'dan SONRA koşar.** Sayacın başlangıcını 3. adım yazıyor;
  bugün kilitlenen hesabın 30 günü bugün dolmaz. Bir test tam bunu tutuyor.
- **Damga hesabın TÜM üyelerine yazılır** (`disabledModules` deseni) — kapı her istekte
  kullanıcı bağlamından okunuyor, üye başına ek sorgu istemesin.
- **Yalnız YAZMA kapanır.** Kontrol `ensureCompanyWrite`ta, `ensureCompanyAccess`te
  DEĞİL: arşivde okuma açık kalmalı. `ensureCompanyExport`a da bilerek dokunulmadı.
- **Dışa aktarma için DAR bir modül-kapısı istisnası gerekti.** Arşive giden hesap
  `EXPIRED` olduğu için ücretli modülleri kapalı, `/api/export` uçları ise modül
  kapısına tabi — yani "verilerinizi indirin" düğmesi 403 döndürecekti. İstisna
  `isArchiveExportPath`: yalnız `GET`, yalnız `/api/export` (ya da alt yolu — ham
  `startsWith` `/api/exportish`i de kapsardı, test bunu yakaladı), yalnız damgalı
  hesapta. Salt-okunur rol kapısı ayrıca işlemeye devam ediyor.
- **ARŞİVDEN ÇIKIŞ `applyEntitlements` içinde.** Kaçırılırsa en pahalı sessiz hata bu
  olurdu: yeniden abone olan müşteri ödemesini yapar, modülleri açılır, ama `archivedAt`
  dolu kaldığı için **hiçbir şey kaydedemez**. Kural her yeniden aktifleşme yolunun
  (satın alma callback'i, elle grant) geçtiği tek noktada duruyor; ayrı bir "arşivden
  çıkar" çağrısı bir gün unutulurdu. Ölçü ÜCRETSİZ modülleri saymaz — `granted` kümesine
  ücretsizler her hâlükârda ekleniyor, "boş değil" demek yeterli olmazdı.

Arayüz tarafı: arşivdeki hesap zaten `LockedAccount`a düşüyordu (ücretli modülleri
kapalı); ekran artık satış yerine "Hesabınız arşivde — hiçbir veriniz silinmedi" diyor,
veri aktarım ekranına yönlendiriyor ve ADMIN'e "Aboneliği yeniden başlat" sunuyor.
`useCanEditHere` de arşivde `false` dönüyor: sunucu kapısı zaten reddediyor ama düğmeyi
çizip 403 yedirmek arayüzün kullanıcıya yalan söylemesi olurdu.

Doğrulama: `npx tsc --noEmit` temiz · `npx vitest run` 46 dosya / 552 test ·
`npm run build` temiz. **Tarayıcıda elle e2e YAPILMADI** — arşiv ekranını görmek için
canlıda 30 gün önce kilitlenmiş bir hesap ya da elle `archivedAt` damgası gerekir.

### Faz 8 — pakete dahil kota ile ek kotanın ayrışması ✅ (2026-08-31)

**Şikâyet:** "paketin içinde 3 şube kotası var, harici almak istediğimde karışıyor."

Ekran kota sayacında **TOPLAM** kotayı tutuyordu. Paket "3 şube dahil" derken sayaç da
"3" gösteriyordu ve bu sayı iki türlü okunabiliyordu: *pakette var* mı, *ek aldım* mı?
Sonuçları canlıda görüldü:

- Ek şube almak isteyen müşteri 4 mü yazacağını 1 mi bilemiyor; 1 yazınca sayaç sessizce
  3'e geri sıçrıyordu (alt sınır, sebebi yazılmadan).
- "Bunlar zaten bende var, ikinci kez ödemeyeyim" diyip sayacı düşüren müşteri kotasını
  SİLİYORDU. **Gerçekleşti:** `cmojuwru3…` hesabı 13 Ağu'da 1 ek şube aldı, 15 Ağu'da ek
  firma alırken sipariş `branchQuota: 0` taşıdı ve ödenmiş şube kotası yok oldu.
- Paket değiştirmek sepete sessizce ek kalem yazıyordu: kota yalnız büyütülüyordu
  (`Math.max(q, plan.includedBranches)`), 5 şubelik paketten 1 şubeliğe geçen müşteri
  hiçbir yerde yazmadan "4 ek şube" ödüyordu.

**Kural artık tek cümle: sayaç EK (ücretlendirilen) adedi sorar, toplam ondan türer.**

| Ne | Nerede |
|---|---|
| Kırılımın kaynağı | `computeOrder` → `includedBranches` / `extraBranches` / `branchQuota` (ve firma eşleniği) |
| Ekran durumu | `abonelik/page.tsx` → `extraBranches` / `extraCompanies` (toplam DEĞİL) |
| Kota satırı | `QuotaRow` — "Pakete dahil / Ek (ücretli) / **Toplam kota**" üç satır ayrı basılır |
| Takviye kapısı | `planSubscriptionWrite` → `quota-top-up` artık `Math.max(existing, order)` |
| Geçmiş etiketi | `deriveContentLines` → "Şube kotası (toplam)" ("Ek Şube × 4" yanıltıcıydı) |
| Dönem kuralı | `periodEndFor` `lib/billing/period.ts`e taşındı — ekran da aynı tarihi basıyor |

Kararlar:

- **Paket değişince TOPLAM korunur, ek adet yeniden türetilir.** Müşterinin cümlesi
  "5 şubem olsun", "paketin üstüne 5 tane daha" değil. 3 şube içeren pakete geçince ek
  adet 5→2 düşer (kota aynı, fiyat düşer); 1 şubelik pakete geçince 4'e çıkar (kota yine
  aynı, fark artık kırılımda görünür).
- **Sayacın alt sınırı SEBEBİYLE yazılır.** Alt sınır `max(0, açık adet − pakete dahil)`:
  açık şubeler kotasız kalamaz. Yazılmazsa "eksi" düğmesi cevapsız biçimde ölü görünüyor.
- **Kota takviyesi kota DÜŞÜRMEZ.** Sipariş iki kotayı da taşır ama müşteri genellikle
  yalnız birini artırır; diğeri formda 0 kalırsa eskisi silinirdi (yukarıdaki canlı olay).
  Para karşılığı alınmış hak, başka bir ürünün satın alınmasıyla kaybolamaz. Küçültmenin
  meşru yolu modül İÇEREN bir siparişle aboneliği baştan yazmaktır — ve o yol artık
  ekranda `quotaDrops` uyarısı gösteriyor ("şube kotanız 3 → 1 olarak düşer").
- **Siparişin NE OLDUĞU özet kartında yazıyor.** Paket/modül içeren sipariş aboneliği
  baştan yazar ve dönemi bir periyot uzatır (tarih basılır); modülsüz kota siparişi ise
  takviyedir, dönem ve modüller değişmez. Bu iki cümle olmadan "1 şube için neden paketin
  tamamını ödüyorum" sorusu cevapsız kalıyordu.

**Bilerek YAPILMADI — ayrı bir "kota ekle" (pro-rata takviye) akışı.** Bugünkü model
"her sipariş aboneliğin yeni hâlidir": tam periyot bedeli ödenir, tam periyot alınır.
Yanına gün bazlı fiyatlanan ikinci bir satın alma yolu koymak fiyatı, fatura kalemlerini
ve kuponları birden etkilerdi. Kota takviyesi bugünkü hâliyle tam periyot fiyatlıdır.

### Faz 9 — kota takviyesinin PARASI (yenileme tutarı + karşılıksız ödeme kapısı) ✅ (2026-08-31)

Faz 8'in devamı; iki delik de kota takviyesinin üç "yapmaz"ından (dönemi uzatmaz,
modüllere dokunmaz, kotayı düşürmez) doğuyordu.

**1. Yenileme tutarı kaçağı.** `quota-top-up` `Subscription.branchQuota`yı yükseltip
`amount`a hiç dokunmuyordu. `runRecurring` her dönem `sub.amount`ı çekiyor — yani
modülsüz alınan şube/firma kotası **bir kez** ödenip sonraki bütün dönemlerde bedava
sürüyordu. Canlıda kullanılmış bir yol (`resolvedModules: []` siparişler mevcut); bugüne
kadar tahsilata dönüşmemesinin tek sebebi o hesapların hiçbirinde saklı kart olmaması.

Kural (`topUpRenewalAmount`, saf ve testli): tutar siparişin tamamı kadar değil
**EKLENEN kota kadar** artar. Sipariş (paket seçilmediği için) kotanın TAMAMINI
ücretlendirir; hâlihazırda sahip olunan kotayı bir kez daha yenileme tutarına yazmak her
dönem iki kez tahsilat olurdu. Birim fiyat önce siparişin kendi dökümünden
(`priceLines` — müşterinin O AN gördüğü fiyat), yoksa katalogdan okunur; çözülemezse
tutara **hiç** dokunulmaz (yarım bir artış, hiç artış olmamasından yanıltıcı) ve durum
hem log'a hem `QUOTA_CHANGED` olayına yazılır. Yenilemelere işleyen kupon oranı
(`renewalPriceRatio`) eklenen kotaya da uygulanır — yoksa tek seferlik kupon, eklenen
kotanın ömür boyu indirimine dönerdi.

**Yan düzeltme:** takviye dalı `card.token`ı atıyordu. İlk PayTR ödemesi bir takviye olan
hesapta kart hiç saklanmıyor, yani yükselttiğimiz tutar hiçbir zaman çekilemiyordu.
Artık aktifleştirme dalıyla aynı `undefined = dokunma` kuralıyla yazılıyor.

**2. Karşılıksız ödeme kapısı** (`lib/billing/quota-order.ts` → `checkQuotaOnlyOrder`).
Modülsüz sipariş iki durumda para alıp hiçbir şey vermiyordu:

- **Kota artmıyorsa:** takviye dönemi uzatmadığı için müşteri sahip olduğu kotanın
  bedelini bir kez daha öder, karşılığında ne kota ne gün alır. (Ekran eskiden bunu
  teşvik ediyordu: form varsayılan olarak mevcut kotayı yeniden ücretlendiriyordu.)
- **Abonelik aktif değilse:** kota yükselir ama `getAccountQuotas` aktif olmayan hesapta
  kotayı 0 sayar (fail-closed) — ödenen şube yine açılamaz.

Kapı sipariş AÇILIRKEN durur (ödeme sonrası fark edilirse iade gerekir) ve kural saf
tutuldu ki ekran ile uç aynı cevabı versin: arayüz düğmeyi kapatıp sebebi yazar, uç 400
döndürür. Ayrışsalardı kullanıcı ödeme ekranına gidip hata yerdi.

Ayrıca özet kartı artık takviyenin bedelini de söylüyor: "Dönem yenilendiğinde tahsil
edilecek tutar X ₺ artar." Söylenmezse müşteri bir sonraki dönemde beklemediği bir
artışla karşılaşırdı.

**Mevcut kayıtlara DOKUNULMADI.** Kotası yenileme tutarına yansımamış 8 abonelik var ama
hepsi iç/demo/test hesabı ve hiçbirinde saklı kart yok (`runRecurring` zaten atlıyor).
Geriye dönük "doğru tutar" ancak tahminle yazılabilirdi; düzeltme ileriye dönüktür.

Doğrulama: `npx tsc --noEmit` temiz · `npx vitest run` 57 dosya / 661 test ·
`npx next build` temiz. Tarayıcıda elle e2e YAPILMADI.
