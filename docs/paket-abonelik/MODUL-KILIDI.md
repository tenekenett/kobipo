# Modül kilidi — "modül yalnızca satın almayla açılır"

**Durum:** kod tarafı bitti (arayüz + sunucu + testler + derleme). Kalan tek iş: canlıya
benzer bir ortamda **elle uçtan uca senaryo** (aşağıda "Kalan iş").
**Tarih:** 2026-08-08 · başlandı · 2026-08-08 tamamlandı

---

## Neden

Tespit (2026-08-08, canlı DB): 24 firmanın 22'sinde `disabledModules` boştu, yani yedi
modülün hepsi açıktı. Üç ayrı sebep:

1. `POST /api/companies` firmayı `disabledModules` alanına hiç dokunmadan yaratıyordu →
   Prisma default'u `[]` → "hiçbiri kapalı". Aynı transaction 1 yıllık `FREE_1Y` TRIAL
   aboneliği açıyordu ama `applyEntitlements` çağrılmıyordu; yani deneme için yazılmış
   "opt-in hariç" kuralı hiç uygulanmıyordu.
2. `disabledModules` bir RED listesi. `restaurant` anahtarı kataloğa sonradan eklendiği
   için daha önce yazılmış listelerde yok → "kilitli" hesaplarda bile açık kalmıştı.
3. Sunucuda modül kontrolü yoktu; nav gizleme ve `ModuleGuard` tamamen istemci tarafında.
   Kapalı modülün `/api/*` ucu elle çağrılabiliyordu.

## Karar

- **Deneme yok.** Yeni firma tüm modüller kapalı doğar; modül yalnızca satın almayla açılır.
- **Sunucu kapısı var.** `/api/*` uçları da modüle göre 403 döner.
- **Mevcut 24 firmaya dokunulmaz.** Kural yalnız bundan sonra açılacak firmalara işler;
  eski hesaplar bugünkü açık hâlleriyle devam eder. Backfill/migration YOK.

---

## Yapıldı

