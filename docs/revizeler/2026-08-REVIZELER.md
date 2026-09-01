# Müşteri revizeleri — 2026-08-31

Kaynak: müşteri mesaj dökümü (WhatsApp ekran görüntüsü, 12:59–14:01). 10 mesaj,
11 işe bölündü. Bu dosya **devir notudur**: ne bitti, ne yarım kaldı, hangi karar
kimden alındı.

## Kullanıcıdan alınan kararlar

| Konu | Karar |
|---|---|
| Rapor "tanım" sütunu | **İki ayrı sütun**: Sınıflandırma 1 ve Sınıflandırma 2 (ekran + Excel) |
| Yaşlandırmada "ayı 3'e bölmek" | **Ay içi 3 periyot**: 1-10 / 11-20 / 21-ay sonu; vadesi o dilime düşen açık tutar |
| Stok hareketinde cari süzgeci | Kaynak **belge üzerinden çözülür** (fatura/irsaliye → cari). Belgesiz hareketler (sayım, transfer, açılış) cari süzgeci seçilince listeye girmez |
| Stok hareketinde "tanım" süzgeci | **Carinin tanımı** (Sınıflandırma 1/2), ürün kategorisi değil |
| Ödeme planı kaç Excel sayfası | **İki sayfa**: Tahsilat Planı (müşteri) + Ödeme Planı (tedarikçi) — yaşlandırmanın kendisi de Alacaklar/Borçlar diye ikiye ayrıldığı için |
| Rapor kartının linki nereye | **Ayrı alt sayfa** (sekme değil): `/raporlar/satis/<bölüm>`. Müşteri "link" dedi; ayrı adres paylaşılabilir ve tarih aralığını URL'de taşır |
| Şubede e-fatura kimliği | **Ana firmadan devralınır** (VKN gibi). Şube ayrı Mysoft mükellefi değil; şablon kümesi ana firmayla ORTAK |

## Durum tablosu

| # | İş | Durum |
|---|---|---|
| E1 | Fatura ekranında ürün/hizmet arama listesi dar kalıyor | ✅ bitti |
| C1 | Tanımlar ekranında düzenleme (yeniden adlandırma) yok | ✅ bitti |
| D2 | Ürün detayı → stok hareketlerine fatura linki + e-Belge no | ✅ bitti |
| A1 | Satış raporunda tarih aralığı | ✅ bitti |
| A2 | Satış raporunda + Excel'de tanım sütunları | ✅ bitti |
| B1 | Cari yaşlandırmada + Excel'de tanım sütunları | ✅ bitti |
| D1 | Stok hareketleri ayrı sayfa + tarih/cari/tanım süzgeçleri | ✅ bitti |
| A3 | Excel'e "Detaylı Faturalar" sayfası (fatura kalemleri) | ✅ bitti |
| B2 | Yaşlandırma Excel'ine ay içi ödeme planı sayfası | ✅ bitti |
| A4 | Rapor ekranını kutu düzenine çevirme (her Excel sayfası = kart + link) | ✅ bitti |
| F1 | Şubede e-fatura şablonu düzenlenemiyor | ✅ bitti — kimlik devralma + asıl sebep (yanlış etiket / çıkmaz sokak) düzeltildi |

**11 işin 11'i kapandı.** F1 iki aşamada bitti: kimlik devralma (kök neden
sanılan), sonra ölçümle bulunan asıl sebep — şablon satırındaki yanlış etiket ve
çıkmaz sokak. `npx tsc --noEmit` temiz, `npx vitest run` **640 test** geçti,
`npx next build` temiz (yeni iki route derleniyor). Hiçbir şey commit edilmedi —
tüm değişiklikler çalışma ağacında.

Rapor/Excel işleri (A4, B2) canlı veriyle salt okunur olarak ölçüldü: ekran
bölümleri ile Excel sayfa adları birebir aynı kaynaktan geliyor, kalemler yalnız
istendiğinde çekiliyor, ödeme planı satırlarında
`Geçmiş Aylar + Bu Ay Toplam + Sonraki Aylar = Toplam Açık` tutuyor.
**Tarayıcıda uçtan uca test YAPILAMADI**: giriş ekranı reCAPTCHA istiyor.

Müşteriye sorulacak açık başlıklar aşağıda "Kalan sorular" bölümünde toplandı.

---

## Bitenler — ne değişti

### E1 · Ürün/hizmet arama listesi (`components/e-donusum/product-combobox.tsx`)

Liste `absolute` konumluydu ve fatura kalemleri kartı `overflow-hidden` olduğu
için (`components/e-donusum/invoice-editor.tsx:2778`) satırın içinde kırpılıyordu:
"alt satırın üzerine çıkamıyor, çok dar kalıyor" şikâyetinin sebebi buydu.

- Liste `document.body`'ye **portal** ile `position: fixed` basılıyor
  (aynı desen `tax-type-combobox.tsx`te zaten vardı).
- Taban genişlik `MIN_MENU_WIDTH = 360px`; sağ kenardan taşarsa içeri çekiliyor.
- Aşağıda yer yoksa **yukarı açılıyor**; scroll/resize'da konum güncelleniyor.
- Dış tıklama kontrolü portal'ı da hesaba katıyor.
- "Yeni ürün" dialogu açılırken liste kapatılıyor (zIndex 60 > overlay 50).
- Etkilediği ekranlar: satış/alış faturası, hızlı satış, hızlı alış, irsaliye,
  sipariş, teklif. `quick-sale`/`quick-purchase` içindeki eskiyen
  "overflow-hidden VERİLMEZ" yorumları güncellendi.

