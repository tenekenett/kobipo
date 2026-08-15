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
tüzel kişi (kendi ünvanı, adresi, e-Dönüşüm hesabı) ama abonelik ve modüller hesap
kökünden akar. Satın alınarak açılır.

| | şube | ek firma |
|---|---|---|
| kota | `Subscription.branchQuota` | `Subscription.companyQuota` |
| fiyat kalemi | `PricingItem["branch"]` | `PricingItem["company"]` |
| pakete dahil | `Plan.includedBranches` | `Plan.includedCompanies` |

İki kota **ayrı havuzdur**: şube açmak firma hakkını yemez, tersi de geçerli.

Kurallar:

- Hesabı **daima** `resolveAccountRootId()` ile çöz — `parentCompanyId`'ye bakarak kök
  bulmaya çalışma, ek firmayı kaçırırsın.
- Hesap kapsamlı yazma/sayma `accountRootId` üzerinden yapılır (`getAccountCompanyIds`,
  `countAccountBranches`, `countAccountCompanies`, `applyEntitlements`). "Kökün
  şubeleri" (`parentCompanyId: root`) diye sorgulamak ek firmaların şubelerini atlar.
- Kota denetimi ve "kaç tane daha açabilirim" göstergesi **aynı** fonksiyondan gelir:
  `getAccountQuotas()` (`lib/billing/entitlements.ts`). Ayrı hesaplarsan ekran "hakkın
  var" derken API 402 döndürür.
- Yeni firma açan her yol hesabı taşımalı: `/companies/new?account=<firma>`. Taşımazsan
  sunucu ilk-firma moduna düşer ve "zaten bir hesabınız var" (400) döner.
- Kota vermek modül açmak DEĞİLDİR: kota-only siparişte `applyEntitlements` çağrılmaz.
- **Modül yetkisinin kaynağı `Subscription.purchasedModules`tır.** Yalnız
  `company.disabledModules` yazmak yetkiyi KALICI yapmaz: reconcile, yinelenen ödeme,
  "kilitle/sıfırla" ve her yeni sipariş yetkiyi bu alandan yeniden üretir ve elle açılmış
  modüller sessizce kapanır. Elle açarken `setAccountModules()` kullanın (ikisini birden
  yazar, hesabın tümüne uygular).
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
