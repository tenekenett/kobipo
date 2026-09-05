# Kobipo — geliştirme notları

## Panel linkleri: `?company=` MUTLAKA taşınmalı

Seçili firma/şube bağlamının **tek kaynağı** URL'deki `?company=` param'ıdır. Panel
sayfalarının neredeyse tamamı companyId'yi `searchParams.get("company")` ile okuyup
API'lere `companyId=` olarak geçer. Param taşımayan bir link/redirect bağlamı düşürür ve
kullanıcı sessizce **başka firmanın verisine** geçer.

Bu yüzden panel içi (`app/(dashboard)/**`) her gezinme şu iki yoldan biriyle yazılır:

```tsx
// Client component → aktif seçimi otomatik ekler
import { CompanyLink } from "@/components/dashboard/company-link"
<CompanyLink href="/cari">Cari hesaplar</CompanyLink>

// Server component, router.push, redirect → firmayı açıkça ver
import { withCompanyHref } from "@/lib/company/href"
<Link href={withCompanyHref("/stok", companyId)} />
redirect(withCompanyHref("/restoran/menu", company))
```

**Kritik istisna:** sayfa, AKTİF seçimden *farklı* bir firmanın verisini gösteriyorsa link o
firmanın id'sini taşımalı — aktif seçimi değil. Örnek: şube detay sayfası
(`ayarlar/subeler/[id]`) şubenin rakamlarını basar ama seçim ana firmadadır; kartlardaki
linkler `companyId` prop'una bağlanır. Burada `CompanyLink` kullanmak YANLIŞ olur.

Aynı kural rol için de geçerli: rol firma bazındadır, `useDashboardCompany().userRole`
seçili firmadan türer — ilk firmanın rolü varsayılmaz.

> 2026-07 tarihinde ~55 link/redirect bu kuralı ihlal ettiği için "her menüde seçili şubenin
> dışına çıkma" hatası yaşandı. Geçmişi: `docs/` yerine git log — `withCompanyHref` commit'i.

## Şube ≠ firma: iki ayrı eksen, iki ayrı kota

`Company` üzerinde birbirine benzeyen ama ASLA karıştırılmaması gereken iki alan var:

```
parentCompanyId  → ŞUBE:     aynı tüzel kişinin ikinci adresi.
                   VKN/vergi dairesi/e-Dönüşüm ana firmadan DEVRALINIR.
accountRootId    → HESAP:    faturalama kökü. Hesabın TÜM üyelerinde (şubeler VE ek
                   firmalar) kökün id'si yazılıdır; kökün kendisinde null'dır.
```

**Ek firma** = `parentCompanyId` null + `accountRootId` dolu: ayrı VKN'li bağımsız bir
tüzel kişi (kendi ünvanı, adresi, e-Dönüşüm hesabı). Hesaptan devraldığı tek şey KOTA
hakkıdır; aboneliği ayrıdır. Satın alınarak açılır.

| | şube | ek firma |
|---|---|---|
| kota | `Subscription.branchQuota` | `Subscription.companyQuota` |
| fiyat kalemi | `PricingItem["branch"]` | `PricingItem["company"]` |
| pakete dahil | `Plan.includedBranches` | `Plan.includedCompanies` |

İki kota **ayrı havuzdur**: şube açmak firma hakkını yemez, tersi de geçerli.

## Abonelik FİRMA bazındadır — yetki devretmez

2026-09-04'te değişti: her firma (kök, şube, ek firma) kendi aboneliğini satın alır.
Ana firmanın ödemesi şubeyi AÇMAZ; şubenin süresi dolunca ana firma kapanmaz. Ayrıntı ve
geçiş: `docs/paket-abonelik/FIRMA-BAZLI-ABONELIK.md`.

- Yetkinin kaynağı **firmanın kendi aboneliğidir**: `getCompanySubscription(companyId)`.
  `getAccountSubscription` yalnız KOTA içindir, modül sorusuna cevap vermez.
- `applyEntitlements(companyId, granted)` **tek firmaya** yazar; elle modül verme
  `setCompanyModules()`. (Eski adları hesap kapsamlıydı: `setAccountModules`.)
- Yeni şube/ek firma **kilitli doğar** (`defaultDisabledModules(free)`) — modül devri yok.
- **Kota yalnız hesap kökünden satın alınır** (şube kendi şubesini açamaz: sonsuz döngü).
  Kapı üç yerde: uç 400, ekranda kart gizli, tutar hesabında kota 0.
