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

### Şubenin adresi belgeye AgentParty ile girer

Mysoft satıcı ünvan/adresini VKN başına tuttuğu **mükellef kaydından** yazar; fatura
gövdesinde satıcı adresi alanı YOKTUR. Şube ana firmanın VKN'siyle çalıştığı için,
farklı adresteki şubenin faturası ana firmanın adresiyle gidiyordu. Tek kanal
`supplierAgentAccount` → UBL `cac:AgentParty`; GİB dizaynları bunu "ŞUBE BİLGİLERİ"
bloğu olarak basar. Karar tek yerde: `lib/integrations/e-invoice/branch-party.ts`
(iki gönderim yolu da oradan geçer).

- Üstteki satıcı adresi ŞUBEYLE DEĞİŞTİRİLMEZ: orası vergi dairesine kayıtlı merkez
  adresidir. Değiştirmenin tek yolu Mysoft mükellef kaydı (`UpdateTenantAddressInfo`)
  ya da belgeyi baştan biz üretmek (`invoiceOutboxWithUblXml`) olurdu.
- `Company.branchNo` **belgeye girer** (`schemeID="SUBENO"`), `branchName` girmez.
  Mysoft bloğu şube numarası olmadan üretmiyor ("SupplierParty.agentNumber null
  olamaz" — ölçüldü); boşsa "1" gönderilir, çok şubeli firma numaraları doldurmalı.
- Adres ya da şehir eksikse blok HİÇ gönderilmez: UBL-TR'de İl/İlçe zorunludur, yarım
  adres belgenin TAMAMINI reddettirir. Eksiklik loglanır (`branchPartyWarning`).
- `Company.district` (İlçe) adresin ayrı tutulan tek parçasıdır — UBL'de
  `cbc:CitySubdivisionName`. Boşsa İL ile doldurulur (belgede "DENİZLİ / DENİZLİ");
  aynı geri düşme Mysoft mükellef kaydı açılışında da vardır (onboarding
  `createTenant`). Serbest adres metninden ilçe AYIKLANMAZ, tahmin edilmez.
- "Payload'a koyduk" ≠ "belgede var" — Mysoft bazı alanları sessizce yutuyor (sevk
  adresi). Ölçüm yolu: `npx tsx scripts/sube-adresi-kontrol.ts --canli --test`
  (provider'da `draftXmlOnly`; taslak UBL'i döner, GİB'e belge gitmez).

## e-Arşiv yalnız Mysoft'ta ONAYLI şablonla basılır

Canlı Mysoft'ta ölçüldü (2026-09-14, Reypo mükellefi, taslak PDF ucu): e-Arşiv'de
`xsltName` onay bekleyen ya da olmayan bir ada denk gelirse — ve `xsltName` hiç
gönderilmezse — Mysoft *"E-Arşiv Fatura belge tipine ait uygun belge görseli
bulunamamıştır"* der ve belgeyi üretmez. `isSendWithGeneralXsltIfDefaultNotExists`
bayrağı bunu KURTARMAZ (test ortamı düşürüyor; oradan bakıp "çalışıyor" denmesin).
e-Fatura'da GİB standart dizaynı devreye girdiği için aynı durum sessizce geçer.

Her `addTenantXslt` yüklemesi (tasarımcı kaydı, dosya yükleme, "Yenile", gönderim
öncesi otomatik tazeleme) Mysoft'ta onaya girer; onay elle ve saatler/günler sonra
gelir, reddedilebilir de. Eren Forklift: 3 Eylül'de otomatik tazelenen şablon onaydan
düştü, 9–14 Eylül arası tek bir e-Arşiv kesilemedi; e-Fatura çalıştığı için fark
edilmedi. Karar iki yerde:

- **Gönderim** (`mysoft-provider.ts` → `approvedXsltFallback`, saf kural
  `template-approval.ts`): ret gelince mükellefin onaylı e-Arşiv şablonuna
  (önce Mysoft varsayılanı, sonra en son onaylanan) BİR KEZ daha denenir; hem
  `invoiceOutbox` hem taslak PDF yolu aynı deterministik yedeği seçer ki taslak ve
  önizleme farklı görünmesin. Yedek kullanıldıysa sonuç `templateFallback` taşır,
  uçlar `warning` olarak istemciye verir — sessiz geçilmez. Yedek yoksa mesaj
  durumu söyler (onay bekliyor / bulunamadı), Mysoft portalına yollamaz.
- **Tazeleme** (`template-refresh.ts`): onaylı kopya SESSİZCE yeniden yüklenmez
  (`uploadWouldRiskApproval`; durum okunamıyorsa da yüklenmez). Taban iyileştirmesi
  onaylı tasarıma yalnız "Yenile" (force) ile gider; düğme sonucu onaylatıp
  onay durumunu (`approvedAfterUpload`) ekrana yazar. Yükleme uçları da `approved`
  döner, toast'lar "onay bekliyor"u söyler.

**Kullanıcı Mysoft portalına YÖNLENDİRİLMEZ.** Kobipo, Mysoft'u kullanıcıdan saklar;
"portalda şuraya girin" diyen bir metin bu ilkeyi deler (2026-09-14'te bir an
yazıldı, geri alındı). Onay beklerken söylenen tek metin `MYSOFT_APPROVAL_STEP`:
onay Mysoft'tan gelir, gelmezse Kobipo desteğe yazılır. Arka plan: Mysoft API'sinde
XSLT için ekle / sorgula / HTML-PDF önizleme dışında uç yok (`swagger-v8.json`),
"onaya gönder" ucu YOK. Onay normalde yüklemeden saatler sonra kendiliğinden geliyordu
(Reypo'da Haziran'dan beri hep öyle); Eren'de gelmedi ve şablon portalda *Şablon
Bilgileri* ekranında "Onaya Gönder" bekler durumda bulundu. O ekranın otomatik
kontrollerinden ikisi Kobipo tasarımlarında kırmızı ("Kaşe-İmza yok", "QR Kod yok"):
Mysoft kaşeyi/QR'ı `isHasStamp`/`isHasLogo` ile KENDİ yerleştirir, biz CSS/JS ile
çiziyoruz ve bayrağı göndermiyoruz; denetleyici bizimkini görmüyor. Onayın neden
kendiliğinden gelmediği (kontroller mi engelliyor?) Mysoft'a sorulacak; kırmızı
kontroller sebepse taban şablon Mysoft yerleştirmesine uyarlanmalı — kapıyı gerçekten
kapatan iş budur. O güne kadar portal adımı bayi (Reypo) tarafında yapılır.

Ölçüm: `npx tsx scripts/earsiv-sablon-kontrol.ts --bayi-vkn=<vkn> --xslt=<ad>`
(bayi kimliği yalnız Kobipo bayiliğindeki mükellefleri görür; `--firma=<id>` için
canlının `NEXTAUTH_SECRET`i gerekir — `vercel env pull --environment=production`).

## Kontör YALNIZ Kobipo bayiliği altındaki mükellefe yüklenir

Kontör yüklemesi (`insertDocumentCredit`) bayi (İş Ortağı) kimliğiyle yapılır ve Mysoft
yalnız bayinin altına tanımlı mükellefe yükler; başkasına *"firması sizin hesabınızda
tanımlı olan firmalar arasında yer almamaktadır"* der. Kobipo'dan ÖNCE kendi Mysoft
hesabını açmış müşteri bu listede DEĞİLDİR (Eren Forklift 3531285187, 2026-09-21: 375 TL
kart ödemesi alındı, yükleme reddedildi). Bayi API'sinde mevcut mükellefi bayiye bağlayan
uç YOK — `addTenant` yalnız yeni mükellef açar, aynı VKN'yle denenmez (ikinci tenant
riski); bağlama Mysoft'un idari işidir. Yani ret sonradan düzeltilemez, sipariş
AÇILMADAN önce sorulur. Karar tek yerde: `lib/kontor/dealer-eligibility.ts` →
`checkKontorEligibility(vkn)`.

- `POST /api/kontor/orders` bu kapıdan geçmeden sipariş yazmaz: kart, havale ve tam
  indirimli yol aynı kapı. Listede yoksa 412 + `code: "NOT_LISTED"`, liste alınamazsa
  503 + `UNAVAILABLE` — **sessiz geçilmez**; "ödeme alınmadı" mesajda yazar.
- İstemcide 412 iki anlama gelir: `fields` gelirse fatura bilgisi eksik (form açılır),
  `code` gelirse bayi kapısı (yalnız mesaj). Karıştırılırsa kullanıcı fatura formunu
  doldurup yine ret yer.
- Satın alma penceresi açılırken `GET /api/kontor/eligibility` ile aynı soru sorulur;
  "hayır" ise paketler hiç gösterilmez. Bu ön bilgidir, kapı değil.
- Bayi listesi (`listTenants`) SAYFALIDIR (`afterValue`); yarım liste yanlış ret doğurur,
  sağlayıcı sonuna kadar okur. Sonuç 2 dk önbelleklenir (pencere + sipariş = tek giriş).
- Bugüne kadar yüklenen tek iki VKN (Reypo 7352344835, EREN VİNÇ 3530589517) bayi
  altındaydı; sorun ilk "dışarıdan gelen" müşteride çıktı. Belge gönderimi bu kapıdan
  GEÇMEZ — firma kendi Mysoft kimliğiyle fatura kesmeye devam eder.
- Ölçüm: `npx tsx scripts/kontor-siparis-kontrol.ts --vkn=<vkn>` (salt okur: firma
  kayıtları, siparişler, tüm-zamanlar LOADED, bayi listesi, kapının cevabı).

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

## Çalışma düzeni: bir çalışan ASLA iki takvimde birden

İki ayrı eksen var ve karıştırılmamalı:

```
Company.workScheduleMode → hangi TAKVİMLER var (menüde ne duruyor)
  null    → henüz sorulmadı (modülün ilk açılışında kurulum penceresi; menü SHIFT gibi)
  "SHIFT" → /personel/vardiya (saatli ızgara)
  "FLAT"  → /personel/devam   (haftalık çalıştı/izinli)
  "MIXED" → İKİSİ BİRDEN

Employee.usesShifts      → bu ÇALIŞAN hangi takvimde (null = firmanın düzeni)
```

"Henüz sorulmadı" ile "sabit mesai" farklı şeylerdir; varsayılanı FLAT olan bir alanla
soru hiç sorulamaz. Kip firma bazındadır (hesap değil) — aynı hesabın kafesi vardiyalı,
ofisi tek düze çalışabilir.

**DEĞİŞMEZ: bir çalışan her zaman TEK takvime aittir.** Karar tek yerde:
`lib/personel/kip.ts` → `employeeUsesShifts` (personel seçimi firmanın düzenini ezer).
Vardiya takvimi, devam takvimi, aylık puantaj, devam özeti ve iki dışa aktarım — hepsi
bu fonksiyondan geçer. Aynı kişi iki takvimde birden görünseydi bordroya hem saat hem
gün girer, kesinti iki kez sayılırdı. Karma firmada seçim yapılmamış personel
VARDİYALI sayılır: devam tarafında işaretlenmemiş gün "çalıştı"dır ve yanlış tarafa
düşen kişi sessizce 22 gün çalışmış gibi bordroya girerdi — güvenli varsayılan, veri
UYDURMAYAN taraftır.

- Menü kararı TEK yerde: `lib/nav/pages.ts` → `hiddenByShiftMode` (kenar çubuğu ve menü
  araması ikisi de oradan geçer); MIXED'de hiçbir takvim elenmez. Ayarın kullanıcıya
  görünen yeri `Ayarlar → Firma Bilgileri → Çalışma Düzeni`; soru penceresi
  `app/(dashboard)/personel/layout.tsx` içinde bir kez sorulur. Personel bazlı istisna
  İKİ yerden yazılır: personel kartı (`calisma-duzeni-secici.tsx`) ve her iki takvimde
  personel adına tıklayınca açılan pencere (`personel-kip-dialog.tsx`) — soru takvime
  bakarken doğuyor, cevabı da orada verilebilmeli.
- **Kişi menüde olmayan takvime atanamaz:** vardiyalı firmada birini sabit mesaiye
  alırken firma otomatik olarak MIXED'e geçer (pencere bunu kaydetmeden önce yazar).
  Geçilmeseydi o takvim menüde olmadığı için kişinin günleri hiçbir ekranda
  işaretlenemez, ayı da bordroya girmezdi.
- Karma işletmede `/personel/puantaj` İKİ bölüm çizer: üstte vardiya puantajı (saat),
  altta devam özeti (gün). Ölçüler BİRLEŞTİRİLMEZ — 8 sa 30 dk ile 0,5 gün aynı sütunda
  toplanamaz; ayrı sayfaya koymak ise "bordroya veri buradan gelir" sözünü ikiye bölerdi.
- Kip yalnız MENÜYÜ değiştirir, veri silmez: yazılmış vardiyalar ve devam kayıtları
  yerinde kalır. Adres çubuğundan yanlış takvime gelen kullanıcıya `KipUyarisi` şeridi
  çıkar — ekran KİLİTLENMEZ.
- Açılış saatleri ve işletme tatilleri vardiyaya ÖZGÜ DEĞİLDİR: devam takvimi de ikisini
  okur (kapalı gün → hafta tatili, tatil → tatil) ve düzenler. Kapıyı yalnız vardiyaya
  bağlarsanız tek düze çalışan firma hafta tatilini hiç tanımlayamaz.

**Devam kaydı = İSTİSNA.** `AttendanceDay` yalnız SAPMA için yazılır; kayıt yoksa gün
sırayla türetilir (`lib/personel/devam.ts` → `effectiveDayStatus`): istihdam sınırı →
elle kayıt → onaylı izin → işletme tatili → kapalı gün → **çalıştı**. Sıra böyledir:
izin tatilin önüne geçmezse izin bakiyesinden düşen gün takvimde kaybolur. "Çalıştı"ya
dönmek yazma değil SİLMEDİR (uç `status: null` alır) — aksi halde sonradan girilen bir
iznin üstünü örten binlerce satır birikir.

Bordroya gün kesintisi tek fonksiyondan gelir: `deductionDaysFor` (devamsızlık + yarım
gün her zaman, ücretsiz izin varsayılan, raporlu yalnız istenirse). Ekran, dışa aktarım
ve aktarım penceresi aynı varsayımı kullanmalı, yoksa üç yerde üç rakam çıkar.

## Brüt ↔ net: parametreler YILLIKTIR, elle güncellenir

Çevrim `lib/personel/bordro-hesap.ts`tedir ve tek kaynaktır (personel kartı, bordro
penceresi, kesinti hesaplayıcı). Netten brüt için kapalı formül YOKTUR — dilimli vergi
ve asgari ücret istisnası fonksiyonu kırıklı yapar, o yüzden ikili aramayla çözülür.

`BORDRO_PARAMS` tablosuna **her yıl** yeni satır eklenmelidir (asgari ücret, gelir
vergisi tarifesi, SGK tavanı). Eksikse hesap bilinen en son yılın tarifesiyle yapılır ve
sonuç `paramYear` ile hangi yılı kullandığını söyler; ekranlar bunu kullanıcıya YAZAR.
Sessizce eski tarifeyle hesaplamak, kullanıcının göremediği bir hatadır.

Personel kartındaki net bir SÖZLEŞME rakamıdır, ayın kesin neti değil: gelir vergisi
kümülatif matrahtan hesaplandığı için aynı brüt yıl sonuna doğru daha az net verir.
`Employee.salaryBasis` hangi ucun sabit olduğunu söyler (net anlaşmada brüt her ay
yeniden çözülür).

## Cari görünürlüğü: "yetkili çalışan" atanmamışsa çalışan göremez

`Customer.authorizedUserId` / `Supplier.authorizedUserId` bir GÖRÜNÜRLÜK anahtarıdır
(2026-09-08'den beri; öncesinde alan yalnızca kaydediliyor, hiçbir yerde okunmuyordu).

```
ADMIN + BRANCH_MANAGER + ACCOUNTANT (+ süper-admin)  → firmanın TÜM carileri
diğer her üye (SALES, STOCK, VIEWER, CUSTOM)         → yalnız authorizedUserId = kendisi
authorizedUserId boş olan cari                       → yalnız bu üç rol
```

Yani hiç ataması olmayan bir satışçı hiçbir cari göremez — kısıtın amacı budur.
**Muhasebeci 2026-09-10'da tam erişime alındı:** kısıt onu da kapsayınca rol çalışamaz
hâle geliyordu (cari ekranları boş, üstelik liste ucu belge ekranlarının müşteri
seçicisi olduğu için hiçbir cariye fatura kesilemiyordu) ve güvenlik de kazandırmıyordu
— cari adları raporlarda/belge listelerinde zaten görünüyor. Karar TEK yerde:
`lib/cari/visibility.ts` (saf kural; istemci de okuyor) + `lib/cari/resolve-visibility.ts`
(oturumdan çözer). Kapsam **cari modülüdür**: liste, kart, silinebilirlik, ekstre, açık
faturalar ve bunların dışa aktarımı.

- Cari OKUYAN yeni bir uç yazarken kapı elle kurulur:
  `assertCariVisible(cari, await resolveCariVisibility(companyId))` — `ensureCompanyAccess`
  bunu yapmaz, o firmaya erişimi doğrular.
- `fetchCustomerList` / `fetchSupplierList` / `fetchEkstre` için `visibility` alanı
  **zorunludur**. Opsiyonel yapmayın: unutulan bir çağrı sessizce tüm carileri döker.
  Sistem tarafı (otomasyon/cron — oturum yok) `CARI_VISIBILITY_ALL` ile açıkça
  kapsam dışı olduğunu söyler.
- Liste önbelleği görünürlüğe göre anahtarlanır (`visibilityKey`). Anahtardan
  düşerse ilk yönetici isteğinden sonra kısıt 15 sn boyunca herkes için kalkar.
- Atamayı yalnız tam erişimli roller yazar: `resolveAuthorizedUserIdOnWrite` kısıtlı kullanıcıda
  her zaman kendi id'sini döndürür (yeni kayıt kendisine atanır, mevcut kayıtta alan
  değişmez) — aksi halde kullanıcı gördüğü cariyi geri alamayacak şekilde devrederdi.
- İkiz kart (`isAlsoSupplier` / `isAlsoCustomer`) atamayı da kopyalar; ikisi ayrışırsa
  aynı cari bir sekmede görünür, ötekinde görünmez olur.
- **BİLEREK kapsam dışı:** fatura/irsaliye/sipariş/teklif listeleri, cari bazlı raporlar
  (`rapor-cari-yaslandirma`) ve fiş uçları. Buralarda cari adı hâlâ herkese görünür.
  Not: cari LİSTE ucu aynı zamanda o ekranların müşteri/tedarikçi SEÇİCİSİDİR, yani
  kısıtlı çalışan yalnız kendi carilerine belge kesebilir — bu, ucun paylaşılmasının
  kaçınılmaz sonucudur, ayrı bir karar değildir.

## Cari bakiyesi ALTI yerde kurulur — yeni kaynak hepsine girer

Tek bir "cari bakiye" fonksiyonu YOK. Aynı rakamı şu yerler ayrı ayrı kurar: liste
(`lib/cari/list-query.ts`, ham SQL), kart uçları (`app/api/cari/{customers,suppliers}/[id]`),
ekstre (`lib/cari/ekstre-query.ts`), yaşlandırma (`lib/raporlar/cari-yaslandirma.ts`)
ve arşiv/silme kapısı (`lib/cari/archive-guard.ts`). "Liste bir rakam, ekstre başka
rakam" hatalarının hepsi yeni bir kaynağın bunlardan BİRİNE eklenmesinin unutulmasından
çıktı (açılış bakiyesi, çek yönü, iade/mahsup).

Kaynaklar: fatura, kasaya bağlanmamış fatura ödemesi (bakiye kapama dahil), cariye bağlı
Transaction, çek/senet, açılış bakiyesi ve **cari virman fişi** (`lib/cari/virman.ts`,
2026-09-23). İşaret: müşteri bakiyesi borç − alacak, tedarikçi bakiyesi alacak − borç
(aynalı); ekstre her ikisinde borç − alacak yürütür.

- Virman kasaya dokunmaz; kâr/zarar, nakit akışı ve gelir-gidere BİLEREK girmez.
  Karşı cari isteğe bağlıdır (tek taraflı fiş = karşılıksız dekont). Düzenleme yok;
  fiş iki bacağıyla birlikte silinir. Bacağı olan cari silinemez (FK NO ACTION,
  `hasHistory`); ikiz kart kaldırılırken de sayılır (`lib/cari/dual-role.ts`).
- Yeni kaynak eklerken altı yerin hepsine girin ve ölçün:
  `npm run test:canli -- lib/cari/bakiye-tutarlilik` (salt okur, ~4 dk; liste =
  ekstre, liste ≈ arşiv kapısı, yaşlandırma (taslak dahil) = max(bakiye, 0)).
  Kart uçları route içinde hesapladığı için bu testte YOK.
- Arşiv kapısının kendi "açık fatura" hesabı YOK: yaşlandırmayı sorar. Bakiyesi
  faturayı `invoiceBalanceEffect` (lib/cari/invoice-direction.ts) ile kurar — iptal
  ve dönüşmüş hariç, iade ve mahsup dahil (2026-09-23'e kadar iptal faturayı
  sayıyor, mahsubu görmüyordu; 4 cari arşivlenemiyordu).
- Yaşlandırmada açılış ve virman AYNI kuralla girer: carinin bakiyesini artıran
  kayıt vadeli kalemdir, azaltan kayıt açık kalemleri eskiden yeniye kapatan
  kredidir. Açılışın yönü kartın işaretinden okunur (tedarikçide CREDIT artırır).
- **Bilanço alacak/borcu faturadan DEĞİL cari bakiyesinden kurar**
  (`lib/cari/bakiye-asof.ts`, tarih itibarıyla; formül listeyle aynı, canlı test
  eşitliği ölçer). Ayrım CARİ BAŞINADIR: pozitif müşteri = alacak, negatif =
  alınan avans (tedarikçide aynası). Cariden düşen çek/senet "Alınan/Verilen çek ve
  senetler" satırına AYNI tarihle (`issueDate`) girer, tahsil kasa hareketinin
  günü kasaya geçer (`lib/raporlar/bilanco-kiymet.ts`). İade/protesto/ciro tarihi
  tutulmadığı için geçmiş tarihli bilançoda bugünkü durumla sayılır — ekran yazar.

## Fatura dip toplamı YALNIZ `lib/invoice/document-totals.ts`ten gelir

GİB'e giden belge her satırı kuruşa yuvarlar ve genel iskontoyu satırlara dağıtır;
Kobipo ise toplamı yuvarlanmamış satır toplamından kurup en sonda yuvarlıyordu.
2026-09-16 ölçümü: rastgele faturaların %38'inde 1–3 kuruş fark (Reypo taslak UBL:
Kobipo 31.906,38 ↔ belge 31.906,39). Gönderimden sonra tutar Mysoft'tan geri
okunmadığı için fark cari bakiyede kalıyordu. Karar tek yerde:

```ts
import { computeInvoiceTotals, invoiceTotalsFromStoredItems } from "@/lib/invoice/document-totals"
const t = computeInvoiceTotals(lines, { globalDiscountAmount, globalChargeAmount, payableRoundingAmount }, { receipt: isReceipt })
// t.net → Invoice.netAmount · t.vat → vatAmount · t.total → totalAmount
```

- Mysoft sağlayıcısı payload'ı AYNI fonksiyondan kurar (`computeDocumentTotals`);
  fatura POST/PUT, editör, taslak PDF önizlemesi, teklif ve teklif/sipariş/fiş →
  fatura dönüşümleri de. Başlığı kopyalamak ya da `line-tax.ts` toplamlarını doğrudan
  yazmak YASAK: ekranda görünen ile belgeye giden yeniden ayrışır.
- **FİŞ (`Invoice.isReceipt`) istisnadır** — `{ receipt: true }` eski yuvarlamasız
  kuralda kalır. KDV dahil fiyatlı kafe fişinde satır yuvarlaması ekrandaki tutardan
  sapıyordu (20.000 örnekte 2.318 fiş). Fişler faturaya birleşirken fark
  `payableRoundingAmount`a yazılır: belgenin ödeneceği = tahsil edilen, KDV'ye dokunulmaz.