### C1 · Tanım düzenleme (`app/(dashboard)/ayarlar/tanimlar/page.tsx`)

Ekranda yalnız "Ekle" ve "Pasifleştir" vardı; ad değiştirilemiyordu.

- Satır içi düzenleme: Düzenle → input → Kaydet/Vazgeç (Enter kaydeder, Esc iptal).
- İki sekmenin kopya JSX'i tek `renderTab()`e indirildi; sekme değişince yarım
  düzenleme kapanıyor.
- `app/api/company/definitions/[id]/route.ts`: boş ad 400, **aynı ada çevirme
  409** ("Bu adda bir tanım zaten var"). Öncesinde P2002 → 500 düşüyordu.

### D2 · Ürün detayında fatura linki

- `app/api/stok/products/[id]/route.ts`: hareketin referansı faturaysa
  `invoice: { id, no, type }` dönüyor. `no` = **`eDocumentNo` (GİB'e giden asıl
  numara), yoksa `invoiceNo`**.
- `app/(dashboard)/stok/[id]/page.tsx`: Referans hücresi faturaya link veriyor
  (`/faturalar/<id>/onizleme?company=…&from=/stok/<id>`). Fatura değilse
  `referenceLabel()`: `waybill:<id>` → "İrsaliye", çıplak cuid → "—"
  (eskiden ham cuid basılıyordu).

### A1 · Satış raporunda tarih aralığı

Ekran `/api/e-donusum/invoices`ten TÜM faturaları çekip tarayıcıda topluyordu;
Excel ise sunucuda `computeSalesPurchaseReport` ile hesaplanıyordu. Tarih aralığı
yalnız Excel'de vardı ve iki sonuç birbirini tutmuyordu.

- **Yeni uç**: `app/api/raporlar/satis-alis/route.ts` (companyId, type,
  startDate, endDate) → aynı `lib/raporlar/satis-alis.ts` hesabı.
- **Yeni ortak bileşen**: `components/raporlar/satis-alis-report.tsx`.
  `/raporlar/satis` ve `/raporlar/alis` ikiz kopyaydı; ikisi de bu bileşene indi.
- Tarih aralığı varsayılanı **yılbaşı → bugün** (kar/zarar ekranıyla aynı);
  "Tüm kayıtlar" düğmesi aralığı kaldırır. Aralık ExportButton'a da geçer.
- **Davranış değişikliği (kullanıcıya söylenecek):** ekrandaki rakamlar artık
  Excel ile birebir aynı — iadeler EKSİ sayılıyor ve varsayılan dönem yılbaşından
  başlıyor. Eski ekran tüm tarihleri ve iadeleri artı sayıyordu.

### A2 · Satış/alış raporunda tanım sütunları

- `lib/raporlar/satis-alis.ts`: cari kartından `class1`/`class2` okunuyor;
  `SalesPurchaseInvoice` ve `topCounterparties` bu iki alanı taşıyor.
- `lib/export/datasets/reports-satis-alis.ts`: `CLASS_COLUMNS` hem "Müşteriler /
  Tedarikçiler" hem "Faturalar" sayfasına eklendi.
- Ekranda: cari listesinde ad altında, son faturalarda ad yanında rozet olarak.

### B1 · Cari yaşlandırmada tanım sütunları

- `lib/raporlar/cari-yaslandirma.ts`: `AgingAccount.class1/class2` (müşteri ve
  tedarikçi sorgularının ikisinde de `classification1/2` seçiliyor).
- `lib/export/datasets/reports.ts`: `AGING_COLUMNS`a iki sütun.
- Ekran (`raporlar/cari-yaslandirma/page.tsx`): "Hesap"tan sonra iki sütun;
  `colSpan` 7 → 9. Sayfanın **kendi kopya tipi** var, oraya da eklendi.

### D1 · Stok hareketleri ayrı sayfa

- **Yeni ortak kural**: `lib/stock/movement-sign.ts` — işaretli miktar, giriş mi,
  etiket. Ürün detay ucu (`app/api/stok/products/[id]/route.ts`) da artık buradan
  okuyor (kural iki yerde kopya duruyordu).
- **Yeni hesap**: `lib/raporlar/stok-hareket.ts`. Cari süzgeci varsa önce eşleşen
  fatura/irsaliye id'leri bulunur, hareketler `reference` ile DB tarafında
  daraltılır (bellekte süzmek 1000 satır tavanında yanlış sonuç verirdi).
  Tavan 1000 + `truncated` bayrağı.
- **Yeni uç**: `app/api/raporlar/stok-hareket/route.ts`.
- **Yeni sayfa**: `app/(dashboard)/raporlar/stok/hareketler/page.tsx`.
  Süzgeçler: tarih aralığı, müşteri, tedarikçi, Sınıflandırma 1/2, ürün arama.
  Fatura kaynaklı satırlar faturaya link verir.
  Yol `/raporlar/stok` altında seçildi: `navHrefsForPath` en uzun ön eki
  eşleştirdiği için sayfa kapısını üst sayfadan **devralıyor** — ayrı nav kaydı,
  rol matrisi ve şablon güncellemesi gerekmedi.
