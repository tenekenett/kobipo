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

## Kamu kurumuna e-Fatura: IBAN zorunlu, harcama birimi kartta

Kamu kurumuna (GİB kaydında `gibUserType = 2`, posta kutusu çoğu zaman
`defaultpk@muhasebat.gov.tr`) kesilen e-Faturada ödemenin yatırılacağı IBAN belgede
zorunludur. Mysoft bunu PROFİLDEN BAĞIMSIZ arar: TİCARİ taslak *"Kamuya düzenlenen
belgelerde PaymentMeans.PayeeFinancialAccount alanı ilgili değerler ile
doldurulmalıdır"* ile reddedildi (Eren Vinç → Pamukkale Üniversitesi, 2026-10-06 —
Kobipo'nun ilk kamu alıcısı; alan o güne kadar hiç gönderilmiyordu). Karar tek yerde:
`lib/integrations/e-invoice/public-invoice.ts` (saf) + `public-invoice.server.ts`
(GİB sorgusu, hesaplar). İki gönderim yolu da (send-invoice-helper ve create-invoice)
oradan geçer.

- "Kamu mu?" = GİB kaydı YA DA `Customer.isPublicInstitution`. GİB kamu derse bayrak
  kendiliğinden basılır; GİB "özel" derse elle açılmış bayrak silinmez.
- IBAN: kartta seçilen hesap (`publicPaymentAccountId`); seçilmemişse firmanın TEK uygun
  hesabı (aktif, BANKA, TL, mod-97 geçerli TR IBAN). Birden çoksa Kobipo SEÇMEZ, gönderim
  Mysoft'a gitmeden durur. Seçili hesap pasife alınmışsa başka hesaba düşülmez.
- Harcama birimi (`publicPayee*` → Mysoft `publicServicePayee*` → UBL
  `cac:BuyerCustomerParty`) kurumdan öğrenilir; alıcının bilgisiyle DOLDURULMAZ. Girilmişse
  profil KAMU olur; girilmemişse kullanıcının profili (Ticari/Temel) kalır ve yalnız IBAN
  eklenir (KAMU'yu harcama birimsiz göndermek Mysoft swagger'ındaki zorunluluğa takılırdı).
  İadede profil TEMELFATURA kalır, IBAN yine gider.