- Resmî belgede miktar 2, birim fiyat 6, tutar 2 ondalığa **JS'te** yuvarlanıp AYNEN
  yazılır (`documentColumnPrecision`) — Postgres .xx5'i JS'ten farklı yuvarlar; kayıt
  ile hesap ayrışmasın.
- Kayıtlı kalemden hesaplarken satır iskontosu **`discountAmount` kolonudur**, orandan
  yeniden türetilmez: sağlayıcı belgeye o kolonu yazar.
- PUT'ta kalem gelmezse toplam KAYITLI kalemlerden yeniden kurulur; saklı başlığı
  ölçeklemek genel iskontoyu ikinci kez düşürüyordu.
- Ölçüm: `npx vitest run lib/invoice/document-totals.test.ts` (kural),
  `node scripts/test-fatura-kurus.mjs` (uçlar, dev sunucu açıkken),
  `npx tsx scripts/kurus-farki-kontrol.ts --canli --test` (Mysoft taslak UBL'de
  `PayableAmount` = Kobipo `totalAmount`; GİB'e belge gitmez).
- Bilerek dokunulmayanlar: `app/api/import` (kaynak XML'in resmî toplamına zaten
  tamamlıyor), hızlı satış/alış ve AI fiş okuma (fiş), `lib/invoicing/issue-sales-invoice.ts`
  (Kobipo'nun kendi abonelik faturası).

## Arama Türkçe duyarsızdır: `ILIKE` / `insensitive` / `toLowerCase` KULLANMA

`lower('I')` Türkçe'de `'ı'` değil `'i'`dir; `"İ".toLowerCase()` ise iki kod birimi
("i" + U+0307) üretir. Bu yüzden `ILIKE`, Prisma `mode: "insensitive"` ve düz
`toLowerCase()` ile yazılan arama, BÜYÜK harfle girilmiş kaydı küçük harfle
aratınca bulmaz — "IŞIK GIDA" carisi `ışık` aramasında görünmüyordu.

Kural tek yerde: `lib/text/tr-fold.ts` → `trFold()` (saf, istemcide de çalışır).
Büyük/küçük harf VE aksan farkı yok sayılır: `ı/i/İ/I → i`, `ş → s`, `ğ → g`,
`ü → u`, `ö → o`, `ç → c`, `â/î/û → a/i/u`. YALNIZ arama/eşleştirme içindir;
görüntülenen metne dokunmaz.

```ts
// Bellek içi liste süzme
import { trFold, trMatcher } from "@/lib/text/tr-fold"
const eslesir = trMatcher(arama)            // terim BİR kez katlanır
rows.filter((r) => eslesir(r.name, r.code))

// Ham SQL
import { trFoldAnyLike, trLikePattern } from "@/lib/db/tr-search"
const desen = trLikePattern(arama)          // boş terimde null
Prisma.sql`AND ${trFoldAnyLike(["c.name", "c.\"taxNumber\""], desen)}`

// Prisma where (SQL fonksiyonu sokulamaz) → id ÖN SÜZGECİ
const ids = await trContainsIds({ table: "products", columns: ["name", "code"], companyId, term })
if (ids) where.id = { in: ids }             // null = "arama yok"; [] = "eşleşme yok"
```

- SQL tarafında DB'ye fonksiyon EKLENMEZ: `translate()` ifadesi sorguya gömülür
  (`lib/db/tr-search.ts`), harf tablosu `TR_FOLD_FROM`/`TR_FOLD_TO` ile TS'ten gelir.
  Migrasyon gerekmemesi bilinçli — `tr_fold()` fonksiyonu olsaydı deploy'dan önce
  uygulanmayan migrasyon cari listesini "function does not exist" ile düşürürdü.
  İki tablonun eşitliği `lib/text/tr-fold.canli.test.ts` ile ölçülür (salt okur).
- Ön süzgeç **daima boyut tablosuna** kurulur (müşteri/tedarikçi/ürün/personel),
  olgu tablosuna (fatura satırları) DEĞİL: "a" araması on binlerce id üretip bind
  parametre sınırına çarpar. Tavan `PREFILTER_LIMIT` (5000).
- `trContainsIds` boş terimde `null`, eşleşme yokken `[]` döner. İkisini
  karıştırmak listeyi ters çevirir: `null`ı `in: []` sanmak her şeyi gizler,
  `[]`i "süzme yok" saymak TÜM kayıtları döker.
- **ASCII alanlar bilerek kapsam dışı:** `invoiceNo`, `eDocumentNo`, `uuid`,
  VKN/TCKN, e-posta, durum kodları — `contains` olarak kalırlar.
- İçe aktarımda aday HAVUZU (`lib/import/apply.ts` → `trEqualsIds`) ile seçim
  (`lib/import/rows.ts` → `comparable`) AYNI kuraldan geçmeli; ayrışırsa satır
  havuza girer ama seçilmez ve aynı ürün ikinci kez açılır.
- Ekran ve dışa aktarım aynı süzgeci kullanır (ürün listesi, stok raporu, gelen
  e-faturalar): biri katlar öteki katlamazsa "listede 42, Excel'de 47" doğar.

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
