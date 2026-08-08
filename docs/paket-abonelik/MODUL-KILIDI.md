# Modül kilidi — "modül yalnızca satın almayla açılır"

**Durum:** yarım. Sunucu tarafı bitti, arayüz ve doğrulama kaldı.
**Tarih:** 2026-08-08 · **Devam:** başka bilgisayarda

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
| `middleware.ts` **(yeni)** | Tek işi istek yolunu/metodunu `x-kobipo-path` / `x-kobipo-method` header'larına yazmak. `matcher: ["/api/:path*"]`. Edge'de çalışır, DB'ye dokunmaz. |
| `lib/middleware/company.ts:101,142` | `assertModuleAccess` — `ensureCompanyAccess` içinde header'ı okuyup kapalı modül ucunda `Access denied: module locked (...)` fırlatır. Süper-admin muaf; istek kapsamı dışında (build/cron/script) sessizce atlanır. |
| `lib/middleware/authorization.ts` | `UserRole`'a `disabledModules` eklendi (sunucu sayfaları kilitli hesabı tanısın diye). |
| `components/dashboard/locked-account.tsx` **(yeni)** | Hiç modülü olmayan hesabın karşılama ekranı: modül listesi + "Paket ve modülleri incele" CTA. ADMIN değilse CTA yerine "yöneticinizle görüşün". |
| `app/(dashboard)/dashboard/page.tsx:181` | Tüm modüller kapalıysa widget'lar yerine `LockedAccount`; ağır dashboard sorguları da atlanır. |

**Kapsam doğrulaması yapıldı:** kapıya tabi 18 prefix altındaki **116 route dosyasının
tamamı** `ensureCompanyAccess` / `ensureCompanyWrite` üzerinden geçiyor (kapsam dışı: 0) —
tek noktadan kapanıyorlar, dosya dosya kontrol eklemeye gerek yok. Yeni bir uç eklerken
bu iki yardımcıdan birini kullanmak kapıya girmenin şartı.

---

## Kalan iş

### 1. ModuleGuard'a satın alma CTA'sı
`components/dashboard/module-guard.tsx` — bugün yalnız "Bu modül kapalı, sistem
yöneticinizle iletişime geçin" diyor. Yeni kurguda doğru mesaj "bu modülü satın alın":

- `useDashboardCompany()`'den `userRole` de al.
- ADMIN ise `CompanyLink href="/ayarlar/abonelik"` → "Bu modülü satın al" butonu; değilse
  mevcut yönetici metni kalsın.
- Metni `LockedAccount` ile aynı dille yaz (o dosya referans).

> Not: bu düzenleme başlanıp geri alındı, dosya temiz hâlde. Sıfırdan yapılabilir.