- **Satın almayı hesap yöneticisi yapar** — şubeye atanmış ADMIN ödeyemez (uç 403).
- Kilit ve arşiv de firma bazındadır: süresi dolan şube tek başına salt-okunura geçer.

Kurallar:

- Hesabı **daima** `resolveAccountRootId()` ile çöz — `parentCompanyId`'ye bakarak kök
  bulmaya çalışma, ek firmayı kaçırırsın.
- Hesap kapsamlı yazma/sayma `accountRootId` üzerinden yapılır (`getAccountCompanyIds`,
  `countAccountBranches`, `countAccountCompanies`). "Kökün şubeleri"
  (`parentCompanyId: root`) diye sorgulamak ek firmaların şubelerini atlar.
  `applyEntitlements` bu listede DEĞİLDİR: yetki firma bazındadır (yukarı bak).
- Kota denetimi ve "kaç tane daha açabilirim" göstergesi **aynı** fonksiyondan gelir:
  `getAccountQuotas()` (`lib/billing/entitlements.ts`). Ayrı hesaplarsan ekran "hakkın
  var" derken API 402 döndürür.
- Yeni firma açan her yol hesabı taşımalı: `/companies/new?account=<firma>`. Taşımazsan
  sunucu ilk-firma moduna düşer ve "zaten bir hesabınız var" (400) döner.
- Kota vermek modül açmak DEĞİLDİR: kota-only siparişte `applyEntitlements` çağrılmaz.
- **SATIN ALINAN modül yetkisinin kaynağı `Subscription.purchasedModules`tır.** Yalnız
  `company.disabledModules` yazmak yetkiyi KALICI yapmaz: reconcile, yinelenen ödeme,
  "kilitle/sıfırla" ve her yeni sipariş yetkiyi bu alandan yeniden üretir ve elle açılmış
  modüller sessizce kapanır. Elle açarken `setCompanyModules()` kullanın (ikisini birden
  yazar, kapsam o firmadır).