| Dosya | Değişiklik |
|---|---|
| `lib/modules.ts` | `optIn` alanı ve `DEFAULT_TRIAL_MODULE_KEYS` kaldırıldı (tek tüketicisi deneme dalıydı). Başlığa red-listesi uyarısı eklendi: yeni modül eklenirken mevcut satırları kapatan migration gerekir. |
| `lib/billing/entitlements.ts:68` | `resolveGrantedModules` TRIAL dalı silindi → deneme modül vermez, yalnız `isPaidActive` modül açar. `isTrialActive` duruyor; şube kotası hâlâ onu okuyor. |
| `app/api/companies/route.ts:281` | Kök firma `disabledModules: [...MODULE_KEYS]` (kilitli) doğar; **şube ana firmanınkini devralır** (abonelik hesap düzeyinde — eskiden şube boş listeyle tamamen açık doğuyordu, kilitli hesabın şubesi açık kalıyordu). `InheritedFields` tipine `disabledModules` eklendi. |
| `app/api/companies/route.ts:328` | `FREE_1Y` TRIAL aboneliği oluşturma bloğu kaldırıldı. `currentMaxCompanies` aboneliksizken zaten 1 → ikinci bağımsız firma limiti değişmedi. |
| `app/api/system-admin/companies/route.ts:62` | Süper-admin'in açtığı firma da kilitli doğar. |
| `lib/billing/admin.ts` | `reset(mode:"trial")` hâlâ tüm modülleri açıyor — bu bilinçli bir demo/destek override'ı; yorum netleştirildi. |
| `lib/module-access.ts` **(yeni)** | API prefix → modül haritası. `read`/`write` ayrımı var: ürün ve cari okuması satış/alış ekranlarına da açık, yazma sahibi modüle bağlı. En uzun ön ek kazanır. `isApiPathAllowed(path, method, disabledModules)`. |
| `proxy.ts` **(yeni)** | Tek işi istek yolunu/metodunu `x-kobipo-path` / `x-kobipo-method` header'larına yazmak. `matcher: ["/api/:path*"]`. DB'ye dokunmaz. Next 16'da `middleware.ts` deprecate olduğu için `proxy.ts` adıyla ve `export function proxy` olarak duruyor; Node runtime'da koşar. |
| `lib/middleware/company.ts:101,142` | `assertModuleAccess` — `ensureCompanyAccess` içinde header'ı okuyup kapalı modül ucunda `Access denied: module locked (...)` fırlatır. Süper-admin muaf; istek kapsamı dışında (build/cron/script) sessizce atlanır. |
| `lib/middleware/authorization.ts` | `UserRole`'a `disabledModules` eklendi (sunucu sayfaları kilitli hesabı tanısın diye). |
| `components/dashboard/locked-account.tsx` **(yeni)** | Hiç modülü olmayan hesabın karşılama ekranı: modül listesi + "Paket ve modülleri incele" CTA. ADMIN değilse CTA yerine "yöneticinizle görüşün". |
| `app/(dashboard)/dashboard/page.tsx:181` | Tüm modüller kapalıysa widget'lar yerine `LockedAccount`; ağır dashboard sorguları da atlanır. |
| `components/dashboard/module-guard.tsx` | Mesaj "yöneticinize sorun"dan "bu modülü satın al"a çevrildi. ADMIN'e `/ayarlar/abonelik` CTA'sı + modülün kendi açıklaması; diğer rollere yönetici metni. Dil `locked-account.tsx` ile aynı. |
| `app/(dashboard)/companies/onboarding/complete/page.tsx` | Sihirbazın son adımı artık dashboard'a değil `/ayarlar/abonelik`'e bırakıyor (yeni firma kilitli doğduğu için dashboard boştu). İkincil buton dashboard. Her iki buton da tam yeniden yükleme yapar — firma listesi layout'ta sunucuda basılıyor. |
| `lib/module-access.ts` | `ModuleLockedError` + `moduleLockedFrom()` + `MODULE_LOCKED_CODE`. Hata mesajı hâlâ `"Access denied"` ile başlıyor (helper'a geçmemiş uçlar da 403 vermeye devam etsin diye), modül anahtarları ayrı alanda taşınıyor. |
| `lib/api/errors.ts` **(yeni)** | `accessDeniedResponse(error, fallback?)` — modül kilidiyse gövdeye `code: "MODULE_LOCKED"` + `modules: [...]` + Türkçe mesaj koyar; değilse çağıranın eski metnini aynen basar. |
| `app/api/**` (118 dosya, 179 dönüş) | `catch` içindeki `Access denied → 403` blokları `accessDeniedResponse`'a geçirildi (codemod). Gövde şekli `{success:false}` olan 5 e-Dönüşüm/test ucu bilerek dışarıda — modül kuralları zaten onları kapsamıyor. |
| `lib/module-access.test.ts` **(yeni)** | 26 test: okuma/yazma ayrımı, en uzun ön ek, kuralsız yolların hep geçmesi, katalog bütünlüğü, `ModuleLockedError` biçimi. |
| `lib/modules.test.ts` **(yeni)** | `scripts/test-module-gating.mjs` buraya taşındı (script silindi); TRIAL testleri düştü, bağımlılık/reconcile/sanitize testleri kaldı. |

### Genel denetimde çıkan üç açık (aynı gün kapatıldı)

| Ne | Neden kaçmıştı | Düzeltme |
|---|---|---|
| **Menü kilitli hesapta açıktı.** `nav.tsx` seçili firma yokken `disabledModules`'ı BOŞ küme sayıyordu; red listesinde boş = "hepsi açık". Hiç firması olmayan kullanıcı VIEWER'a düşüp sidebar'da "Raporlar" grubunu görüyordu; firması olan kilitli hesapta da seçim çözülene kadar tüm ücretli menüler bir an görünüyordu. | Kapı sunucuda kuruldu ama menü tarafındaki "bilgi yok" hâli gözden kaçtı. | `nav.tsx` fail-closed: firma çözülmediyse `MODULE_KEYS` (hepsi kapalı) varsayılır. |
| **Satın alma ekranı hiç görünmüyordu.** Giriş `roleToDashboardPath` ile `/dashboard/admin`'e (ya da sales/stock/accountant/viewer) gidiyor; `LockedAccount` kontrolü yalnız `/dashboard`'daydı. | `/dashboard` panel sanıldı; oysa oraya yalnız menüdeki "Dashboard" bağlantısı gider. | `isAccountLocked()` yardımcısı + **beş rol panelinin hepsine** aynı kontrol. |
| **`/api/export?module=products` kapıyı deliyordu.** Bu eski uç veri kümesini yolda değil query'de taşıyor; `/api/export/products` kilitliyken aynı ürün/cari/fatura listesi buradan çekilebiliyordu. | Kural tablosu ön ek bazlı, `/api/export` hiçbir ön eke düşmüyordu. | `assertModulePath(context, "/api/export/<dataset>")` — karar yine aynı kural tablosundan. Testte artık **her dataset anahtarının** bir kurala düştüğü doğrulanıyor. |

**Kapsam doğrulaması yapıldı:** kapıya tabi 18 prefix altındaki **116 route dosyasının
tamamı** `ensureCompanyAccess` / `ensureCompanyWrite` üzerinden geçiyor (kapsam dışı: 0) —
tek noktadan kapanıyorlar, dosya dosya kontrol eklemeye gerek yok. Yeni bir uç eklerken
bu iki yardımcıdan birini kullanmak kapıya girmenin şartı.

---

## Doğrulama

Otomatik olan her şey koştu:

```bash
npx tsc --noEmit    # temiz
npm run build       # ✓ Compiled successfully — proxy "/api/:path*" matcher'ıyla kayıtlı
npx vitest run      # 5 dosya / 93 test geçti
```

`proxy.ts`'in header'ları gerçekten route handler'a ulaştırdığı **çalışır hâlde** doğrulandı:
geçici bir uç (`/api/zz-proxy-check`) `{"path":"/api/zz-proxy-check","method":"GET"}` döndü,
sonra silindi. Kapıya girmenin ön şartı olan tek bilinmez buydu; kalanı (`isApiPathAllowed`
kararları) birim testlerde.

> Dikkat: `proxy.ts` **Node runtime**'da koşar (eski `middleware.ts` Edge'deydi). Bizim
> dosya yalnız header yazdığı için fark etmiyor, ama buraya DB/oturum işi eklenecek olursa
> maliyeti artık her `/api/*` isteğinde.