- **Yeni dışa aktarma**: `rapor-stok-hareket` (`buildStockMovementDataset`).
- `/raporlar/stok` sayfasındaki "Son Stok Hareketleri" kartı **kaldırıldı**,
  yerine yeni sayfaya giden kart kondu; artık `/api/stok/movements` çağrılmıyor.
- `lib/dashboard/page-titles.ts`: `/raporlar/stok/hareketler` → "Stok Hareketleri".
- `lib/swr/use-company-data.ts`: `useCompanyDefinitions(companyId, type)` eklendi
  (süzgeçlerde tanımın **id**'si lazım; `useProductCategories` yalnız etiket veriyor).

### A3 · "Detaylı Faturalar" sayfası (Excel)

- `lib/raporlar/satis-alis.ts`: `includeLines` seçeneği + `SalesPurchaseInvoiceLine`.
  Kalemler yalnız dışa aktarmada çekilir (ekran özetini yavaşlatmasın).
- `lib/export/datasets/reports-satis-alis.ts`: 4. sayfa **"Detaylı Faturalar"**.
  Her satır bir fatura KALEMİ; faturanın kimliği (tarih, no, e-Belge no, cari,
  tanımlar, belge tipi) her satırda tekrar eder — satırlar fatura fatura sıralı,
  yani her faturanın altında o faturanın kalemleri gelir, ama Excel'de tek başına
  süzülüp pivotlanabilir.
  **Sorulacak:** müşteri görsel olarak "fatura başlığı + altında kalemler" (grup
  satırı) istiyorsa bu düzen değişir.
- İade kalemlerinin miktar/tutarları EKSİ yazılır (fatura sayfasıyla tutsun).

### B2 · Ay içi ödeme planı (Excel)

- `lib/raporlar/cari-yaslandirma.ts`: `buildPaymentPlan()` (+ `PaymentPlanRow`,
  `PaymentPlan`). Ayı 1-10 / 11-20 / 21-son diye böler, her cari için o dilime
  **vadesi düşen** açık tutarı toplar. Sütun başlıkları ay adını ve ayın gerçek
  son gününü taşır ("21-30 Eylül", şubatta "21-28").
- `lib/export/datasets/reports.ts`: `paymentPlanSection()` + yaşlandırma
  çalışma kitabına **iki yeni sayfa** — "Tahsilat Planı" (müşteriler) ve
  "Ödeme Planı" (tedarikçiler).
- Geçmiş ve sonraki aylar ayrı sütunda: `Geçmiş Aylar + Bu Ay Toplam + Sonraki
  Aylar = Toplam Açık`. Olmasaydı üç dilimin toplamı toplam açığı tutmaz, tablo
  borcun bir kısmını yutmuş görünürdü.
- **Sütun adı bilinçli "Geçmiş Aylar"** (`pastMonths`), "Vadesi Geçmiş" değil:
  yaşlandırma sayfalarındaki "Vadesi Geçmiş" **bugüne**, plandaki dilimler **vade
  tarihine** göre ölçülür. Ayın 20'sinde 5'i vadeli fatura gecikmiştir ama planda
  "1-10" diliminde durur; aynı başlık kullanılsaydı tek dosyada aynı cari için iki
  farklı sayı görünürdü.
- **Yeni test:** `lib/raporlar/cari-yaslandirma.test.ts` (7 test) — dilim
  sınırları (10 → 1. dilim, 11 → 2.), kova toplamının toplam açığı kapatması,
  ay adı/son gün başlıkları.

### A4 · Rapor ekranı kutu düzeni + bölüm alt sayfaları

İstenen: Excel'deki her sayfanın ekranda başlığı **link** olan bir kartı olacak,
link kendi detay sayfasını açacak, o sayfada da tarih filtresi olacak.

- **Yeni tek kaynak**: `lib/raporlar/satis-alis-sections.ts`. Dört bölüm (aylık,
  cariler, faturalar, kalemler) burada tanımlı: slug, kart başlığı, açıklama,
  **Excel sayfa adı** ve kalem gerektirip gerektirmediği. Özet ekranın kartları,
  alt sayfalar ve dışa aktarma aynı listeden okur — `reports-satis-alis.ts`teki
  başlık/sayfa adı literalleri kaldırıldı, artık buradan geliyor.
- **Yeni sayfalar**: `app/(dashboard)/raporlar/{satis,alis}/[bolum]/page.tsx`.
  Dinamik segment: bölüm başına dosya açmak 8 kopya demekti. Bilinmeyen slug
  "bölüm bulunamadı" kartı basar. Yollar `/raporlar/satis` altında olduğu için
  sayfa kapısını üst sayfadan **devralır** (D1'deki `navHrefsForPath` ön ek
  eşleşmesi; test bunu kilitliyor).
- **Yeni ortak gövde**: `components/raporlar/satis-alis-section.tsx`. Dört bölüm ×
  iki taraf = tek bileşen; sütunlar `Col<T>` tanımlarıyla veriliyor ve toplam
  satırı TÜM veriden hesaplanıyor.
- Özet ekranda (`satis-alis-report.tsx`) kart başlıkları link oldu; dördüncü kart
  ("Detaylı Faturalar") eklendi. Kart linki **o an seçili tarih aralığını taşır**,
  alt sayfa aynı dönemle açılır.
- Uçta yeni parametre: `includeLines=1`. Kalemler yalnız "Detaylı Faturalar" alt
  sayfasında çekilir; özet ekran ve diğer bölümler eskisi gibi kalem sorgusu
  çalıştırmaz.
- Ekran kırpması: faturalar 500, kalemler 1000 satır gösterir; kırpma açıkça
  yazılır ve **toplamlar kırpılmamış veriden** gelir.
- `lib/dashboard/page-titles.ts`: sekiz bölüm için sekme başlığı ("Satış — Faturalar").

### F1 · Şubede e-fatura şablonu — kök neden kapatıldı

**Bulgu (doğrulandı):** şablon uçları firmanın **kendi**
`eDonusumApiUsername/Password` alanlarını okuyordu. Şube bu bilgileri yalnız
**kurulduğu anda** ana firmadan kopyalıyor (`lib/company/create-company.ts`);
VKN devralınıyor (`tenant.ts`) ama kimlik devralınmıyordu. Ana firmaya
**sonradan** girilen kullanıcı/şifre şubede boş kalıyor ve uç "Mysoft API
bilgileri eksik" dönüyordu.

- **Yeni ortak çözücü**: `lib/integrations/e-invoice/credentials.ts` —
  `resolveEInvoiceCredentials()` önce firmanın kendisine, yoksa ana firmaya bakar.
  `E_INVOICE_CREDENTIAL_SELECT` prisma select'i de burada (ana firmanın kimlik
  alanları dahil).