- Ölçüm yolları (2026-10-06): Mysoft önizleme XML'i alanların belgeye nasıl girdiğini
  gösterir ama DOĞRULAMA YAPMAZ; taslak PDF ucu da Mysoft'un kamu kontrolünü çalıştırmaz
  (IBAN'sız belge ikisinden de geçti). GİB şematronu (`checkSchemaSchematronForInvoiceUBL`)
  KAMU profilinde IBAN'ı ister, harcama birimini istemez. Mysoft'un kamu kontrolü yalnız
  gerçek kayıtta (taslak kaydetme / gönderim) çalışır — "önizlemede geçti" ≠ "kabul edilir".

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

## Makbuz kaşesi: iki kaynak, seçim tek yerde

Tahsilat/ödeme/çek-senet ve virman makbuzlarında firmanın imza alanına (virmanda
"Düzenleyen", tahsilatta "Teslim Alan", ödemede "Teslim Eden") firmanın kaşesi basılır.
Kaynaklar: Ayarlar → Firma Bilgileri (`CompanyStamp`, ayrı tablo `company_stamps`) ve
e-Dönüşüm şablon tasarımcısı (`EInvoiceTemplate.options.stampDataUri`). Sıra: firmanın
ayar kaşesi → aktif/en yeni şablon kaşesi → (yalnız ŞUBEDE) ana firmanın aynı ikilisi;
ek firma devralmaz. Karar `lib/company/stamp.ts` (saf), okuma/yazma `stamp.server.ts`,
görsel hazırlığı `stamp-image.ts` (PNG'ye çevirir; pdfmake WebP/GIF basamaz).

- Kaşe `Company` kolonu DEĞİLDİR: select'siz firma okumaları 100 KB'lık görseli her
  isteğe taşırdı. Tablo okunamazsa makbuz şablon kaşesine düşer, sebep loglanır.
- "Şablondan al" şablonun firmaya (şubede ana firmaya) ait olduğunu denetler; id istemciden gelir.
- TERS YÖN: tasarımcıdaki "Ayarlardaki firma kaşesini kullan" yalnız FORMU doldurur
  (`templateBoxFromSettings`: mm → px kutu). Mevcut şablonlar kendiliğinden güncellenmez —
  her yükleme e-Arşiv onayına girer (yukarıya bak); kaydetmek kullanıcının elindedir.
- Uç `/api/firma-kasesi`: Firma Bilgileri yazar, Belge Şablonları yalnız okur (page-access).
- Ölçüm: `TEST_BASE_URL=… node scripts/test-firma-kasesi.mjs` (Reypo Medya; başta ayar
  kaşesi varsa durur, açtığı her şeyi siler).

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

## Fatura e-postası: giden ANINDA, gelen YOKLAMAYLA

2026-10-06'ya kadar Kobipo hiçbir faturayı mail olarak göndermiyordu (önizlemedeki
"E-posta gönder" ucu hiçbir şey yapmadan "kuyruğa alındı" dönüyordu). Kural tek yerde,
saf: `lib/fatura-eposta/kurallar.ts`; yazma `giden.server.ts` / `gelen.server.ts`.

```
GİDEN → GİB'e giden e-Fatura/e-Arşiv, carinin kartındaki e-postaya PDF + UBL XML ekli.
        Belge GİB'e gidince `after()` ile HEMEN (finalizeGibDraft, createInvoiceFromBody).
GELEN → Gelen her e-fatura, HESABI AÇAN KİŞİYE (hesap kökündeki en eski ADMIN üyeliği,
        süper-admin hariç) AYRI bir mail. Zamanlanmış uç kutuları tarar.
```

- **Giden fatura başına TEK otomatik mail:** `invoice_email_logs.autoKey` (= faturanın
  id'si) benzersizdir, kaydı yazan sahiplenir. HATA 5 denemeye kadar tarama ile yeniden
  denenir. Elle gönderim (`POST /api/faturalar/[id]/email`) firma anahtarına bakmaz,
  alıcıyı değiştirebilir ve her seferinde ayrı kayıt açar. Alış faturası, fiş, Manuel
  belge ve GİB taslağı gönderilmez (`gidenGonderilebilir`).
- **Carinin e-postası VKN sorgusundan GELMEZ:** GİB `urn:mail:defaultpk@…` posta kutusu
  etiketini döndürür, o bir mail kutusu değildir (`gibPostaKutusuMu`). `.test/.example/
  .kobipo` alanları da adres sayılmaz: geri dönen mail alan adının itibarını düşürür.
  Ölçüm (2026-10-06): son 30 günün e-belgelerinin ~%7'sinin carisinde e-posta var.
- Mysoft'a carinin e-postası (`invoiceAccount.email1`) GÖNDERİLMİYOR. Gönderilmeye
  başlanırsa Mysoft'un kendi bildirim ayarı (`isSendDocumentMail`) açık mükellefte müşteri
  aynı faturayı iki kez alabilir.
- **Gelen için anlık tetik YOK:** fatura Kobipo'ya değil Mysoft'taki posta kutusuna düşer
  ve Mysoft API'sinde "fatura geldi" webhook'u yoktur (swagger-v8). Mysoft'un kendi
  bildirim maili (`addTenantNotificationSettings`) bilerek KULLANILMADI: Mysoft şablonuyla
  gider (Mysoft'u saklama ilkesi) ve yalnız bayi altındaki mükellefe ayarlanabilir.
- **Tetik GitHub Actions'tır, 30 dakikada bir** (`.github/workflows/fatura-eposta.yml` →
  `/api/e-donusum/cron/fatura-eposta`, `CRON_SECRET`). Vercel Hobby'de cron günde birden
  sık OLAMAZ (dağıtım düşer); Supabase pg_cron'a bilerek bağlanmadı. 30 dk, private
  repoda Actions'ın ücretsiz kotası (2.000 dk/ay) yüzünden. Workflow logu yalnız
  sayıları basar.
- **Tekilleştirme HESAP × ETTN:** şubeler ana firmanın Mysoft kutusunu paylaşır, aynı
  fatura 2–3 firmada satır olur. Bildirim ana firma satırından gider, diğerleri `KOPYA`.
- **Tazelik 72 saat** (`GELEN_TAZELIK_SAAT`, ölçü `sentDate ?? docDate ?? createdAt`):
  elle "son 1 yıl" senkronu ya da yeni firmanın ilk senkronu eski faturaları mail olarak
  dökmez. Eski satırlar kuyruğa girmeden TOPLU kapanır (`eskileriKapat`); tek tek
  kapansalardı kuyruğun önünü tıkar, arkadaki yeni fatura sıra gelmeden 72 saati aşardı.
- **Başlangıç çizgisi:** migrasyon `20261006000002` var olan her gelen satıra ve SENT
  e-belgeye `BASLANGIC` yazdı. Yeni bir "geçmişi tara" yolu yazan bu işareti bilmelidir.
- Anahtarlar `Company.invoiceEmailAuto` / `incomingEmailNotify` (varsayılan açık), DAR
  uçla yazılır (`/api/e-donusum/eposta-ayarlari`): `PUT /api/companies/[id]` kısmi
  gövdede gönderilmeyen alanları siliyor.
- Ölçüm: `npx tsx scripts/fatura-eposta-kontrol.ts --gelen` (salt okur) ve
  `--giden=<id>` (PDF/XML/HTML, göndermez); gerçek gönderim yalnız `--gonder --to=<adres>`
  ile, cariye test maili atılmaz.

## Abonelik FİRMA bazındadır — yetki devretmez

2026-09-04'te değişti: her firma (kök, şube, ek firma) kendi aboneliğini satın alır.
Ana firmanın ödemesi şubeyi AÇMAZ; şubenin süresi dolunca ana firma kapanmaz. Ayrıntı ve
geçiş: `docs/paket-abonelik/FIRMA-BAZLI-ABONELIK.md`.

- Yetkinin kaynağı **firmanın kendi aboneliğidir**: `getCompanySubscription(companyId)`.
  `getAccountSubscription` yalnız KOTA içindir, modül sorusuna cevap vermez.
- `applyEntitlements(companyId, granted)` **tek firmaya** yazar; elle modül verme
  `setCompanyModules()`. (Eski adları hesap kapsamlıydı: `setAccountModules`.)
- Yeni firma (kök, şube, ek firma) **TÜM modüller kapalı doğar** — ücretsizler dahil,
  modül devri yok (aşağıda "ücretsiz paket").
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
  - **Ücretsiz modül KENDİLİĞİNDEN AÇILMAZ — ücretsiz paket alınır** (2026-09-25).
    Firma abonelik ekranından 0 TL'lik siparişle paketi alır; damga
    `Company.freeModulesClaimedAt`. Damga yoksa `applyEntitlements` ücretsizleri
    açmaz — `granted` içinde gelseler bile (yalnız ücretli bir modülün gereksinimiyse,
    ör. Restoran → Stok). Kural tek yerde, saf: `lib/modules.ts` → `resolveOpenModules`
    (`applyEntitlements`, ücretsiz hizalama ve abonelik ekranının "açık modüller"
    listesi hep oradan). Paketin süresi YOKTUR: abonelik satırına yazılmaz, bitiş/kilit/
    arşiv akışına girmez; modül ücretliye çevrilirse satın alınması gerekir.
    - Karşılama `lib/billing/free-order.ts` → `claimFreePackage`: sipariş ACTIVE,
      `amount 0`, `paymentProvider "FREE"`, `paidAt null` (fatura yeniden deneme işi
      `paidAt` dolu siparişleri taradığı için FATURA KESİLMEZ), fatura bilgisi istenmez.
      Kapı dar: `isFreeClaimSelection` (tutar 0, ücretli modül/kota yok) — 0 TL'ye
      çekilmiş ücretli paket bu yoldan geçemez.
    - Damgayı basan diğer yollar (`claimFreeModules`): modül içeren her tamamlanmış
      satın alma (ekranda ücretsizler seçimden çıkarılamıyor), elle süre verme,
      "deneme" sıfırlaması, sistem-admin kartındaki "Ücretsiz paket" anahtarı.
    - Sistem-admin kartında paket alınmamış firmanın kapalı ücretsiz modülü elle
      kapatma DEĞİLDİR — `suppressedModules`a yazılmaz; yazılsaydı firma paketi
      aldığında temel modüller sessizce kapalı kalırdı.
    - Mevcut firmalar migrasyonla damgalanır
      (`20260925000001_company_free_modules_claimed.sql`, ölçü "en az bir modül açık";
      tekrar çalıştırılabilir — deploy'dan önce VE hemen sonra bir kez uygulanır).
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
  - Küme değişince mevcut hesaplar `syncFreeModuleGrants()` ile hizalanır (yeni ücretsiz
    modül yalnız ücretsiz paketi almış firmalarda açılır); satın alınmış
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
  bakarken doğuyor, cevabı da orada verilebilmeli. Pencere DAR uca yazar
  (`PUT /api/personel/employees/[id]/calisma-duzeni`, yalnız `usesShifts`): genel kart
  ucu maaş/IBAN da yazdığı için yalnız "Personeller"e açık ve takvim yetkisiyle 403
  alıyordu (2026-10-05).
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
  günü kasaya geçer (`lib/raporlar/bilanco-kiymet.ts`). Alınan evrakın cirosu
  `statusChangedAt` gününe kadar portföydedir (2026-10-05; durum tarihi kuralı
  `lib/cek-senet/durum-tarihi.ts`). İade/protesto evrak cari bakiyesinde olduğu gibi HİÇ
  sayılmaz — ikisini ayrı modele bağlamayın, açılış fişi farkla dengelenir.

## Muhasebe defteri: fiş kaynağın karşılığıdır, senkron tek fonksiyon

Muhasebe ayrı, ücretli modüldür (`accounting`, 2026-10-04). Belgeden ve para
hareketinden kendiliğinden TASLAK yevmiye fişi doğar, kullanıcı eksik hesabı seçip
onaylar. Plan ve durum: `docs/muhasebe/MOTOR-PLAN.md`; kod `lib/muhasebe/`.

- **Defter tüzel kişidedir:** şube ana firmanın defterine yazar (`defterBaglami`,
  fiş `sourceCompanyId` taşır). Modül şubeye AÇILMAZ (`ModuleDef.notForBranches` →
  `resolveOpenModules({ isBranch })`, satın alma ucu, katalog, sistem-admin kartı) ve
  ücretsiz yapılamaz (`sanitizeFreeModules`).
- **Kaynaklar cari bakiyesinin kaynaklarıyla AYNIDIR** (yukarıdaki bölüm) + bordro ve
  kasa açılışları. Yeni bir cari/kasa kaynağı eklerken `kaynaklar.server.ts`e yükleyici
  ve kural dosyasına (`fis-kurallari.ts` / `para-kurallari.ts`) kural girer; yoksa
  mizandaki 120/320 alt hesabı carinin bakiyesinden ayrışır. Ölçüm:
  `npm run test:canli -- lib/muhasebe/defter-tutarlilik` (salt okur; cari alt hesabı =
  cari bakiyesi, kasa alt hesabı = kasa bakiyesi, her fiş dengeli).
  Aynı sebeple ciro fişi tedarikçiyi BİLMEZ (karşı hesap müşavirce seçilir): Kobipo'da
  ciro cari bakiyesine girmiyor, tedarikçiye ödeme ayrı "verilen evrak" kaydıdır.
- **Veri modeli (2026-10-05, migrasyon `20261005000001`):** bordro `employerSgk` (boş =
  teşviksiz oranla otomatik, `bordroIsverenPayi`; fişte B gider · A 361), çek/senet
  `statusChangedAt` (ciro fişinin tarihi; not yazmak fişi oynatmaz), hareket
  `transferGroupId` (virmanın iki bacağı; eski bacak eski kurala düşer — `virman-eslestir.ts`)
  ve `exchangeRate` (dövizli hesapta kur; para birimi HESAPTAN gelir, dövizli hesapta cari/
  fatura bağı ve farklı para birimli virman reddedilir — `lib/finans/doviz-hareket.ts`).
- **Kaydı yazan yol `muhasebeyeBildir(companyId, [{ tip, id }])` çağırır** —
  transaction'dan SONRA (senkron ayrı bağlantıyla okur). Fırlatmaz; modül kapalıysa tek
  sorguyla döner. Unutulan yol fişi eksik bırakmaz: Fişler/Ayarlar ekranı açılınca
  mutabakat (`senkronla`) bütün kaynakları karşılaştırır.
- Başlangıç sınırı kaynağın HAM tarihiyle sorulur (açılış fişiyle aynı eksen, `date <
  başlangıç`); fiş tarihi İstanbul günüdür (`istanbulGunu`), FATURA fişi UTC günüdür
  (`utcGunu` — KDV raporu ayı UTC'yle süzüyor).
- **Onaylı fiş kendiliğinden değişmez:** kaynak değişince `sourceChangedAt` işaretlenir
  ("Belge değişti" sekmesi), kullanıcı "Yeniden üret"e basar. Taslak fiş kaynakla
  birlikte yenilenir; elle seçilmiş hesap (USER) korunur.
- **Öğrenme yalnız ONAYDA** (`account_mapping_rules`); öğrenilen eşleşme bekleyen
  taslaklara hemen yayılır (`taslaklariYenidenCoz`). Fişe yalnız AKTİF ve YAPRAK hesap
  yazılır; hesap planına alt hesap açmak üstüne düşen taslak satırları hesapsız bırakır.
- **Satırsız fiş deftere GİRMEZ** (0 TL'lik belge, bakiyesiz açılış): onaylanamaz ve taslak
  sayıldığı için yıl sonu kapanışını kilitler. Senkron ve açılış bunu ayıklar, eski boşları siler.
  Başlangıçta Kobipo'da bakiye yoksa açılış fişi KENDİLİĞİNDEN açılmaz; müşavirin sermaye/demirbaş
  gibi kalemleri için fiş ilk elle satırlarıyla BİRLİKTE açılır (`acilisFisiniElleAc`, ekran
  `/muhasebe/fisler/acilis`, Ayarlar'dan bağlantı) ve son elle satır silinince kalkar. Boş başlık
  yazıp sonra doldurmayın: araya giren mutabakat onu siler.
- **Taslağın satırına yazan her yol FİŞ KİLİDİNİ alır** (`lib/muhasebe/kilit.server.ts`):
  transaction'ın başında `taslaklariKilitle` (`FOR UPDATE`, id sırasıyla) — satırlara yalnız
  dönen, hâlâ TASLAK fişlerde dokunulur. Onay da `fisleriKilitle` ile kilidi alıp satırları
  KİLİT ALTINDA okur ve sınar. Okuma ile yazma arasında fiş onaylanabilir (Fişler ekranı açılırken
  mutabakat arka planda koşar) ya da satırları değişebilir; kilitsiz yol ya onaylı fişi ezer ya
  da sınanmamış satırı onaylatır. Tek cümlelik koşullu silme (`deleteMany … status: "DRAFT"`)
  kilide gerek duymaz; çok satırlı silme de kilitten geçer (kilit sırası, deadlock).
- **Toplu eşleme kural YAZMAZ** (`esleme.ts` / `esleme.server.ts`, ekran
  `/muhasebe/fisler/eslesme`): bekleyen satırlar öğrenme anahtarına göre gruplanır, seçilen hesap
  satıra ELLE SEÇİLMİŞ (USER) yazılır; kural fiş ONAYLANINCA öğrenilir. Ekran eşlemeden sonra
  "emin"e geçen fişleri onaylamayı önerir.
- **Senkron/onay yolları TOPLU yazar** (parça başına tek transaction, `UPDATE … FROM (VALUES)`,
  `createMany`). Kayıt başına sorgu, 2026-10-04 ölçümünde kurulumu 2,6 dk, mutabakat adımını
  5 dk yaptı. Yeni bir döngüye `await prisma…` yazmadan önce toplu karşılığını düşünün.
- Fiş DENGELİDİR (`fisKur` dengesiz fişte fırlatır). Cari satırı BELGE TOPLAMIDIR;
  kuruş farkı gelir/gider satırına katılır, KDV'ye dokunulmaz.
- Dönem kapanışı (`kapanis.ts`) fişleri onaylı yazar ve `lockedUntil`le kilitler;
  kilitli döneme yeni fiş açılmaz, mutabakat bunu "kilitli döneme düşen" diye sayar.
- Ölçüm (uçtan uca): `node scripts/test-muhasebe.mjs` (dev sunucu açık, Reypo Medya;
  açtığı her şeyi siler; önceki kurulum kaldıysa `MUHASEBE_SIFIRLA=1`).

## Alış faturası: ödeme durumu + "çalışan cebinden ödedi" defteri

Alış editöründe (Paraşüt düzeni, `components/e-donusum/alis-odeme-stok.tsx`) üç seçenek:
**Ödenecek** (fatura açık, vade = `dueDate`), **Ödendi** ve **Çalışan Cebinden Ödedi**.
Son ikisi faturayla AYNI istekte tam tutarlık ödeme yazar (`purchasePayment` gövdesi →
`createInvoiceFromBody` → `createInvoicePayment`). Seçim fatura AÇILMADAN doğrulanır;
yazma yine düşerse fatura kalır ve yanıt `paymentWarning` taşır — sessiz geçilmez.

```
Çalışan öder   → InvoicePayment "EMPLOYEE" (kasasız) + EmployeeLedgerEntry EXPENSE
                 tedarikçi bakiyesi düşer, kasa değişmez, firma çalışana borçlanır
Çalışana öde   → Transaction EXPENSE reference "CALISAN:<employeeId>" + Ledger REIMBURSEMENT
                 (personel kartı → Masraflar; yazma yetkisi bordro ile aynı: /personel/maas)
```

- **Gider BİR KEZ sayılır:** gider alış faturasıdır. `CALISAN:` önekli hareket kâr/zarar,
  gelir-gider, harcamalar ve finansal özette DIŞLANIR (`NOT_TRANSFER_OR_SETTLEMENT_WHERE`
  + ham SQL'de satır içi `NOT LIKE 'CALISAN:%'`); nakit akışı onu fatura ödemesi sayar.
  Yeni bir kâr raporu yazan bu öneki de dışlar (`lib/personel/calisan-odemesi.test.ts` ölçer).
- Defter TUTAR TUTMAZ: tutar/tarih bağlı para kaydındadır; kayıt silinince satır Cascade
  düşer. Bakiye tek yerden: `lib/personel/masraf-defteri.ts` (kart, bilanço "Personele
  borçlar / Personelden alacaklar" kişi başına, nakit projeksiyonu vadesiz çıkış).
- Yalnız TL alış faturası (defter tek para birimi). Defterde satırı olan çalışan silinemez.
- **Stok takibi:** `Invoice.skipStock` ("Stok girişi yapılmasın") KAYITTA durur — PUT stok
  mutabakatı onu okur; açılınca faturanın stok etkisi geri alınır, kapanınca yazılır.
  Stoğa işlenmiş irsaliye bağlıysa stoğun sahibi irsaliyedir, bayrak etkisizdir.

## "Taslak" yalnız GİB'e gitmemiş e-belgedir; Manuel ve alış belgesi "Kayıtlı"dır

`Invoice.status = DRAFT` üç farklı anlama geliyor ve karıştırıldığında rakamlar ayrışıyor.
Karar (2026-09-30) tek yerde: `lib/invoice/status-label.ts` → `kaydedildigindeKesinlesir`.

```
ALIŞ FATURASI                          DRAFT = "Kayıtlı"  — alınan belge, onay akışı yok
MANUEL belge (kâğıt/matbu, belge       DRAFT = "Kayıtlı"  — kaydedildiği an kesilmiştir;
  taramayla okutulan, e-Dönüşüm kapalı)                     "Onayla" (DRAFT→SENT) adımı YOK
e-Fatura / e-Arşiv SATIŞ ve İADE       DRAFT, GIB_DRAFT = "Taslak" — GİB'e gitmedi, kesilmedi
  (alış iadesi de bizim DÜZENLEDİĞİMİZ belgedir; alış faturası gibi okunmaz)
```

Ölçüm: son 12 ayda 32 matbu satış faturasının ve 54 fişin HEPSİ DRAFT'taydı, yalnız 4 matbu
fatura onaylanmıştı. "Taslak = kesilmemiş" varsayan her yer bunları yanlış dışarıda bırakıyordu
(KDV otomasyon kartı, "taslakta kalmış" kartı, pano taslak sayısı, yaşlandırma, asistan).

- **KDV'ye giren belge TEK YERDE:** `lib/raporlar/kdv-kural.ts` (aynı tanım + iptal/CONVERTED
  hariç + döviz faturadaki kurla TL; kursuz dövizli belge toplama girmez, SAYISI ekrana yazılır).
  Vergi raporu, KDV otomasyon kartı ve pano KDV kartı aynı `computeVatDeclaration`ı çağırır.
- **Tevkifat (2026-10-01):** satışta alıcının tevkif ettiği KDV (`InvoiceItem.withholdingAmount`)
  hesaplanandan DÜŞER — satıcı KDV-1'de yalnız kalan kısmı beyan eder. Alışta indirilecek KDV
  faturadaki KDV'nin TAMAMIdır; bizim tevkif ettiğimiz kısım ayrıca KDV-2 ile ödenir
  (`withholding.purchases`, ekran ayrı satır yazar). Matrah kalemden: `totalAmount − vatAmount +
  withholdingAmount − matraha girmeyen diğer vergi` (`totalAmount` KDV dahil, tevkifat düşülmüş
  tutardır; ÖİV ve Konaklama Vergisi kendi kanunlarıyla KDV matrahı DIŞINDADIR ama toplamda
  durur — liste `OTHER_TAX_CODES_IN_VAT_BASE`, ÖTV/GEKAP matrahta kalır).
- **Kalem fatura altı iskontoyu/ilaveyi DÜŞMEDEN saklar (2026-10-02):** `invoice_items`
  KDV/tevkifat/toplam satırın kendi iskontosuyla kurulur; belge (başlık + GİB) genel iskontoyu
  satırlara orantılı dağıtıp vergiyi sonra hesaplar. Kalemden TUTAR okuyan her rapor kalemi
  belgedeki karşılığına çevirir: SQL'de `faturaAltiCarpanSql` + `belgedekiTutarSql` (KDV
  raporu), TS'te `lib/raporlar/fatura-alti.ts` (satış/alış raporunun kalem ve ürün
  bölümleri) — aynı kural, maktu GEKAP muaf. Düz `SUM(ii."vatAmount")` iskontolu belgede
  fazla, ilaveli belgede eksik sayar (~5.250 TL / 27 belge; Eren'in Eylül alışında
  indirilecek 83 TL fazla). Kayıtlı kalemler bilerek düzeltilmedi. Ölçüm:
  `npm run test:canli -- lib/raporlar` (salt okur).
- **Tarih ekseni:** `invoices.date` 00:00 UTC, `incoming_invoices.docDate` ise İstanbul gece
  yarısı (21:00 UTC). Gelen faturayı ay sınırıyla süzerken gün İstanbul takvimine çevrilir
  (`aktarilmamisGelenFaturalar`); ham karşılaştırma ayın 1'ini önceki aya yazar.
- **Muhtasar bordrodan** (`computeMuhtasar`, `PayrollRecord`): gelir + damga (`taxDeduction`) ve
  SGK işçi payı. Kişi başı döküm yalnız `/personel/maas`ı açabilene (uç ve Excel aynı
  `canViewPage` kuralı). Beyan son günleri saf modülde: `lib/raporlar/beyan-takvimi.ts`
  (KDV 28, MPHB 26, hafta sonu → Pazartesi; bayram/süre uzatması bilinmez).
- "Kesilmiş satış" soran yeni sorgu durum listesini ELLE yazmaz: SQL'de `kesilmisBelgeSql("i")`,
  TS'te `kaydedildigindeKesinlesir`. `status NOT IN ('DRAFT', ...)` yazmak kâğıt faturayı düşürür.
- Yaşlandırma (`cari-yaslandirma.ts`) yalnız kesilmemiş e-belge taslağını ayıklar; liste
  süzgeci "taslak" (`lib/faturalar/list-query.ts`), K-BLG-04 kartı ve pano sayısı aynı kümedir.
- **Ba-Bs formu YOK ve eklenmez:** VUK Genel Tebliği 565 (RG 25.09.2024) Eylül 2024
  döneminden itibaren bildirimi kaldırdı. Eski "Ba-Bs" sekmesi 2026-10-01'de silindi.

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

## KDV istisna kodları: kaynak GİB kod listesidir, Mysoft'un listesi DEĞİL

KDV %0'lı kalemde seçilebilen kodlar TEK yerde: `lib/integrations/e-invoice/gib-exemption-codes.ts`
(editör seçicisi + Excel içe aktarım doğrulaması). 2026-09-28'e kadar editörde elle yazılmış
5 kod vardı ve üçünün etiketi yanlıştı ("325 - Sağlık hizmetleri" → 325 aslında Yem Teslimleri).

- Mysoft'un `GET /api/GeneralCard/taxExemptionReason` listesi GİB'in GERİSİNDE kalabilir:
  UBL-TR v1.43 ile eklenen 233'ü içermiyor, GİB'in reddettiği 308/339'u (Yatırım Teşvik'e
  taşındı) hâlâ veriyor. Liste canlıdan çekilip seçiciye basılmaz.
- Seçici = GİB `istisnaTaxExemptionReasonCodeType` içindeki 2xx/3xx + 351. GİB listesinde
  olup seçicide OLMAYAN her kodun nedeni yazılıdır (`kdvExemptionCodeError`): ÖTV kodları
  (1xx), 501/555, YTB (308/339), ihraç kayıtlı (701–704), özel matrah (801–812). Son ikisi
  ayrı fatura tipi ister ve Kobipo bu tipleri henüz KESMİYOR — koda eklemek belgeyi GİB'den
  döndürür. Test (`gib-exemption-codes.test.ts`) "nedensiz boşluk yok" kuralını ölçer.
- GİB kod listesini güncelleyince: test dosyasındaki GİB kod kümesi yeni paketten kopyalanır,
  sonra `npx tsx scripts/istisna-kodu-kontrol.ts --bosluk` (salt okur: Mysoft listesiyle
  fark + her kod canlı GİB şematronundan ISTISNA tipinde + 200–399 boşluk taraması).

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

## Fiş, tahsilat, adisyon kapanışı: mantık `lib/`'de, uç ince sarmalayıcı

2026-09-24'ten beri üç yazma ucunun iş mantığı uçta DEĞİL, çekirdek fonksiyonda
(ÖKC yazarkasa webhook'u oturumsuz çağırabilsin diye — `docs/okc/ASAMA1-KOBIPO.md` A5):

| Uç | Çekirdek |
|---|---|
| `POST /api/e-donusum/invoices` | `lib/invoice/create-invoice.ts` → `createInvoiceFromBody` |
| `POST /api/faturalar/odemeler` | `lib/finans/create-invoice-payment.ts` → `createInvoicePayment` |
| `GET/POST /api/restoran/adisyonlar/[id]/kapat` | `lib/restoran/close-ticket.ts` → `prepareTicketClose` / `closeTicket` |

- Kural değişikliği ÇEKİRDEĞE yazılır; uca yazılan kural oturumsuz yolu (webhook) atlar.
- Kim/yetki dışarıdan gelir: `WriteActor` (`lib/api/write-actor.ts`). Uç
  `sessionWriteActor(user.id)` verir (`lib/api/session-actor.ts`) (= `ensureCompanyWrite`, AYNI noktada çağrılır);
  sistem `trustedSystemActor("system:…")` verir — kullanıcı yetkisi sormaz, firma
  var/aktif/arşivde değil ve modül durumu yine sorulur. Onu yalnız kaynağını KENDİSİ
  doğrulamış (imzalı webhook) ve `companyId`yi kendi kaydından alan kod kullanır.
- Sunucuda uçtan uca kapanış: `lib/restoran/close-with-receipt.ts` → `closeTicketWithReceipt`
  (hazırlık → fiş → tahsilat → kapanış; yarım kalan denemenin sahipsiz fişini YENİDEN
  kullanır, ikinci fiş kesmez). Tahsilat kanalı ekranla ortak: `defaultPaymentAccounts`.
- Kapsam nöbetçisi (`lib/page-api-coverage.test.ts`) `sessionWriteActor`/`sessionReadAuthorize`i
  kapı çağrısı sayar.
- Ölçüm: `npx tsx scripts/test-sunucu-kapanis.ts` (dev sunucu açık; temizlik HTTP ile).

## Masada birden çok açık hesap YALNIZ bölmeyle doğar

"Masada tek açık adisyon" kuralı YENİ adisyon açarken durur (`POST /api/restoran/adisyonlar`
409 + mevcut hesap). "Ayrı hesaplara ayır" (`POST .../[id]/bol`, kural `lib/restoran/split.ts`)
kalemleri (adet bölünebilir) yeni adisyona TAŞIR; parça `splitFromId` taşır. Sonuçları:

- Masa listesi `openTicket`i MASA ÖZETİdir (toplam tutar, ilk hesap); hesaplar tek tek
  `openTickets`te. Masaya bakan yeni kod tek hesap VARSAYMAZ.
- Kapanışta masa "temizlenecek" damgası ancak SON açık hesap kapanınca basılır.
- Sürükle-bırak birden çok hesaplı masayı taşımaz (yalnız ilk hesabı taşırdı).
- İskonto: yüzde her parçaya aynen; tutar brüt oranında, kuruş kalanı kaynakta.
- Ölçüm: `node scripts/test-hesap-bolme.mjs` (dev sunucu açık).

## Yazarkasa (ÖKC): fişin mali kimliği fişte, Z mutabakatı tek fonksiyonda

`OkcDevice` şube bazlıdır; `Invoice.okcDeviceId/okcReceiptNo/okcZNo/okcSource` fişin mali
kimliğidir (Aşama 2'deki sepet kaydı yalnız taşımadır). Z raporu ↔ Kobipo karşılaştırması
TEK yerde: `lib/okc/z-mutabakat.ts` (saf) + `z-mutabakat-query.ts` (seçim). Gün sınırı
Z'dir (önceki Z → bu Z), takvim günü değil. Plan ve araştırma: `docs/okc/`.
- **Z ödeme tipleri Kobipo'nun ayırt edebildiği GRUPLARLA karşılaştırılır** (`zMethodGroup` /
  `kobipoMethodToGroup`): Z'de KREDİ + KAREKOD KART = Kobipo kartı (Kobipo QR'lı kartı ayırmaz),
  KAREKOD FAST = havale. Z tipini Kobipo yöntemiyle birebir eşlemek her gün sahte fark üretir.
  Form Z'nin basılı alanlarını alır (KDV satırında KDV DAHİL toplam; matrah türetilir).
- **Fiş iptali yazarkasa kapısından geçer** (`receiptCancelVerdict`, kapsayan Z'yi
  `findCoveringZNo` bulur — mutabakatla AYNI pencere kuralı): girilmiş Z'nin kapsadığı
  fiş iptal edilmez (409 `OKC_Z_TAKEN`); yazarkasa bilgili fiş `okcConfirmed` ister
  (409 `OKC_CONFIRM`). Kobipo'daki iptal cihazdaki mali fişi iptal ETMEZ; kapı olmazsa
  Z ile Kobipo sessizce ayrışır. Fiziksel silme (`DELETE /api/e-donusum/invoices`) bu
  kapıdan geçmez — test temizliği onu kullanır, ekranda fiş silme yok.
Ölçüm: `node scripts/test-okc-asama1.mjs` (dev sunucu açık).

## Yetki değişikliği ve yetki reddi günlüğe yazılır

2026-10-05'e kadar Ekip Yönetimi'nden yapılan izin değişikliği hiçbir yere yazılmıyordu.
Grup bazında daraltılan bir çalışanın (Ayarlar → Firma Bilgileri gitti) fatura editörü
firma kartını okuyamadı, faturayı MANUAL kaydetti ve "yetkisi ne zaman, kim tarafından
değişti" sorusu ancak kestiği faturalardan geriye doğru tahminle cevaplanabildi.

- Üyelik (`userCompany`) ve özel rol (`companyRole`) yazan HER yol `system_logs`a önce/sonra
  ETKİN sayfa listesiyle yazar: `withMembershipLog` (yazmayı sarar) ya da `logRoleChange`
  (`lib/audit/permission-log.server.ts`; farkı kuran saf taraf `permission-log.ts`).
  Eylemler `ADD_/UPDATE_/REMOVE_USER_COMPANY`, `CREATE_/UPDATE_/DELETE_COMPANY_ROLE`.
  Nöbetçi: `lib/audit/permission-log-coverage.test.ts` — günlüğü çağırmayan yazan dosyada kırılır.
- Sayfa kapısının reddi `PAGE_FORBIDDEN` olarak yazılır, kullanıcı × firma × kural başına
  günde BİR kez (`lib/middleware/company.ts`). Arayüz yetkisiz düğmeyi gizlediği için ret
  çoğu zaman bir hatanın izidir: yukarıdaki olayda editörün okuması böyle sessizce reddediliyordu.
- Günlük FAIL-OPEN'dır: yazılamazsa işlem engellenmez, hata konsola düşer.
- Okuma: Sistem Yönetimi → Loglar → "Yetki değişiklikleri" / "Yetki reddi"; arama e-posta
  ya da firma adıyla (Türkçe duyarsız).
- Kapı kuralının OKUMA listesi ucu okuyan HER ekranı sayar (`PAGE_API_RULES.pages`);
  yazma listesinin kopyası yazılırsa izinli ekran sessizce bozulur.

## Bir ekran BAŞKA sayfanın ucunu çağırıyorsa yetki ona göre sorulur

Sayfa kapısı monotondur: uç, kuralındaki sayfalardan BİRİNİN yetkisiyle açılır. Ekran
kendi sayfasına ait olmayan bir uca dokunuyorsa (personel kartında "Bordro Ekle" →
Maaş-Ödemeler, cari kartında "Tahsilat Ekle" → Finans Hareketleri, ürün seçicide "yeni
ürün" → Ürün Listesi) iki yoldan biri seçilir:

- Ekranın İŞİ o uçsa kurala eklenir (`PAGE_API_RULES`): Kahveci Satış/adisyon → fiş +
  tahsilat, Menü → ürün, Çek/Senet → hesap listesi, raporlar → tanımlar.
- Değilse düğme gizlenir: `<WriteAction api="/api/…">` ya da `useCanCallApi(path, method)`
  (`components/dashboard/write-guard.tsx`) — sunucu kapısıyla AYNI fonksiyon. Ortak okuma
  listeleri (`lib/swr/use-company-data.ts`) de oradan geçer: okuyamayan istek atmaz, yetki
  günlüğü (PAGE_FORBIDDEN) beklenen retlerle dolmaz.
- Menüsüz rotanın sahibi (`ROUTE_OWNERS`) menü öğeleriyle EN UZUN eşleşmede yarışır;
  "/stok" ön eki kendi alt menü öğelerini yutuyordu (Etiket/Hizmet/Transfer).

Hazır roller bir grubun bütün sayfalarını birlikte verdiği için bu kopukluklar görünmez;
özel rolde ve kısıtlı üyelikte patlar (2026-10-05: Kasiyer/Garson kalıpları satış
tamamlayamıyordu). Ölçüm:

- `npx tsx scripts/uctan-uca/rol-statik.ts` — her sayfa YALNIZ kendi yetkisiyle; koddaki
  çağrılar (butonla tetiklenenler dahil) ADAY listesidir, elle doğrulanır (gizlenen düğme
  ve tasarım gereği dar kalan uç listede kalır).
- `npx tsx scripts/uctan-uca/rol-taramasi.ts` (dev sunucusu `npx next dev -p 3005 -H
  127.0.0.1`) — 20 rol profili, izinli her sayfa ve detay rotası gerçek tarayıcıda;
  açılışta yazma kesilir, Reypo'ya veri yazılmaz, test kullanıcıları sonunda silinir.
  Rapor `docs/denetim/<tarih>-ROL-TARAMASI.md`; `--profil`/`--sayfa` süzgeçli koşu
  onu ezmez, `scripts/uctan-uca/rol-sonuc.md`ye yazar.

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
