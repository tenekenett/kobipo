# Firma bazlı abonelik — "yetki devretmez"

**Durum:** kod tarafı bitti (sunucu + arayüz + testler). Kalan: geçiş betiğinin canlıda
çalıştırılması ve tarayıcı doğrulaması — bkz. aşağıdaki **▶ DEVAM** bölümü.
**Tarih:** 2026-09-04

---

## Karar

Abonelik artık **firma** düzeyindedir. Kayıt sırasında açılan firma kendi aboneliğini alır;
o firmanın **şubeleri** ve sonradan kotayla açılan **ek firmaları** bu abonelikten hiçbir
modül devralmaz — her biri kendi aboneliğini satın alır.

Öncesinde abonelik hesap kökünde duruyordu ve `applyEntitlements` hesabın tüm üyelerine
(şubeler + ek firmalar) yazıyordu: bir firmanın ödemesi hepsini açıyordu.

## Hesap kavramı ölmedi, kapsamı daraldı

`accountRootId` ekseni duruyor ve bugün **üç** işi var:

| iş | nerede | not |
|---|---|---|
| **Kota** — şube/ek firma AÇMA hakkı | kök firmanın abonelik satırı (`branchQuota`, `companyQuota`) | tek havuz; `getAccountQuotas` |
| **Yetkilendirme** — kim yönetir/öder | `lib/auth/branch-access.ts`, satın alma ucu | kökün ADMIN'i hesabın tüm firmalarını yönetir |
| **Bildirim** — dönem sonu e-postası | `lib/billing/jobs.ts` → `notifyExpiring` | uyarı hesabın ADMIN'lerine gider |

Kota **açma hakkıdır, modül hakkı değildir** — bu ayrım eskiden de vardı, şimdi tek anlamı o.

## Kurallar

- **Yetkinin kaynağı firmanın KENDİ aboneliğidir**: `getCompanySubscription(companyId)`.
  `getAccountSubscription` yalnız KOTA için okunur; modül sorusuna cevap vermez.
- `applyEntitlements(companyId, granted)` **tek firmaya** yazar. Eskiden hesabın tümüne
  yazıyordu; adı aynı kaldı, kapsamı daraldı.
- `setCompanyModules(companyId, granted, suppression?)` — elle modül verme/alma. Eski adı
  `setAccountModules`tı ve kökün aboneliğini yazıyordu.
- **Yeni şube/ek firma kilitli doğar**: `defaultDisabledModules(free)` — temel modüller
  açık, ücretliler kapalı. Ana firmanın modülleri devralınmaz.
- **Kota yalnız hesap kökünden satın alınır.** Şube ya da ek firma kota alamaz: hesap
  ağacı sonsuza dallanırdı ve havuz zaten kökte duruyor. Kapı üçe yazıldı — uç (400),
  ekran (kart gizli) ve tutar hesabı (kota 0 gönderilir).
- **Satın almayı hesap yöneticisi yapar.** Şubeye atanmış bir ADMIN abonelik ekranını
  görür ama ödeyemez (uçta 403, ekranda kapalı düğme + açıklama). Karar: ödemenin ve
  faturanın sorumluluğu hesabın sahibindedir.
- **Fatura satın alan firmaya kesilir.** Şubede bu ana firmayla aynı tüzel kişidir (VKN
  devralınır); ek firmada kendi VKN'sine kesilmesi zaten doğrusuydu.
- **İndirim kodu hesap bazında kalır**: "firma başına 1 kez" hakkını hesabın tüm firmaları
  paylaşır. Firma bazına indirilseydi tek kullanımlık kod şube sayısı kadar çoğalırdı.
- **Arşiv ve kilit firma bazındadır**: süresi dolan şube tek başına salt-okunura geçer,
  ana firma çalışmaya devam eder.

## Değişen dosyalar

