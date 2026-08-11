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