### Kalan iş — elle uçtan uca senaryo

**Yapılmadı, çünkü `.env.local` CANLI Supabase'e bakıyor.** Aşağıdaki adımlar firma/kullanıcı
yaratır ve ödeme akışı çalıştırır; canlı veriye yazmamak için yerel/staging DB ile koşulmalı:

1. Yeni kullanıcı + yeni firma aç → sidebar'da yalnız Dashboard / E-Dönüşüm / Ayarlar
   kalmalı; sihirbazın sonu `/ayarlar/abonelik`'e bırakmalı.
2. Tarayıcı konsolundan `fetch("/api/stok/products?companyId=<id>")` → **403** ve gövdede
   `code: "MODULE_LOCKED"`, `modules: ["stock","sales","purchase","restaurant"]`.
3. `/ayarlar/abonelik` → "Stok" modülünü seç → PayTR test kartıyla öde → callback sonrası
   Stok menüsü açılmalı, aynı fetch 200 dönmeli.
4. Kilitli hesapta şube açmayı dene → aktif abonelik olmadığı için `409 NO_SUBSCRIPTION`
   (kota akışı, modül akışı değil — bu doğru davranış).
5. Mevcut bir firmayla (ör. Demo Firma A.Ş.) gir → **hiçbir şey değişmemiş olmalı**.
6. VIEWER rolüyle bir yazma ucunu çağır → 403 gövdesi eskisi gibi (`code` YOK); modül
   kilidi ile rol reddi karışmamalı.

---

## Bilinen boşluklar (bilinçli)

- **Yön ayrımı yok.** `/api/faturalar`, `/api/irsaliye`, `/api/siparis`, `/api/teklif`
  satış/alış yönünü yolda değil query'de taşıyor; kural "ikisinden biri açıksa geçer".
  Yalnız `purchase` alan bir hesap teorik olarak API'den satış faturası yazabilir.
  Düzeltmek route ayrımı ister.