- Devralma **yalnız boşluğu doldurur**: şubenin kendi kimliği varsa ona
  dokunulmaz. Böylece bugün çalışan hiçbir şube etkilenmez — kural bir hatayı
  başarıya çevirebilir, tersini yapamaz.
- `company-provider.ts` (`resolveCompanyEInvoiceProvider`) bu çözücüye bağlandı:
  fatura gönder/iptal/durum/PDF, gelen faturalar, numeratörler ve şablon
  yenileme dahil **~20 uç** tek değişiklikle düzeldi.
- Elle provider kuran üç şablon ucu da bağlandı: `templates`,
  `templates/preview`, `templates/designs/preview`.
- Şifre çözülemediğinde mesaj artık kimliğin **sahibi** olan ekranı gösteriyor
  ("Ana firmanın E-Dönüşüm Ayarları").
- **Yeni test:** `lib/integrations/e-invoice/credentials.test.ts` (8 test) —
  kendi kimliğinin önceliği, yarım kimlik (kullanıcı var şifre yok) devralması,
  taban URL'nin ana firmadan gelmesi, select'in ana firmayı kapsaması.

**⚠️ SONRADAN ÖLÇÜLDÜ — bu düzeltme müşterinin yaşadığı sorun DEĞİL.** Canlı
veritabanında (salt okunur teşhis, 2026-08-31) e-Dönüşümü açık iki şube var ve
**ikisinin de kendi kimliği kayıtlı**, hatta ana firmayla AYNI Mysoft kullanıcısı:

```
ANA FİRMA  EREN FORKLİFT …            VKN 3531285187  kimlik: kendi
  ŞUBE     HİDROEREN …                VKN 3531285187  kimlik: kendi (aynı kullanıcı)
  ŞUBE     … / SEÇ MARKET             VKN 3531285187  kimlik: kendi (aynı kullanıcı)
```

Yani şablon ucu kimlik kontrolünden geçiyordu; "API bilgileri eksik" hatası bu
firmalarda hiç oluşmuyor. Devralma düzeltmesi doğru ve zararsız (kimliği eksik
şubeler için hâlâ gerekli) ama F1'i **açıklamıyor**.

**Gerçek sebep büyük olasılıkla şu:** Mysoft'ta şablonlar **VKN bazında ORTAK**,
Kobipo'daki `EInvoiceTemplate` kayıtları ise **companyId bazında ayrı**. Ölçüm:

```
ANA FİRMA : eforkliftvef [tasarım var] · eforkliftearsiv [tasarım var]
HİDROEREN : hidroerenef  [tasarım var] · HİDROEREN [tasarım YOK]
SEÇ MARKET: secmarketefatura [tasarım var]
```

Şube ekranı Mysoft'tan gelen ORTAK listeyi (beş şablonun tümünü) basar, ama yerel
tasarım kaydı yalnız kendi ikisinde vardır. Ana firmada tasarlanmış bir şablonu
şubede açan kullanıcı "Bu şablon Kobipo tasarımcısıyla yapılmadığından
önizlenemez" (409) alır — yani **düzenleyemez**. `HİDROEREN` adlı kayıt da
tasarımsız (portalden/eski akıştan gelmiş), o da hiçbir firmada düzenlenemez.

Dikkat: aynayı ana firmaya taşıyıp paylaştırmak **çözüm değil, regresyon olur** —
üç firmanın üçü de FARKLI aktif şablon kullanıyor (şubenin kendi logosu/adresi).
Paylaşım bu ayarı silerdi.

### F1 — canlı kimlikle ölçüm (2026-08-31)

Kullanıcı Reypo Medya Ajansı'na Mysoft şifresini girdi ve zincir **gerçek API
turuyla** sınandı (yalnız listeleme/önizleme; hiçbir yazma yok):

