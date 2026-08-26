# Abonelik sistemini tamamlama — plan ve ilerleme

**Durum:** Faz 0-3 bitti · Faz 4-8 bekliyor · 2026-08-27
**Kapsam:** otomatik yenileme, müşteri abonelik ekranı, sistem-admin süre verme, cron'un
ayağa kaldırılması, periyoda göre hoşgörü, arşiv kademesi.

---

## ▶ DEVAM NOKTASI (başka makinede buradan başla)

**Son durum:** 7+1 fazın 4'ü (Faz 0, 1, 2, 3) yazıldı ve doğrulandı.
`npx tsc --noEmit` temiz · `npx vitest run` → 43 dosya / 512 test geçti.
**Hiçbir şey canlıya uygulanmadı ve deploy edilmedi.**

### 1. Önce bunu çalıştır (migrasyon canlıya UYGULANMADI)

```bash
node scripts/apply-migration.js supabase/migrations/20260827000001_abonelik_olay_cron_arsiv.sql
npx prisma generate
```

Migrasyon: `subscription_events` + `cron_runs` tabloları, `companies.archivedAt`,
`subscriptions.lockedAt / lastNoticeThreshold / lastNoticeSentAt / cardBrand / cardLast4`.
Uygulanmadan Faz 0-3 kodu çalışmaz (Prisma alanları DB'de yok).

### 2. ⚠️ Enforcement AÇILDI — bilinçli bir karar

`vercel.json`'a `crons` girdisi eklendi (`/api/billing/cron/daily`, 06:00 UTC) ve
**main'e push edildi** (2026-08-27, kullanıcı onayı). Vercel main'i otomatik deploy
ediyorsa iş ilk 06:00 UTC'de koşar ve dönemi geçmiş hesaplar `PAST_DUE` → `EXPIRED`
yürümeye başlar.

Karar gerekçesi: kapanma **geri alınabilir** — `purchasedModules` ve tüm müşteri verisi
korunuyor, Faz 8 betiği dönemi bugüne alıp `applyEntitlements` çağırdığında modüller
aynen geri açılıyor (ayrıntı: Faz 8 bölümü).

Şunu unutma:

- `BILLING_CRON_SECRET` (veya Vercel'in `CRON_SECRET`'ı) tanımlı DEĞİLSE uç 401 döner ve
  iş hiç koşmaz — `cron_runs` tablosu boş kalır. Önce bunu doğrula.
- **Geri alınamayan tek şey e-postadır:** kilitlenen/hoşgörüye düşen hesapların
  ADMIN'lerine "aboneliğiniz sona erdi / ödemeniz alınamadı" e-postası gider. Modülleri
  geri açmak gönderilmiş e-postayı geri almaz. Acele frenlemek gerekirse `crons` bloğunu
  `vercel.json`'dan çıkarıp deploy etmek yeter.
- Faz 8 ne kadar gecikirse o kadar çok hesap kilitlenir. **İlk iş o.**

### 3. Sıradaki iş

| Sıra | Faz | Not |
|---|---|---|
| **1.** | **Faz 8 — dönemleri bugünden başlat** | Enforcement'ın ön şartı. Betik YAZILMADI; önce 3 sorunun cevabı lazım (Faz 8 bölümüne bkz.) |
| 2. | Faz 4 — müşteri abonelik ekranı | Bilinmezi yok, doğrudan yazılabilir |
| 3. | Faz 5 — sistem-admin süre verme | Bilinmezi yok. Form "ödeme alındı (havale/elden)" kutulu olacak |
| 4. | Faz 6 — erken yenileyenin gün kaybı | Küçük ama para/hak konusu |
| 5. | Faz 7 — arşiv (30 gün) | En son |

### 4. Bekleyen dış bağımlılık — PayTR

Otomatik yenileme kodu tam ama **`PAYTR_RECURRING_ENABLED` ile kapalı doğdu**: mağaza
hesabında "Tekrarlayan Ödeme" ürününün açık olup olmadığı bilinmiyor. Ne sorulacağı,
açma sırası ve test adımları → `PAYTR-RECURRING-KONTROL.md`.

Bayrak kapalıyken sistem tutarlı: tahsilatı müşteri başlatır, hiçbir yanlış işlem olmaz.

### 5. Dokunulan dosyalar (bu turda)

```
YENİ  docs/paket-abonelik/ABONELIK-TAMAMLAMA.md      (bu dosya — plan + ilerleme)
YENİ  docs/paket-abonelik/PAYTR-RECURRING-KONTROL.md
YENİ  supabase/migrations/20260827000001_abonelik_olay_cron_arsiv.sql
YENİ  lib/billing/events.ts                          (olay günlüğü)
YENİ  lib/billing/cron-run.ts                        (koşum kaydı + kilit)
      prisma/schema.prisma                           (2 yeni model, 6 yeni alan)
      vercel.json                                    (crons — DEPLOY UYARISI!)
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

### Faz 8 — Mevcut hesapların dönemi BUGÜNDEN başlasın ⚠️ YAPILMADI

**İstek (2026-08-27, kullanıcı):** "hesapların aboneliği bu günden başlamalı."

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
- [ ] **Faz 8 — mevcut dönemleri bugünden başlat** ← enforcement'ın ön şartı, SIRADAKİ
- [ ] Faz 4 — müşteri abonelik ekranı
- [ ] Faz 5 — sistem-admin süre verme
- [ ] Faz 6 — düzeltmeler
- [ ] Faz 7 — arşiv

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