- **`/api/muhasebe`, `/api/kur`, `/api/fis-tasarim`, `/api/attachments` kapıya tabi değil** —
  nav'da modül grubu karşılıkları yok. Bilerek açık bırakıldı.
- **Sayfalar sunucuda kapatılmıyor.** Kapı yalnız `/api/*`. Sayfa render'ını sunucuda
  kesmek hata sınırına düşürürdü; sayfa tarafını `ModuleGuard` karşılıyor. Bugün bu
  güvenli, çünkü kapıya tabi alanlardaki (stok/satış/alış/finans/raporlar/restoran/cari/
  çek-senet) **24 server sayfasının hiçbiri veri çekmiyor** — hepsi SWR ile API'den okuyan
  istemci bileşenlerinin kabuğu. Bu değişirse (bir sayfa sunucuda prisma sorgusu yaparsa)
  veri, `ModuleGuard` onu gizlese bile RSC yanıtında tarayıcıya gider. Denetim komutu:
  gated sayfalarda `prisma` / `await get*` araması.
- **`optIn` kavramı silindi.** Artık her modül varsayılan kapalı olduğu için "sektörel
  modül denemeye dahil değil" ayrımının tüketicisi kalmadı.
- **`MODULE_LOCKED` kodunu henüz kimse tüketmiyor.** Sunucu gövdeye koyuyor; arayüzde
  403'ü yakalayıp "satın al" diyaloğu açan bir ortak fetch sarmalayıcısı yok. Sayfa kapısı
  `ModuleGuard` olduğu için acil değil — ama kapalı modülün API'sini çağıran bir widget
  bugün yalnız hata metnini gösterir.
- **Abonelik ekranı modül ön-seçimi yapmıyor.** `ModuleGuard`'daki "Bu modülü satın al"
  düz `/ayarlar/abonelik`'e gider; hangi modüle tıklandığı taşınmıyor.
- **KİLİT KENDİLİĞİNDEN KAPANMIYOR.** Ayrıntı ve plan aşağıda: "Bitiş/yenileme".

## Bitiş/yenileme — 3 aşamalı plan

Modül **açılıyor** ama **kapanmıyor**. Sebep tek bir eksik cron değil, birbirine bağlı üç şey:

1. `/api/billing/recurring/run` **iskele** — `chargeRecurringPayment` gerçek çekim yapmıyor
   (canlı PayTR recurring ürünü + saklı kart gerekiyor). Hiçbir abonelik otomatik yenilenmiyor.
2. `/api/billing/reconcile` süresi dolanı `EXPIRED` yapıp `applyEntitlements(root, [])`
   çağırıyor — yani **anında tam kilit**, grace period yok (şemada `PAST_DUE` statüsü
   tanımlı ama kullanılmıyor).
3. Hiçbiri **zamanlanmadı**: `vercel.json`'da `crons` yok, `.github/workflows` yok.

> Bu yüzden reconcile'ı "olduğu gibi" zamanlamak yanlış olur: ödeme yapan müşteri, hiçbir
> uyarı almadan, yenilenme imkânı olmadan dönem sonunda kilitlenir. Sıra önemli.

**Aşama 1 — görünürlük (YAPILDI, kilitleme davranışı DEĞİŞMEDİ).**

| Dosya | Ne yapar |
|---|---|
| `lib/billing/notice.ts` **(yeni)** | `subscriptionNotice()` — uyarının tek karar noktası (7 gün pencere, expiring/expired, iptal işareti). `shouldEmailToday()` eşikleri 7/3/1 gün + bitiş günü; günde bir koşan bir iş varsayıldığı için durum saklamaz. |
| `lib/billing/notice.test.ts` **(yeni)** | 12 test: gün sınırları, TRIAL'ın uyarılmaması, EXPIRED'ın tarihe bakmaması, bitmiş abonelikte e-postanın her gün tekrarlanmaması. |
| `GET /api/billing/notice` **(yeni)** | Banner'ı besleyen hafif uç (catalog ağır, banner her sayfada). Modül kapısına tabi DEĞİL — kilitli hesap da durumunu görebilmeli. |
| `components/dashboard/subscription-notice-banner.tsx` **(yeni)** | Panel üstü şerit; ADMIN'e "Aboneliği yenile" CTA'sı, diğer rollere yönetici metni. Şubede de görünür (abonelik hesap düzeyinde). |
| `lib/email/templates.ts` | `subscriptionNoticeEmail()` — expiring/expired tek şablon. |
| `POST /api/billing/notify-expiring` **(yeni)** | Cron korumalı gönderici. Hiçbir erişimi kesmez. **Zamanlanmadı** — Aşama 2'de bağlanacak. |