### 2. Kilitli hesabın onboarding sonrası akışı
Firma açıldıktan sonra kullanıcı `/dashboard`'a düşüyor ve `LockedAccount` görüyor. Karar
verilecek: onboarding sihirbazının son adımı doğrudan `/ayarlar/abonelik`'e mi bıraksın?
(`app/(dashboard)/companies/new` ve onboarding redirect'lerine bakılacak.)

### 3. 403 gövdesine makine-okunur kod
Şu an kapı `Access denied: module locked (sales|purchase)` fırlatıyor; route catch'leri
bunu `{ error: "Access denied" }` + 403'e mapliyor. Arayüz "satın al" diyalogunu
tetikleyebilsin diye `code: "MODULE_LOCKED"` taşınmalı. 63 dosyaya dokunmadan yapmanın
yolu: ortak bir `handleApiError` yardımcısı (yoksa yazılacak) ve route'ların kademeli
geçişi. **Bloklayıcı değil** — arayüz kapısı zaten `ModuleGuard`.

### 4. Testler
- `scripts/test-module-gating.mjs` — `DEFAULT_TRIAL_MODULE_KEYS` testleri artık **kırık**
  (sabit kaldırıldı, script onu destructure ediyor). Bu blok silinecek, yerine
  `lib/module-access.ts` testleri gelecek:
  - `/api/stok/products` GET → `stock` kapalı + `sales` açıkken **geçer**
  - aynı yol POST → `stock` kapalıyken **reddedilir**
  - `/api/restoran/adisyonlar` → `restaurant` kapalıyken reddedilir
  - `/api/export/rapor-personel` → `reports` kapalı + `hr` açıkken geçer
  - `/api/ayarlar/...`, `/api/billing/...` gibi kuralsız yollar → her zaman geçer
  - en uzun ön ek kazanır: `/api/cari/customers` kuralı `/api/cari`yi ezer
  - kuraldaki her anahtar `MODULE_KEYS` içinde (yazım hatası koruması)
- Repoda artık `vitest` var (`vitest.config.mts`, vardiya işinden geldi) — bu testler
  `.mjs` script yerine `lib/module-access.test.ts` olarak yazılabilir; tercih edilen bu.

### 5. Derleme + duman testi (HİÇ ÇALIŞTIRILMADI)
Bu değişiklikler **derlenmedi ve çalıştırılmadı**. Sırayla:

```bash
npx tsc --noEmit          # tip kontrolü
npm run build             # middleware.ts'i Next'in tanıdığını da doğrular
```

Elle senaryo (yerel, PayTR test modu `.env.local`'de hazır):

1. Yeni kullanıcı + yeni firma aç → sidebar'da yalnız Dashboard / E-Dönüşüm / Ayarlar
   kalmalı, `/dashboard` `LockedAccount` göstermeli.
2. Tarayıcı konsolundan `fetch("/api/stok/products?companyId=<id>")` → **403**.
3. `/ayarlar/abonelik` → "Stok" modülünü seç → PayTR test kartıyla öde → callback sonrası
   Stok menüsü açılmalı, aynı fetch 200 dönmeli.
4. Kilitli hesapta şube açmayı dene → aktif abonelik olmadığı için `409 NO_SUBSCRIPTION`
   (kota akışı, modül akışı değil — bu doğru davranış).
5. Mevcut bir firmayla (ör. Demo Firma A.Ş.) gir → **hiçbir şey değişmemiş olmalı**.

---

## Bilinen boşluklar (bilinçli)

- **Yön ayrımı yok.** `/api/faturalar`, `/api/irsaliye`, `/api/siparis`, `/api/teklif`
  satış/alış yönünü yolda değil query'de taşıyor; kural "ikisinden biri açıksa geçer".
  Yalnız `purchase` alan bir hesap teorik olarak API'den satış faturası yazabilir.
  Düzeltmek route ayrımı ister.
- **`/api/muhasebe`, `/api/kur`, `/api/fis-tasarim`, `/api/attachments` kapıya tabi değil** —
  nav'da modül grubu karşılıkları yok. Bilerek açık bırakıldı.
- **Sayfalar sunucuda kapatılmıyor.** Kapı yalnız `/api/*`. Sayfa render'ını sunucuda
  kesmek hata sınırına düşürürdü; sayfa tarafını `ModuleGuard` karşılıyor.
- **`optIn` kavramı silindi.** Artık her modül varsayılan kapalı olduğu için "sektörel
  modül denemeye dahil değil" ayrımının tüketicisi kalmadı.

## Kısayol: bu işin dosyaları

Çalışma ağacında **vardiya/personel işi de duruyor** — commit ederken karıştırmayın.
Bu işe ait olanlar:

```
lib/modules.ts
lib/module-access.ts            (yeni)
lib/billing/entitlements.ts
lib/billing/admin.ts
lib/middleware/company.ts
lib/middleware/authorization.ts
middleware.ts                   (yeni)
app/api/companies/route.ts
app/api/system-admin/companies/route.ts
app/(dashboard)/dashboard/page.tsx
components/dashboard/locked-account.tsx  (yeni)
docs/paket-abonelik/MODUL-KILIDI.md      (bu dosya)
```
