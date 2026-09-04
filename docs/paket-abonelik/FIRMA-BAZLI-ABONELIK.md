# Firma bazlı abonelik — "yetki devretmez"

**Durum:** bitti. Kod, canlı geçiş ve uçtan uca doğrulama tamam; sistem-admin paneli de
görsel olarak doğrulandı. Açık kalan tek madde aşağıda (**▶ KALAN**).
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
| `app/api/invoicing/billing-info/route.ts`, `components/invoicing/billing-info-form.tsx` | `scope="account"` KALDIRILDI — fatura bilgisi artık daima ekranın firmasından okunur (aşağıya bak). |
| `lib/billing/purchase-authority.ts` (+ testi) | Satın alma yetkisi kuralı TEK yerde; `catalog` ve `orders` uçları aynı fonksiyonu çağırıyor. |
| `lib/billing/paid-amount.ts` (+ testi) | Callback'te tahsil edilen tutar siparişin tutarını karşılıyor mu — eksikse abonelik AÇILMAZ. |
| `lib/billing/subscription-screen.ts` (+ testi) | Abonelik ekranının kararları (kota seçimi, ödeme düğmesi, engel cümlesi) saf ve testli. |
| `lib/billing/subscription-wiring.test.ts` | Nöbetçi: ekranın gerçekten bu kuralları çağırdığını kaynak taramasıyla kilitler. |
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

## Geçiş canlıda uygulandı (2026-09-04)

`npx tsx scripts/abonelik-firma-bazina-gecis.ts --uygula` çalıştırıldı: **7 hesap üyesine**
kökün aboneliğinin kopyası açıldı (4 şube + 2 ek firma + 1 şube; Reypo'nun iki ek firması
gerçek ACTIVE yetki taşıyordu). Betik tekrar çalıştırılıp 7'sinin de "kendi aboneliği zaten
var" diye atlandığı görüldü — idempotenslik doğrulandı.

Yazılan satırların ölçülen hâli tasarımla birebir: her üyede **tek** abonelik satırı,
`branchQuota`/`companyQuota` = 0, `autoRenew` = false, `amount` ve kart token'ı boş; dönem
ve durum kökten devralınmış. Yetki tarafında Reypo'nun iki ek firması `restaurant` dâhil
yedi modülle açık kaldı, TRIAL şubeler ise ücretsiz modüllerle çalışmaya devam ediyor.

Geçişten SONRA tekrar alınan doğrulama: `npx tsc --noEmit` temiz, **752 vitest** geçti,
`scripts/test-modul-kapatma.ts` **27/27** (geçici firma kalmadı).

> Kenar not: `Kobipo Demo Merkez` kökünde `restaurant` satın alınmamış olduğu hâlde açık
> görünüyor (`disabledModules` boş). Geçişin ürünü değil — köke dokunulmadı; ilk reconcile
> turunda kapanacaktır. Demo hesabı olduğu için elle düzeltilmedi.

## Geçişte yakalanan hata: fatura bilgisi hesap kökünden okunuyordu

Sipariş ucu faturayı **satın alan firmaya** kesecek şekilde güncellenmişti
(`orders/route.ts` → `buyerCompany`), ama abonelik ekranı fatura kartını hâlâ
`useBillingInfo(companySlug, "account")` ile yüklüyordu; uç da `scope=account` görünce
`resolveAccountRootId` ile kökü çözüyordu. Sonuç: ek firmanın kendi ekranında ANA FİRMANIN
ünvanı ve VKN'si görünüyordu ve "Öde"ye basıldığında `companyFillFromBilling` bu değerleri
ek firmanın boş `taxNumber`/`address`/`email` alanlarına **yazıyordu** — yani yanlış tüzel
kişi kalıcılaşıyordu.

Düzeltme: `scope` seçeneği hem uçtan hem `useBillingInfo`dan kaldırıldı; alıcı daima
ekranın firmasıdır. Ek firmanın kendi bilgisi eksikse form kendiliğinden açılıp eksik
alanları kırmızı işaretliyor (tarayıcıda doğrulandı) — sessizce kökün VKN'siyle devam
etmek yerine kullanıcıya soruyor.

## Satın alma yetkisi tek kaynağa indi

Kural iki kere yazılmıştı ve ikisi aynı değildi:

| | `orders` (uç) | `catalog` (ekran) |
|---|---|---|
| firmada ADMIN olma şartı | var | **YOKTU** |
| kök değilse hesap ADMIN'i olma şartı | var | var |