**Aşama 2 — grace period'lı kapanış (YAPILDI).**

| Dosya | Ne yapar |
|---|---|
| `lib/billing/constants.ts` | `GRACE_PERIOD_DAYS = 7` — dönem bittikten sonra erişimin açık kaldığı süre. |
| `lib/billing/entitlements.ts` | `isInGracePeriod()` + `resolveGrantedModules` artık hoşgörüyü de "açık" sayıyor. **Bu satır olmadan hoşgörü işe yaramazdı**: yetkiler her yeniden hesaplandığında (recurring, süper-admin, başka bir reconcile) `PAST_DUE` müşteri anında kilitlenirdi. |
| `lib/billing/notice.ts` | `reconcileAction()` — "hoşgörüye al / kilitle / dokunma" kararı, saf ve testli. Ayrıca uyarıya `locksAt` eklendi: kullanıcıya söylenen tarih artık dönem bitişi değil **modüllerin gerçekten kapanacağı** gün. |
| `lib/billing/jobs.ts` **(yeni)** | Üç iş (notify / recurring / reconcile) tek dosyada, sırası yorumla sabitlenmiş. Uçlar buranın ince sarmalayıcısı oldu. |
| `POST\|GET /api/billing/cron/daily` **(yeni)** | Tek zamanlanan uç: üçünü **sırayla** çalıştırır, adım adım raporlar, bir adımın hatası diğerlerini durdurmaz. GET kabul eder (Vercel Cron GET atar). |
| `lib/billing/cron-auth.ts` | `CRON_SECRET` de kabul ediliyor — Vercel Cron bu adı kendisi kullanıyor, aynı gizli değeri iki env'e kopyalamaya gerek kalmasın. |
| `app/api/billing/recurring/run` | Sorgu `PAST_DUE`'yu da tarıyor. Eskiden ilk başarısız çekimden sonra abonelik bir daha HİÇ denenmiyordu (statü `ACTIVE`'den çıkıyordu, sorgu yalnız `ACTIVE`'e bakıyordu). |
| `vercel.json` | **Değişmedi — `crons` girdisi bilerek EKLENMEDİ.** Karar (2026-08-08): abonelik yenileme/kilitleme konusuna şimdilik girilmiyor, satın alan kullanmaya devam ediyor. |

Yeni akış, ödemesi alınamayan bir abonelikte:

```
periodEnd          → recurring dener (bugün iskele → "pending"), reconcile PAST_DUE yazar,
                     MODÜLLER AÇIK KALIR, e-posta gider
+1..+6 gün         → recurring her gün yeniden dener; panelde kırmızı şerit
+7 gün (GRACE)     → reconcile EXPIRED yazar, applyEntitlements ile modüller kapanır
```

İstisna: kullanıcı dönem sonunda iptali kendisi istediyse (`cancelAtPeriodEnd`) hoşgörü
uygulanmaz, `periodEnd`'de kapanır. Süresi dolan deneme de hoşgörüsüzdür (süper-admin'in
açtığı demo hesap bu yolla kapanır).

**Aşama 3 — gerçek yinelenen çekim (YAPILMADI).** PayTR saklı kart devreye girince
kilitleme kural değil istisna olur; `notice.ts` ve e-posta metinlerindeki "otomatik
yenileme henüz devrede değil" dili o zaman güncellenmeli (dosyalarda not düşüldü).

### Şu an ne çalışıyor, ne çalışmıyor

**Karar (2026-08-08): abonelik bitişi ZORLANMIYOR.** Satın alan kullanmaya devam eder;
konuya sonra dönülecek. Bu yüzden:

- `vercel.json`'a `crons` **eklenmedi** → `/api/billing/cron/daily` hiçbir zaman kendiliğinden
  çalışmaz. Kod, testler ve hoşgörü mantığı yerinde ama **uykuda**.
- Panel şeridi (`SubscriptionNoticeBanner`) çalışıyor ama **"modülleriniz kapanacak"
  DEMİYOR** — bugün kapanmıyor, olmayan bir kesintiyi duyurmak yanıltıcı olurdu. Sadece
  "dönem doldu / yenileyebilirsiniz" diyor.
- Uyarı e-postaları uykuda (yalnız cron uçlarından gönderiliyor).
- `applyEntitlements`'ı çağıran tek canlı yol PayTR callback'i: satın alma modülleri açar,
  hiçbir şey kapatmaz.

**Açmak istendiğinde yapılacaklar** (üçü birlikte, ayrı ayrı değil):

1. `vercel.json`'a `crons` girdisini ekle:
   `{ "path": "/api/billing/cron/daily", "schedule": "0 6 * * *" }` (UTC → 09:00 TRT).
2. `BILLING_CRON_SECRET` (ya da Vercel'in `CRON_SECRET`'ı) Vercel ortamında tanımlı olsun.
   Tanımsızsa `isCronAuthorized` fail-closed davranır: cron her gün 401 alır, hiçbir iş
   çalışmaz ve bu **sessizdir** — Vercel cron loglarına bakmadan fark edilmez.
3. `subscription-notice-banner.tsx` ve `subscriptionNoticeEmail`'deki kapanış cümlesini
   (`notice.locksAt` tarihi) geri koy — dosyalarda not düşüldü.

Ayrıca Aşama 3 (gerçek yinelenen çekim) eksik olduğu sürece, cron açıldığında her ücretli
müşteri dönem sonu + `GRACE_PERIOD_DAYS` içinde kilitlenir. Yani sıralama şu olmalı:
**önce Aşama 3, sonra cron.**

Yerelde doğrulanan: yetkisiz GET/POST → 401 (canlı veriye dokunmadan). Uçtan uca koşu
canlı olmayan bir DB gerektirdiği için yapılmadı.

## Kısayol: bu işin dosyaları

Çalışma ağacında **vardiya/personel işi de duruyor** — commit ederken karıştırmayın.
Bu işe ait olanlar:

```
lib/modules.ts
lib/modules.test.ts             (yeni)
lib/module-access.ts            (yeni)
lib/module-access.test.ts       (yeni)
lib/api/errors.ts               (yeni)
lib/billing/entitlements.ts
lib/billing/admin.ts
lib/billing/notice.ts                   (yeni · Aşama 1)
lib/billing/notice.test.ts              (yeni · Aşama 1)
lib/email/templates.ts                  (subscriptionNoticeEmail)
app/api/billing/notice/route.ts         (yeni · Aşama 1)
app/api/billing/notify-expiring/route.ts (yeni · Aşama 1, ZAMANLANMADI)
components/dashboard/subscription-notice-banner.tsx (yeni · Aşama 1)
app/(dashboard)/layout.tsx              (banner)
lib/middleware/company.ts               (assertModulePath dahil)
lib/middleware/authorization.ts
components/dashboard/nav.tsx            (fail-closed modül kümesi)
app/api/export/route.ts                 (query'deki dataset kapıya bağlandı)
app/(dashboard)/dashboard/{admin,accountant,sales,stock,viewer}/page.tsx
proxy.ts                        (yeni)
app/api/companies/route.ts
app/api/system-admin/companies/route.ts
app/api/**/route.ts             (codemod: accessDeniedResponse — 118 dosya)
app/(dashboard)/dashboard/page.tsx
app/(dashboard)/companies/onboarding/complete/page.tsx
components/dashboard/locked-account.tsx  (yeni)
components/dashboard/module-guard.tsx
scripts/test-module-gating.mjs           (SİLİNDİ → lib/modules.test.ts)
docs/paket-abonelik/MODUL-KILIDI.md      (bu dosya)
```