- **TEMEL (ücretsiz) modülün kaynağı ise `PricingItem.isFree`tir** — abonelikten
  bağımsızdır ve `purchasedModules`a ASLA yazılmaz. Yazılırsa modül sonradan ücretliye
  çevrildiğinde o hesapta "satın alınmış" görünüp bedava açık kalır. Küme
  `getFreeModuleKeys()` ile okunur; `applyEntitlements` her uygulamada ekler, yani
  ücretsiz modül hiçbir yeniden hesaplamada kapanmaz — TEK istisna aşağıdaki elle
  kapatmadır. Sonuçları:
  - Yeni firma `defaultDisabledModules(free)` ile doğar (ücretsizler açık).
  - **`isAccountLocked(disabled)` ücretsiz kümeyi OKUMAZ** (2026-09-05'te değişti):
    ölçü "firmanın hiç açık modülü yok mu". Eski ölçü yalnız ücretli modüllere bakıyordu
    ve 2026-08-31'de yedi modülün altısı temel yapılınca sessizce başka bir soruya
    dönüştü — "hiçbir şey almamış" ile "Restoran almamış" aynı şey oldu; altı modülü
    açık çalışan 15 firmanın panosu satın alma duvarına düştü, sistem-admin kartı ise
    doğru biçimde 6/7 açık gösteriyordu. Kilit ekranını ücretli/ücretsiz ayrımına geri
    bağlamayın. Karar tek yerde: `lib/dashboard/locked.ts` → `lockedScreenFor` (altı
    pano sayfası oradan geçer). Arşiv ekranı da orada ve kilitten BAĞIMSIZ sorulur.
  - Satın alma tanıtımı erişimi engellemez: kapalı ücretli modüller panonun üstündeki
    kapatılabilir şeritte duyurulur (`components/dashboard/module-upsell-banner.tsx`).
    `LockedAccount` yalnız gerçekten sıfır modüllü firmada çıkar.
  - Gereksinimi ücretli olan modül ücretsiz YAPILAMAZ (restoran → stok); yoksa
    bağımlılık tamamlama ücretli modülü bedavaya açar.
  - Küme değişince mevcut hesaplar `syncFreeModuleGrants()` ile hizalanır; satın alınmış
    modül kapatılmaz. Ayrıntı: `docs/paket-abonelik/TEMEL-MODULLER.md`.
- **Ücretli modülü satın alma OLMADAN açmanın yeri `Company.grantedModules`tır**
  (firma bazında, sistem-admin modül kartı). Ölçü `setCompanyModules` içindeki saf
  `planModuleRecords`ta: firmanın ücretli-aktif (ya da hoşgörüde) aboneliği varsa modül
  `Subscription.purchasedModules`a yazılır ve yenilemede faturalanır; yoksa aynı modül
  `grantedModules`a BEDELSİZ yazılır — faturalanmaz, süresi dolmaz ve hiçbir yeniden
  hesaplamada kapanmaz. İkisini birleştirmeyin: bedelsiz modül `purchasedModules`a
  yazılırsa abonelik parası alınmamış modülü faturalamaya başlar. Kapatma iki kayıttan
  da düşer. (Öncesinde elle açılan modül `purchasedModules`a yazılıyor ve deneme/süresi
  dolmuş firmada ilk reconcile'da sessizce kapanıyordu; uç bunu `durable:false` ile
  söylüyor ama düzeltmiyordu.)
- **Ücretsiz modülü ELLE kapatmanın yeri `Company.suppressedModules`tır** (firma bazında,
  sistem-admin modül kartı). `disabledModules`a yazmak yetmez: orası her yetki
  hesaplamasında yeniden üretilir. Kurallar:
  - Kapatma yalnız ÜCRETSİZ modüller için ifade edilir (`sanitizeSuppressedModules`).
    Ücretli modülü kapatmak = `purchasedModules`tan düşürmek; aksi halde abonelik
    kullanılmayan modülü faturalamaya devam eder.
  - Kapatılan modülün BAĞIMLILARI da kapanır (`applySuppression`) — yön
    `withModuleDependencies`in tersidir; karıştırılırsa "Stok'u kapat" sessizce geri alınır.
  - `setAccountModules`a `suppression` verilmezse mevcut kapatmalara DOKUNULMAZ. Reconcile
    ve "kilitle/sıfırla" bu bilgiyi taşımadan çağırıyor; çıkarım yapılsa hesabın tüm temel
    modülleri sessizce kapanırdı.
  - Modül ücretliye çevrilirse kapatma kaydı `syncFreeModuleGrants()` ile düşer.
- **Firma YALNIZCA `lib/company/create-company.ts` içinden yazılır.** Erişim, rol ve kota
  denetimi orada; uçlar sadece gövdeyi normalize edip `createCompany(...)` çağırır. Kuralı
  uca kopyalamak, kotayı bilmeyen ikinci bir kapı açar. Sapmayı yakalamak için:

  ```bash
  npm run check:company-create   # ortak modül dışında company.create çağrısı var mı
  ```
- Üyeliksiz yönetici erişimi hesabı da kapsar (`lib/auth/branch-access.ts`): ADMIN
  olduğun firmanın şubeleri + ADMIN olduğun hesabın üyeleri (ek firmalar ve onların
  şubeleri). Yönetilebilir birim listeleyen her uç kapsamı `canManageCompany` ile aynı
  tutmalı — biri diğerinden dar kalırsa "listede yok ama atama yapılabiliyor" doğar.

> Bu ayrım 2026-08'de kuruldu. Öncesinde firma hakkı `Plan.maxCompanies`'ten geliyor ve o
> da şube adedinden türetiliyordu (`includedBranches + 1`); şube açmak firma hakkını
> yiyordu ve satılabilir bir "ek firma" ürünü yoktu. Ayrıntı:
> `docs/paket-abonelik/ILERLEME.md` (2026-08-15 bölümü).

## Yeni tablo → RLS açılacak

`public` şemadaki her tablo RLS **açık ve policy'siz** (default deny) tutulur; veriye
erişimin tek yolu uygulamanın `postgres` bağlantısıdır (sahip + `rolbypassrls`, RLS'i
atlar). Bu, Supabase Data API'si kazara açılırsa devreye giren ikinci duvardır — tek
başına grant katmanına güvenilmez.

Yeni tablo ekleyen her migrasyonun sonuna:

```sql
ALTER TABLE public.<tablo> ENABLE ROW LEVEL SECURITY;
```

Policy **yazma**: policy eklemek default-deny'ı deler. Sapmayı yakalamak için:

```bash
npm run check:rls   # RLS'siz tablo, anon'a verilmiş yetki, beklenmedik bucket
```

Duruşu kuran migrasyon: `supabase/migrations/20260811000003_rls_lockdown.sql`.