| ölçüm | sonuç |
|---|---|
| kendi kimliğiyle `listTenantXslt` | başarılı, **1449** şablon |
| ŞUBE BENZETİMİ — kimlik ana firmadan devralınarak | başarılı, **aynı 1449** şablon, `devralindi: true` |
| kayıtlı tasarımın PDF önizlemesi (`finaldir`) | 200, **114 KB PDF** |

Yani devralma yolu üretimde çalışır durumda: aynı mükellef, aynı liste, çalışan
oturum. Kimlik tarafında açık kapı kalmadı.

**Ama "önizlenemez" hatası ŞUBEYE ÖZGÜ DEĞİL.** Aynı hata ana firmada da
üretildi — Kobipo tasarımı olmayan şablonlarda, ki bunlardan biri firmanın
**aktif e-Arşiv şablonu**:

```
POST templates/designs/preview  "01_01_01_Ömer test 2" (tip 2, AKTİF) → 409
POST templates/designs/preview  "01_01_01_SARTO TEST"  (tip 1)        → 409
   "Bu şablon Kobipo tasarımcısıyla yapılmadığından önizlenemez."
```

Reypo'nun 28 yerel kaydından 5'i tasarımsız (portalden/eski akıştan gelmiş ya da
yalnız "aktif yap"/"gizle" upsert'i ile doğmuş). Müşterinin şikâyeti büyük
olasılıkla budur ve şube olmakla ilgisi yoktur.

### F1 — yapılan düzeltme: çıkmaz sokak kaldırıldı

Ekranda ölçülen asıl sorun **etiketin yalan söylemesiydi**. `isKobipo` yalnız
`EInvoiceTemplate` satırının VARLIĞINA bakıyordu; oysa "aktif yap" ve "listeden
kaldır" da seçeneksiz satır yaratıyor. Sonuç: portalden gelmiş bir şablon
"Kobipo tasarımı" etiketi alıyor, ama Önizle/Düzenle düğmesi çıkmıyor ve satırda
hiçbir açıklama olmuyordu — kullanıcı haklı olarak "şablonumu düzenleyemiyorum"
diyordu. Aktif e-Arşiv şablonu tam bu durumdaydı.

Yapılanlar (`app/(dashboard)/e-donusum/sablon/page.tsx`):

- Etiket dürüstleştirildi: "Kobipo tasarımı" yalnız tasarım seçenekleri kayıtlıysa.
- Satıra sebep yazıldı: "Kaynağı Kobipo'da olmadığı için önizlenemez ve
  düzenlenemez — tasarımcıyla yeni bir şablon oluşturabilirsiniz."
- Satıra **"Tasarım oluştur"** düğmesi eklendi; tasarımcıyı BOŞ açar. Var olan
  şablonun adıyla açmak KASITLI olarak yapılmadı — aynı adla kaydetmek ortak
  mükellefteki dosyayı (şubede ana firmanın şablonunu) ezerdi.
- İki ucun hata metni ne yapılacağını söylüyor (`templates/designs` GET ve
  `templates/designs/preview` POST).

Ekranda doğrulandı: E-Fatura'da 647 şablonun 642'sinde yeni ipucu ve düğme
göründü; aktif e-Arşiv satırı artık
`01_01_01_Ömer test 2 | Onaylı | Kobipo dışı | Kaynağı Kobipo'da olmadığı için… | Tasarım oluştur | Aktif`
şeklinde okunuyor.

### F1 — devralmayı tasarımlara GENİŞLETMEK neden tehlikeli

Ölçüm sırasında yeni bir kısıt çıktı: Mysoft'a yükleme **isim üzerinden ve ortak
mükellefe** yapılıyor (`addTenantXslt({ xsltName, content })`,
`lib/integrations/e-invoice/template-refresh.ts`). Sonucu şu:

> Şube, ana firmanın tasarımını devralıp AYNI adla kaydederse, gönderim
> öncesi otomatik tazeleme o adı ortak mükellefe yeniden yükler ve **ana
> firmanın faturasının görüntüsünü sessizce değiştirir.**

Bugün bu mümkün değil çünkü kayıtlar firma bazında ve her firma kendi adıyla
şablon üretmiş (`eforkliftvef` / `hidroerenef` / `secmarketefatura`). Dolayısıyla
"şube ana firmanın tasarımını düzenleyebilsin" istenirse kopya **yeni bir adla**
üretilmelidir; düz devralma açık kapı bırakır.

---

## Uçtan uca test — Chrome, 2026-08-31

Gerçek veriyle (Reypo Medya Ajansı, 253 satış faturası) tarayıcıda gezildi.

**Doğrulananlar**

- Özet ekran: ₺827.341,90 / 253 fatura / 8 müşteri — sunucu tarafı ölçümle birebir.
- Kart başlığına tıklamak alt sayfayı açıyor ve **hem firmayı hem dönemi** taşıyor:
  `/raporlar/satis/faturalar?startDate=…&endDate=…&company=reypo`.
- Faturalar bölümü 253 satır; Müşteriler bölümünün toplam satırı (253 / ₺827.341,90)
  özet ekranın KPI'larıyla aynı. Kalemler bölümü 277 satır (yalnız bu bölüm
  `includeLines=1` çağırıyor).