| Dosya | Ne değişti |
|---|---|
| `lib/billing/entitlements.ts` | `getCompanySubscription` eklendi; `applyEntitlements` tek firmaya yazıyor; `setAccountModules` → `setCompanyModules`. |
| `lib/billing/jobs.ts` | reconcile ve arşiv firma bazında; uyarı e-postasında hesap kökü önce çözülüyor (şube id'siyle `getAccountCompanyIds` boş dönerdi). |
| `lib/billing/free-modules-sync.ts` | Ücretsizlik hizalaması firmanın KENDİ aboneliğine bakıyor (`grantedByCompany`). |
| `lib/billing/admin.ts` | Elle süre verme kapsamı firma; "sıfırla" hesabın her firmasına ayrı satır yazıyor; şubede üye yoksa sahip kökten çözülüyor. |
| `lib/company/create-company.ts` | Şube ve ek firma modül DEVRALMIYOR, kilitli doğuyor. |
| `app/api/billing/orders/route.ts` | Sipariş satın alan firmaya yazılıyor; kota yalnız kökten; satın alma hesap yöneticisine kapalı değilse 403; fatura alıcısı satın alan firma. |
| `app/api/billing/catalog/route.ts` | `isAccountRoot`, `canPurchase`, `accountName` dönüyor. |
| `app/api/billing/subscription/route.ts` | Abonelik/sipariş/olaylar firma bazında; `canManage` hesap yöneticisine bağlandı. |
| `app/api/billing/{notice,subscription/auto-renew,subscription/cancel}/route.ts` | Firma aboneliğini okuyor. |
| `app/api/billing/admin/overview/route.ts` + `components/system-admin/subscription-admin.tsx` | Hesap satırında ÜYELERİN kendi abonelik durumu listeleniyor ("şube ödedi mi"). |
| `app/(dashboard)/ayarlar/abonelik/page.tsx` | "yalnız bu firma" metni, kota kartları yalnız kökte, kota 0 gönderimi, ödeme yetkisi uyarısı. |
| `components/dashboard/new-company-form.tsx`, `components/system-admin/company-modules-card.tsx` | Devir vaadi eden metinler düzeltildi. |

## Geçiş (canlı)

Karar: **mevcut şube ve ek firmalar dönem sonuna kadar korunur.** Yoksa çalışan müşteri
ertesi gün panelini kapalı bulurdu (canlıda 5 şube + 2 ek firma).

```bash
npx tsx scripts/abonelik-firma-bazina-gecis.ts            # kuru çalışma (rapor)
npx tsx scripts/abonelik-firma-bazina-gecis.ts --uygula   # yazar
```

Betik her üyeye kökün aboneliğinin kopyasını açar; para alınmaz, tarih aynı kalır.
Kopyaya girmeyen alanlar bilinçli: `branchQuota`/`companyQuota` = 0 (kota kökte kalır),
`autoRenew` = false ve kart token'ı yok (saklı kart kökün satırında), `amount` = null.
Tekrar çalıştırılabilir — kendi aboneliği olan firma atlanır.

## Doğrulama

```bash
npx tsc --noEmit
npx vitest run
npx tsx scripts/test-modul-kapatma.ts   # canlı DB, geçici kayıtlarla uçtan uca
```

E2E betiği yeni modelin sözünü doğrudan sınıyor: kök Restoran'ı satın alır → **şubede
açılmaz**; şube kendi aboneliğini alır → açılır; şubenin süresi dolar → **yalnız şube
kapanır**; şubede ücretsiz Stok kapatılır → şubede Restoran da zincirle kapanır ama
**ödenmiş yetki iptal edilmez**; yeni şube kilitli doğar.

## ▶ DEVAM — kaldığımız yer (2026-09-04)

Kod tarafı **bitti ve doğrulandı** (`npx tsc` temiz, 752 vitest, E2E 27/27). Sıradaki üç iş:

1. **GEÇİŞ BETİĞİ CANLIDA ÇALIŞTIRILMADI — en kritik madde.**
   ```bash
   npx tsx scripts/abonelik-firma-bazina-gecis.ts            # rapor
   npx tsx scripts/abonelik-firma-bazina-gecis.ts --uygula   # yazar
   ```
   Çalıştırılmazsa mevcut 5 şube + 2 ek firma ilk reconcile/yenileme turunda ücretli
   modüllerini KAYBEDER (kendi abonelik satırları yok). Kuru çalışma bugün alındı:
   7 üye kopyalanacak, 2'si (Reypo'nun ek firmaları) gerçek ACTIVE yetki taşıyor.

2. **Tarayıcı doğrulaması yarıda kaldı.** Şubenin abonelik ekranı açılırken kesildi.
   Bakılacaklar: (a) "Seçtiğiniz modüller yalnız bu firma için açılır" metni, (b) şubede
   kota kartlarının yerinde "kota yalnız ana firmadan" notunun görünmesi, (c) hesap
   yöneticisi olmayan bir kullanıcıda ödeme düğmesinin kapalı + uyarılı gelmesi,
   (d) sistem-admin abonelik panelinde üye satırlarının ("şube: … ACTIVE/abonelik yok")
   çizilmesi.

3. **Karar bekleyen, bilerek ertelenenler** — aşağıdaki "Bilinen sınırlar" bölümü.

Not: E2E betiğini `| head` ile kırpmayın — süreç erken ölürse `finally` temizliği
çalışmaz ve `zz-e2e-` firmaları DB'de kalır (bir kez yaşandı, elle silindi).

## Bilinen sınırlar (bilinçli)

- **Tek sepette çoklu firma yok.** Her firma kendi ekranından ayrı ödenir; dönemler
  ayrışır. Tek ödemede birden çok firma seçmek sipariş/callback/yenileme akışını çok
  firmalı hale getirir — istenirse ayrı bir iş.
- **Şube fiyatı = tam fiyat.** İndirimli şube fiyatı için `PricingItem`'a ikinci bir
  eksen gerekir; bugün yok.
- **Kota ürünü duruyor.** "Ek şube/ek firma" kalemleri satılmaya devam ediyor (açma
  hakkı). Müşteri açma hakkı + modül olmak üzere iki kalem öder.
- **`Subscription.branchQuota` üye satırlarda 0.** Kota yalnız kökün satırından okunur
  (`getAccountQuotas`); üye satırlardaki alan kullanılmıyor.