Yani ekran "satın alabilirsin" derken uç 403 döndürebilirdi. **Bugün kullanıcıya
yansımıyordu**: `/ayarlar/abonelik` `ACCOUNT_ADMIN_PAGES` içinde, yalnız enum ADMIN'e açık
ve özel rollere devredilemiyor — ADMIN olmayan biri ekrana zaten giremiyor. Yine de kural
`lib/billing/purchase-authority.ts`e taşındı ve iki uç da oradan okuyor; kotada
`getAccountQuotas` neden tek kaynaksa (bkz. CLAUDE.md) bu da öyle. `catalog` artık
`purchaseBlockedReason` de döndürüyor, ekran uyarı cümlesini ona göre seçiyor.
Kapsam: `lib/billing/purchase-authority.test.ts` (7 test).

## Ödenen tutar artık doğrulanıyor

Callback'te gelen `total_amount` yalnız HASH'e giriyordu. İmza tutarı sahteciliğe kapatır
("PayTR bunu gönderdi") ama o tutarın SİPARİŞİN bedeli olduğunu söylemez. `checkPaidAmount`
bu son adımı ekliyor: kuruş üzerinden karşılaştırılır, eksikse sipariş `FAILED` yazılır ve
**abonelik açılmaz** (yetkiyi açan tek olay bu bildirimdir). Ölçüt eşitlik değil "en az" —
PayTR taksit komisyonunu `total_amount`a ekleyebiliyor; eşitlik arayan bir kontrol bir gün
taksit açılırsa ödeyen müşteriyi kilitlerdi. Fazla tahsilat geçer ama log'a düşer.
Okunamayan tutar da reddedilir (fail-closed).

Kontör akışında aynı boşluk DURUYOR (`lib/kontor/paytr-payment.ts`) — istenirse aynı
fonksiyon oraya da bağlanır.

## Kullanıcı tarafı testleri

Proje bileşen testi tutmuyor (bkz. `vitest.config.ts` — kapsam bilinçli olarak `lib/**`
saf fonksiyonları). Ekranın kararları bu yüzden `lib/billing/subscription-screen.ts`e
taşındı ve orada kilitlendi; bileşen yalnızca sonucu çiziyor. Üç katman:

1. **Kararlar** — `subscription-screen.test.ts` (23 test): şube/ek firma ekranında kotanın
   sıfırlanması, ödeme düğmesinin açık/kapalı olması ve SEBEBİ, engel cümlesinin seçimi.
2. **Ekran ≡ uç sözleşmesi** — aynı dosyada: `resolvePurchaseAuthority`nin ürettiği her
   sonuç için düğmenin uçla aynı cevabı vermesi (5 rol kombinasyonu).
3. **Nöbetçi** — `subscription-wiring.test.ts` (11 test): ekranın bu fonksiyonları
   gerçekten çağırdığını ve kaldırılan `scope="account"` yolunun geri gelmediğini kaynak
   taramasıyla doğrular (`page-api-coverage.test.ts` ile aynı desen). Yakaladığı, iki
   geçici ihlal sokularak sınandı. Negatif iddialar YORUMLARI eleyerek bakar — açıklamayı
   silmeye zorlamasın diye.

Hâlâ YOK: bileşen (DOM) testi, route/entegrasyon testi, tarayıcı otomasyonu.

## ▶ KALAN — tek madde

**Şubeye atanmış ADMIN'de ödeme düğmesinin kapalı görünmesi canlı ekranda görülmedi.**
Kural ve arayüz bağlantısı test altında; eksik olan yalnız göz teyidi. Canlıda bu senaryoyu
taşıyan bir hesap YOK: şubede ADMIN olan iki kullanıcının ikisi de aynı zamanda kökün
ADMIN'i (`destek@hidroeren.com`, `erenvinc20@gmail.com`), dolayısıyla ikisinde de düğme
haklı olarak açık. Görmek için şubeye ADMIN atanmış, ana firmada üyeliği olmayan bir
kullanıcı gerekiyor.

DOĞRULANANLAR (tarayıcı):
- Hesap kökünde (Reypo) "yalnız bu firma için açılır" metni ve kota kartları.
- Ek firmada (asdasdsa) kota kartlarının yerinde "kota yalnızca ana firmadan (Reypo Medya
  Ajansı)" notu, sipariş özetinde kota kalemi yok, firmanın KENDİ aboneliği "Aktif ·
  Restoran & Kafe açık".
- Ek firmanın fatura kartında artık KENDİ ünvanı/VKN'si; eksik alanlar kırmızı.
- `/system-admin/abonelikler`: geçişten sonra 7 üyenin hepsi kendi durumuyla çiziliyor —
  `ek firma: asdasdsa ACTIVE bitiş 29.04.2027 tüm modüller açık`, `şube: Kobipo Demo
  Kadıköy Şubesi TRIAL bitiş 30.07.2027 kilitli: restaurant`. Hiçbirinde "abonelik yok"
  yok.

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