- Karşı tarafın slug'ı reddediliyor: `/raporlar/alis/musteriler` → "Bölüm bulunamadı".
- Yaşlandırma Excel'i: 200, 30,8 KB, dört veri sayfası + Rapor Bilgisi. Plan
  sayfalarında "Geçmiş Aylar" ve ayın gerçek son gününe göre dilimler
  (`21-31 Ağustos`). **Çapraz tutarlılık:** Tahsilat Planı TOPLAM'ı
  179.540,44 + 42.003 = **221.543,44** = Alacaklar sayfasının Toplam Açık'ı.
  Aynı satırda yaşlandırmanın "Vadesi Geçmiş"i 221.543,44 iken planın "Geçmiş
  Aylar"ı 179.540,44 — yani sütunu yeniden adlandırma kararı ekranda haklı çıktı.

**Testte bulunup DÜZELTİLEN**

- `faturalar/[id]/onizleme`: cuid → slug URL yükseltmesi sorguyu `?company=` ile
  yeniden kuruyor ve `from`'u DÜŞÜRÜYORDU. Sonuç: rapor tablosundan bir faturaya
  girip "Geri" diyen kullanıcı rapora değil `/satis/fatura` listesine gidiyordu.
  Sorgu artık olduğu gibi taşınıyor. Bu hata rapor bölümlerinden ÖNCE de vardı
  (cari kartından gelen linkler aynı yolu kullanıyor).

**Testte bulunan, DOKUNULMAYAN (ayrı iş)**

- **12 faturanın kayıtlı toplamları kendi içinde tutarsız.** Örnek SAT-2026-0165:
  `netAmount` 2250,93 · `vatAmount` **0** · `totalAmount` 2701,12 — yani toplam
  matrahın tam %20 fazlası ama KDV alanı sıfır (kalemde de `vatRate` 0). Sayfa
  kayıtlı değerleri doğru basıyor; sorun kayıtta. Ekrandaki etkisi: Matrah + KDV
  sütun toplamları Genel Toplam'ı tutmuyor (net ₺10,47 sapma).
- **Kalem toplamı ≠ fatura toplamı.** Detaylı Faturalar ₺838.280,69, Faturalar
  ₺827.341,90 (fark 10.938,79). Bunun 8.956,60'ı fatura seviyesindeki **genel
  iskonto** (kalem satırlarında görünmez), kalanı yukarıdaki tutarsız kayıtlar.
  `lib/raporlar/satis-alis.ts` içindeki "kalem sayfasının toplamı fatura
  sayfasınınkiyle tutmalı" yorumu bu yüzden bugün DOĞRU DEĞİL.
- **Sekme başlığı ilk yüklemede güncellenmiyor.** Adresi doğrudan açınca başlık
  "Kobipo — Az laf, doğru rakam." kalıyor; panel içi gezinmede doğru başlık
  geliyor. Uygulama genelinde böyle (`/raporlar/cari` de aynı), yeni sayfalara
  özgü değil — `page-titles.ts` kayıtları doğru ve testli.

**Kısmen test edilen**

- F1: kullanıcı Reypo'ya Mysoft şifresini girdikten sonra zincir gerçek API
  turuyla sınandı (aşağıdaki "canlı kimlikle ölçüm" bölümü). GERÇEK bir şube
  üzerinde ekran testi yapılamadı: giriş yapılan kullanıcının eriştiği firmalar
  arasında e-Dönüşümü açık şube yok, o yüzden devralma yolu şube BENZETİMİYLE
  ölçüldü. Diğer şubelerin şifreleri canlının `NEXTAUTH_SECRET`i ile şifreli
  olduğu için yerelde çözülemiyor.

---

## Kalan sorular ve bilinen sınırlar

Kod tarafında iş kalmadı; aşağıdakiler **karar** bekliyor.

1. **A3 — "Detaylı Faturalar" düzeni.** Şu an her satır bir fatura kalemi ve
   fatura kimliği her satırda tekrar ediyor (Excel'de süzülüp pivotlanabilsin
   diye). Müşteri görsel olarak "fatura başlığı + altında kalemler" (grup satırı)
   istiyorsa düzen değişir.
2. **F1 — şubede ana firmanın tasarımını düzenleme.** İstenirse kopya YENİ BİR
   ADLA üretilmeli: Mysoft yüklemesi `addTenantXslt` ile isim üzerinden ortak
   mükellefe yazdığı için aynı adla kaydetmek ana firmanın faturasının
   görüntüsünü sessizce değiştirir (ayrıntı yukarıda). Düz devralma yapılmadı.
3. **F1 — kimlik tazeliği.** Şube kurulduktan SONRA ana firma şifresini
   değiştirirse şubedeki kopya eski kalır (kendi kimliği "var" sayılır). Ana
   firmayı tek doğru kaynak yapmak (devralmayı koşulsuz hale getirmek) mümkün ama
   bugünkü davranışı değiştirir.
4. **Şablon uçlarında bayi yolu.** Üç şablon ucu hâlâ yalnız "manuel" kimlikle
   çalışıyor; self-servis (bayi) onboarding'den gelen ve kendi Mysoft kullanıcısı
   olmayan firmalar şablon yönetemez. Bu **eskiden de böyleydi**, F1 ile
   değişmedi. Düzeltmek için üç uç `resolveCompanyEInvoiceProvider`e taşınmalı.
5. **B2 — sütun adı.** Plan sayfalarındaki ilk para sütunu "Geçmiş Aylar" oldu
   (yaşlandırmadaki "Vadesi Geçmiş" bugüne, plan dilimleri vade tarihine göre
   ölçüldüğü için). Müşteri ısrar ederse tek kelimelik geri dönüş.

---

---

## 2026-09-01 · Revize maddeleri yeniden ölçüldü (A1–A4)

"11/11 kapandı" denmişti; müşteri mesajları canlı veriyle tekrar sınandığında
**beş kusur** çıktı. Dördü düzeltildi, biri müşteri kararına kaldı.

| # | Bulgu | Ölçüm | Durum |
|---|---|---|---|
| A | Dönem sınırı günün 00:00'ı olarak uygulanıyordu (`lte`), saatli faturalar son gün düşüyordu | Reypo Medya: son fatura 29.08 **16:14**, bitiş=29.08 seçilince **0 fatura**. 252 faturanın 62'si saatli | ✅ düzeltildi |
| B | Cari bölümü sessizce ilk 20'de kesiliyordu (ekran + Excel) | EREN FORKLİFT PNÖMATİK 83 müşteri → **20** satır; kart ise "tümü için başlığa tıklayın" diyor | ✅ düzeltildi |
| D | "Detaylı Faturalar" EKRANINDA Sınıflandırma 1/2, Belge, İskonto sütunları yoktu (Excel'de vardı) | Ekran 12 sütun, dosya 17 | ✅ düzeltildi |
| E | Excel "Durum" sütunu ham kod basıyordu | `DRAFT, SENT, GIB_DRAFT, CONVERTED, CANCELLED` | ✅ düzeltildi |
| F | Kalem toplamı ≠ fatura toplamı | Reypo Medya: 838.280,69 / 827.341,90 → fark 10.938,79 (8.956,60'ı fatura geneli iskonto) | ✅ **açıklanıyor** (düzen kararı hâlâ açık) |

**A · dönem sınırı.** `resolveReportDateFilter()` (`lib/raporlar/satis-alis-shared.ts`):
`YYYY-MM-DD` bitişi ERTESİ GÜNÜN başına (`lt`) çevrilir, gün ekseni UTC — aylık
kırılım da aynı eksende. Saat taşıyan değer olduğu gibi uygulanır. Testli
(ay sonu, yıl sonu, artık yıl, tek uçlu aralık).

**B · cari kesmesi.** `topCount` artık VARSAYILAN DEĞİL: verilmezse dönemin tüm
carileri döner. Özet ekran kendi listesini zaten 5'e kesiyor; alt sayfa ve Excel
tam liste alıyor. Yan etki: özet ekrandaki "Aktif Müşteri" sayacı da 20'de
takılıyordu, artık gerçek adedi gösteriyor (83).

**D/E · ekran–dosya eşitliği.** Kalem tablosuna Sınıflandırma 1/2 + Belge +
İskonto, fatura tablosuna Durum sütunu eklendi. Durum etiketi tek kaynaktan:
`lib/invoice/status-label.ts` (`GIB_DRAFT` → "GİB Taslağı", alışta `DRAFT` →
"Kayıtlı"; ekrandaki rozetle aynı kural). Ölçüldü: satışta
`Taslak, Gönderildi, GİB Taslağı, Dönüştürüldü, İptal`, alışta `Kayıtlı, Gönderildi`.

**F · fark artık söyleniyor.** `describeLineTotalGap()` farkı bileşenlerine ayırıp
tek cümle üretir; **ekranda** Detaylı Faturalar sayfasının üstünde sarı uyarı,
**dosyada** "Rapor Bilgisi" sayfasındaki `Not` satırı (PDF'te sayfa altı) olarak
basılır. Fark kuruş altındaysa hiçbir şey yazılmaz. Örnek çıktı:

> Kalem toplamı ₺838.280,69, Faturalar sayfasının toplamı ₺827.341,90 — fark
> ₺10.938,79. Bunun ₺8.956,60 kadarı fatura geneline uygulanan iskontodur; kalem
> satırlarına dağıtılmaz. Kalan ₺1.982,19 ise kayıtlı toplamı kalemleriyle
> uyuşmayan belgelerden gelir.

**Hâlâ açık (müşteri kararı):** A3 düzeni — müşteri "her faturanın ALTINA
kalemler" (fatura başlığı + alt satırlar) istiyor; bizde düz liste, fatura kimliği
her satırda tekrar ediyor (Excel'de süzme/pivot için). Bu, yukarıdaki "Kalan
sorular" bölümünün 1. maddesidir ve kapanmadı.

**Aynı turda düzeltilen ayrı iki şey:** bölüm alt sayfasındaki "Dışa Aktar"
raporun tamamını indiriyordu → artık yalnız o bölümü (`section` parametresi,
dosya adı da bölümü söylüyor); rapor bölümleri özet ekranda kutu şeridi olarak
sayfanın üstüne alındı.

`npx tsc --noEmit` temiz · `npx vitest run` **671 test** geçti · `npx next build`
temiz.

---

## 2026-09-01 · İkinci tur (B1, C1, B2, D1, E1, D2) yeniden ölçüldü

Beş madde ölçümde temiz çıktı, **ikisinde eksik vardı**; ikisi de düzeltildi.

**Temiz çıkanlar (ölçümle):** tanım düzenleme (rename + pasif/aktif + 400/409/403
denetimleri) · yaşlandırma ekranında ve Excel'inde tanım sütunları (ekranda tek
tablo iki sekmeyi besliyor) · yaşlandırma Excel'inde ödeme planı (dört firmada da
`Alacaklar | Borçlar | Tahsilat Planı | Ödeme Planı`, **toplamı tutmayan satır 0**)
· stok hareketleri ayrı sayfası ve süzgeçleri (346 satır → müşteri süzgeciyle 45;
kesilme yok) · ürün detayında faturaya link (310/346, 100/104 …).

**Eksik 1 — arama listesi düzeltmesi beş ekranda yoktu.** ProductCombobox'ın İKİ
kopyası var: `components/e-donusum/product-combobox.tsx` (fatura + hızlı satış/alış,
düzeltilmişti) ve `components/ui/product-combobox.tsx` (irsaliye ×2, sipariş ×2,
teklif) — ikincisi hâlâ `absolute … w-full max-h-56` idi, yani girdi kadar dar ve
kırpılabilir. Devir notu "irsaliye, sipariş, teklif de düzeltildi" diyordu; doğru
değildi.

- Konumlandırma tek yere alındı: saf hesap `lib/ui/anchored-menu.ts`
  (`computeAnchoredRect`, **6 test**: dar girdide 360px tabana çıkma, sağ kenardan
  içeri çekme, yer yoksa yukarı açılma, dar pencere, sığ alan), React tarafı
  `components/ui/use-anchored-menu.ts` (portal konumu + dışarı tıklama).
- İki combobox da bu ortak mantığı kullanıyor; kopya bitti.

**Eksik 2 — irsaliye kaynaklı stok hareketi ürün kartında kimliksizdi.** Referans
hücresi düz "İrsaliye" yazıyordu (numara yok, bağlantı yok); oysa stok hareket
raporu aynı hareketi `waybillNo` ile çözüyordu.

- `app/api/stok/products/[id]/route.ts` artık `waybill:<id>` referanslarını da
  çözüyor (`waybill: { id, no, type }`).
- Ürün kartı "İrsaliye AIR-2026-000002" yazıp ilgili listeye bağlanıyor. İrsaliyenin
  detay sayfası olmadığı için bağlantı listeyi `?ara=<numara>` ile **süzülü** açar;
  iki irsaliye sayfası da arama kutusunu bu paramla dolduruyor.
- Ölçüm: iki referansın ikisi de çözüldü (AIR-2026-000002, AIR-2026-000003; PURCHASE
  → alış irsaliyesi listesi).
- Çözülemeyen referanslar araştırıldı: hepsi **silinmiş fatura** (hareket duruyor,
  fatura yok; ör. `SAT-2026-0004` iptal çifti). Bunlarda hücre "—" kalıyor, belge
  numarası Açıklama sütununda görünüyor.

**Kusur değil, veri notu:** tanım sütunları çoğu firmada boş — Reypo Medya 0/8,
EREN FORKLİFT PNÖMATİK 0/24, EREN VİNÇ 0/17, EREN FORKLİFT 27/30. Cari kartlarında
tanım girilmedikçe rapor "—" gösterir; toplu atama ekranı yok. Benzer şekilde
e-Belge no'su olmayan faturada iç fatura numarası yazılır (65/266, 37/55, 42/47).

`npx tsc --noEmit` temiz · `npx vitest run` **677 test** · `npx next build` temiz.

## Dokunulan dosyalar

**Yeni:** `app/api/raporlar/satis-alis/route.ts`,
`app/api/raporlar/stok-hareket/route.ts`,
`app/(dashboard)/raporlar/stok/hareketler/page.tsx`,
`app/(dashboard)/raporlar/{satis,alis}/[bolum]/page.tsx`,
`components/raporlar/{satis-alis-report,satis-alis-section}.tsx`,
`lib/raporlar/stok-hareket.ts`, `lib/raporlar/satis-alis-sections.ts`,
`lib/stock/movement-sign.ts`,
`lib/integrations/e-invoice/credentials.ts`

Testler: `lib/raporlar/cari-yaslandirma.test.ts`,
`lib/raporlar/satis-alis-sections.test.ts`,
`lib/integrations/e-invoice/credentials.test.ts`

**Değişen:** `app/(dashboard)/ayarlar/tanimlar/page.tsx`,
`app/(dashboard)/raporlar/{satis,alis,stok,cari-yaslandirma}/page.tsx`,
`app/(dashboard)/stok/[id]/page.tsx`,
`app/api/company/definitions/[id]/route.ts`, `app/api/stok/products/[id]/route.ts`,
`app/api/e-donusum/templates/route.ts`,
`app/api/e-donusum/templates/preview/route.ts`,
`app/api/e-donusum/templates/designs/preview/route.ts`,
`components/e-donusum/product-combobox.tsx`,
`components/{alis/quick-purchase-screen,satis/quick-sale-screen}.tsx`,
`lib/dashboard/page-titles.ts`, `lib/export/datasets/{index,reports,reports-satis-alis}.ts`,
`lib/integrations/e-invoice/company-provider.ts`,
`lib/raporlar/{satis-alis,cari-yaslandirma}.ts`, `lib/swr/use-company-data.ts`
