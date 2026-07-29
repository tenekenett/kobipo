# Restoran & Kafe — Faz 2: Sadeleştirme ve maliyet birleştirme

> v1 karar kaydı: [PLAN.md](./PLAN.md) · günlük ilerleme: [ilerleme.md](./ilerleme.md)
> Bu belge v1 sonrası yapılan **kod taramasının bulgularını** ve düzeltme planını tutar.

## Neden

v1 uçtan uca çalışıyor ama iki tür karışıklık birikti:

1. **Kodda:** "bu hammaddenin maliyeti ne?" sorusuna dört ayrı cevap var ve ikisi aynı
   girdileri ters öncelikle kullanıyor. Reçete ekranındaki marj ile karlılık raporundaki
   marj, alış fiyatı dalgalandığı anda ayrışır.
2. **Kullanımda:** kurulum (Reçeteler) Stok grubunda, kullanım (Satış) Restoran grubunda.
   Restoran grubunun 5 öğesinin 4'ü rapor. Kafeci iki menü grubu arasında gidip geliyor.

## Alınan kararlar

| Konu | Karar |
|---|---|
| Maliyet tabanı | **AVCO** (ağırlıklı ortalama alış); yoksa elle girilen `purchasePrice` |
| Menü düzeni | Reçete **Restoran grubuna taşınır**, dört rapor **tek sekmeli sayfada** birleşir |
| Modül kapısının sunucu tarafı | **Bu fazda yapılmayacak** — ayrı iş (aşağıda "Kapsam dışı") |

AVCO seçildi çünkü zaten hesaplanıyor (`app/api/stok/products/route.ts`) ve reçete ekranı
onu kullanıyor — yani karar kağıt üstünde "kapsam dışı" sayılmışken kodda yarısı zaten
uygulanmış durumda. Tek yapılması gereken kalan üç yeri de aynı tanıma bağlamak.

---

## İş 1 — Gün sonu ödeme dağılımı alış ödemelerini sayıyor (hata)

`app/api/restoran/raporlar/gun-sonu/route.ts:74-86` ödeme sorgusu:

```sql
FROM invoice_payments p
JOIN invoices i ON i.id = p."invoiceId"
WHERE p."companyId" = ... AND p."paymentDate" BETWEEN ... AND i.status <> 'CANCELLED'
```

`i.type = 'SALES'` filtresi yok. `InvoicePayment` alış faturalarında da kullanılıyor
(`app/api/faturalar/odemeler/route.ts:176` — satışta `+amount`, alışta `-amount`), bu yüzden
**tedarikçiye yapılan ödeme gün sonu raporunda kasaya giren para olarak görünüyor** ve kasa
sayımı karşılaştırmasını bozuyor.

`CONVERTED` de dışlanmamış; `reportScope` dışlıyor. Fiş faturaya dönüştüğünde ödeme iki kez
sayılabilir.

**Düzeltme:** sorguya `AND i.type = 'SALES'` ve `AND i.status NOT IN ('CANCELLED','CONVERTED')`.

Riski sıfır, tek sorgu. İlk bu yapılır.

---

## İş 2 — Tek maliyet kapısı (AVCO)

### Bugünkü dağınıklık

| Yer | Öncelik |
|---|---|
| Reçete ekranı `stok/receteler/page.tsx:218` | `avgPurchasePrice` → `purchasePrice` |
| Satışta dondurma `lib/stock/recipe.ts:85` | `purchasePrice` → **son** alış hareketi |
| Karlılık `lib/restoran/reports.ts:116` | `COALESCE(purchasePrice, 0)` — fallback **yok** |
| Menü performansı `menu-performans/route.ts:81,116` | gerçekleşen ağırlıklı → yukarıdaki satır |

İlk ikisi aynı iki girdiyi ters sırayla kullanıyor. Üçüncüsü alış fiyatı boş ürünü
**maliyetsiz** sayıyor → marj %100 çıkıyor, aynı ürün menü performansında maliyetli görünüyor.

### Yeni dosya: `lib/stock/cost.ts`

AVCO'nun **tek tanımı** burada durur:

```ts
/** AVCO: Σ(|miktar| × birim fiyat) / Σ|miktar| — yalnız fiyatı kayıtlı alış hareketleri. */
export function avgCostCte(companyId: string): Prisma.Sql   // raporların JOIN'leyeceği CTE
export async function resolveUnitCosts(                      // TS tarafının çağıracağı hâli
  companyId: string,
  productIds: string[],
): Promise<Map<string, number | null>>
```

İkisi de **aynı** kuralı uygular: `stock_movements` içinde `type IN ('IN','PURCHASE')` ve
`unitPrice IS NOT NULL` olanların miktarla ağırlıklı ortalaması; hiç hareketi yoksa
`Product.purchasePrice`; o da yoksa `null` (= "maliyet bilinmiyor", 0 DEĞİL).

`null` ile `0` ayrımı önemli: bugün karlılıkta `COALESCE(...,0)` yüzünden maliyeti bilinmeyen
ürün bedava görünüyor. Yeni kapı bunu `null` döndürüp raporlara "kaç üründe maliyet eksik"
saydırır.

### Bağlanacak çağrı yerleri

| Dosya | Değişiklik |
|---|---|
| `lib/stock/recipe.ts:85` `resolveComponentCosts` | Gövdesi silinir, `resolveUnitCosts`'a delege eder (isim korunur — satış yolu ve menü performansı çağırıyor) |
| `app/api/stok/products/route.ts:64-103` | Bellekteki tarama **SQL GROUP BY**'a çevrilir → `avgPurchasePrice` aynı tanımdan gelir *(bkz. İş 6)* |
| `lib/restoran/reports.ts:116` `docCostCte` | `direct_cost` artık `p."purchasePrice"` yerine AVCO CTE'sine JOIN olur |
| `app/api/restoran/raporlar/karlilik/route.ts` | Yanıta `pricelessCount` eklenir; ekranda "N üründe alış fiyatı yok, maliyet eksik" uyarısı |
| `app/(dashboard)/stok/receteler/page.tsx:218` | İki kademeli fallback sadeleşir — API zaten `purchasePrice`'a düşüyor |

**Dondurma davranışı değişmiyor.** Satış anında hesaplanan maliyet yine
`StockMovement.unitPrice`'a yazılır ve geçmiş karlılık sonradan gelen zamdan etkilenmez
(PLAN.md "Adım 6"). Değişen tek şey o anda **hangi sayının** donduğu.

### Bilinen sınır (bu fazda çözülmüyor)

İptal edilen bir **alış** faturasının giriş hareketi `stock_movements`'ta kalıyor (ters hareket
`unitPrice` olmadan yazılıyor), dolayısıyla AVCO iptal edilmiş alışı da sayıyor. Bugünkü
davranış da bu — yeni kapı durumu kötüleştirmiyor. Doğru çözüm ters hareketlere de fiyat
yazmak; stok modülünün tamamını ilgilendirdiği için ayrı iş.

---

## İş 3 — Menü ve ekran sadeleştirmesi

### Hedef

```
BUGÜN                                    SONRA
Stok ▸ Reçeteler                         Restoran & Kafe ▸ Kahveci Satış
Restoran & Kafe ▸ Kahveci Satış                          ▸ Menü & Reçeteler
                ▸ Karlılık                               ▸ Raporlar
                ▸ Menü Performansı
                ▸ Hammadde Tüketimi          (6 öğe / 2 grup  →  3 öğe / 1 grup)
                ▸ Gün Sonu
```

### 3.1 Reçete ekranı taşınır

- Sayfa `/restoran/menu` adresine taşınır, etiket **"Menü & Reçeteler"**.
- `/stok/receteler` **yönlendirme** olarak kalır (yer imi ve paylaşılmış linkler kırılmasın).
- `nav-config.tsx`: `NAV_ITEMS`'tan Stok grubundaki satır kalkar, Restoran grubuna eklenir;
  `NAV_GROUPS.hrefs` güncellenir; `PATH_MODULE_OVERRIDES`'a `/restoran/menu` girer
  (`/stok/receteler` de kalır — yönlendirme öncesi URL de kilitli olsun).
- `lib/dashboard/page-titles.ts` güncellenir.

Not: PLAN.md "Adım 1"deki *"reçete stok kavramıdır, kod ve URL olarak Stok'ta dursun"*
gerekçesi **kod için hâlâ geçerli** — `lib/stock/recipe*.ts` yerinde kalır. Taşınan yalnızca
ekranın adresi ve menüdeki yeri.

### 3.2 Dört rapor tek sayfada birleşir

- Yeni sayfa `/restoran/raporlar`, sekme seçimi `?rapor=karlilik|menu|tuketim|gun-sonu`
  (URL'de durur → paylaşılabilir, geri tuşu çalışır).
- Dört sayfanın gövdesi `components/restoran/reports/*.tsx` altına bileşen olarak çıkar;
  eski dört adres yönlendirme olur.
- **Kazanç:** tarih aralığı sekmeler arasında korunur. Bugün "bu ay"ı seçip menü
  performansından karlılığa geçince aralık sıfırlanıyor; tek sayfada `useReportRange` bir kez
  yaşar.
- **Dikkat:** gün sonu tek gün ekseninde çalışıyor (`shiftDay`/`setDay`). Sekmeye geçilince
  aralığın **son günü** alınır; sekmeden çıkınca önceki aralık geri gelir.

### 3.3 Satış ekranından kuruluma köprü

Kahveci ekranı "Menüde ürün yok" derken bugün kullanıcıya iki ayrı yer tarif ediyor
(`cafe-sale-screen.tsx:606-610`). Metin sadeleşir ve **"Menü & Reçeteler"e doğrudan link**
verir. Kurulum tek yerden yapılabildiği için tarif de tek cümleye iner.

---

## İş 4 — Reçete ekranı SWR katmanına alınır

`app/(dashboard)/stok/receteler/page.tsx:199-200` elle `useState` + `fetch` kullanıyor; kahveci
ekranı ise `lib/swr/use-company-data.ts` hook'larını. Aynı modülde iki desen.

Pratik sonucu: reçete kaydedildikten sonra SWR önbelleği invalide edilmiyor — satış ekranı
odak değişene kadar **eski reçeteyi** tutuyor.

- `useProducts` + `useRecipes` hook'larına geçilir.
- Kaydet/sil sonrası `mutate()` çağrılır → kahveci ekranı anında güncel.
- Yerel `money` / `qty` / `num` yardımcıları kalkar. Ortak formatlayıcılar
  `components/restoran/report-ui.tsx`'ten çıkarılıp **`lib/format.ts`**'e taşınır; üç dosya
  (rapor UI, kahveci ekranı, reçete ekranı) oradan alır. `lib/fis/receipt-html.ts`'teki
  `currency` de aynı tanıma bağlanır.

Hafızadaki "SWR referans-veri katmanını kalan ekranlara yay" planının atlanmış adımı budur.

---

## İş 5 — Çift satış koruması

`components/restoran/cafe-sale-screen.tsx:337` koruması `isSubmitting` **state**'i. F2 basılı
tutulduğunda ya da çift tıklamada aynı render içinde iki çağrı da geçebilir → iki fiş, iki
stok düşümü, iki tahsilat.

**Düzeltme:** `useRef` tabanlı guard (senkron okunur/yazılır). Ayrıca F2 dinleyicisi diyalog
açıkken ve odak bir `input`/`textarea` içindeyken çalışmaz.

---

## İş 6 — `/api/stok/products` sınırsız tarama

`app/api/stok/products/route.ts:71-79` her çağrıda firmanın **tüm** giriş hareketlerini belleğe
çekip AVCO'yu JS'te hesaplıyor. Kahveci ekranı bu ucu sürekli çağırıyor ve hareket tablosu her
satışla büyüyor.

İş 2'nin doğal sonucu olarak kapanır: aynı hesap tek `GROUP BY` sorgusuna iner, satırlar
uygulamaya hiç gelmez.

---

## Kapsam dışı

- **Modül kapısının sunucu tarafı.** Kod tabanında `ensureModule` benzeri hiçbir sunucu
  kontrolü yok; `ModuleGuard` ve nav gizleme tamamen istemci tarafında. `restaurant` kapalı bir
  firmanın kullanıcısı `/api/restoran/*` uçlarını çağırabilir. Ücretli özellik bypass'ı —
  ama tüm modül sistemini ilgilendiren ayrı bir iş, bu fazda yapılmayacak.
- **ÖKC / yazarkasa konumlandırması** (PLAN.md "Açık riskler" 1) — ticari karar, hâlâ açık.
- **Masa/adisyon, modifier sistemi** — Aşama 2 (PLAN.md "Adım 7").

---

## Doğrulama senaryoları

Demo Firma A.Ş. üzerinde, PLAN.md "Doğrulama senaryoları" kurulumuyla:

| # | Senaryo | Beklenen |
|---|---|---|
| 1 | Reçete ekranındaki Latte maliyeti ile 1 Latte satışında donan maliyet | **Birebir aynı** (ikisi de AVCO) |
| 2 | Karlılık ve menü performansı aynı aralıkta | Toplam maliyet aynı; sapma yalnız aralıkta reçete değiştiyse |
| 3 | Alış fiyatı **girilmemiş**, alış hareketi olan ürün sat | Her iki rapor da AVCO'yu kullanır; marj %100 **çıkmaz** |
| 4 | Alış fiyatı da hareketi de olmayan ürün sat | Maliyet 0 değil "bilinmiyor"; ekranda eksik maliyet uyarısı |
| 5 | Tedarikçiye nakit ödeme yap, gün sonuna bak | Ödeme dağılımında **görünmez** (bugün görünüyor) |
| 6 | Reçeteyi düzenle, satış ekranına geç | Yeni reçete **anında** yansır (bugün odak değişimini bekliyor) |
| 7 | F2'yi basılı tut / Tamamla'ya çift tıkla | **Tek** fiş oluşur |
| 8 | `/stok/receteler` ve eski dört rapor adresine git | Yeni adreslere yönlenir |
| 9 | Raporlarda "bu ay" seç, sekmeler arasında gez | Aralık korunur |
| 10 | **Regresyon:** reçetesiz ürünle Hızlı Satış'tan fiş kes | v1 davranışı birebir korunur |

Ek olarak mevcut betikler koşulur: `test-recipe-expand.mjs`, `test-module-gating.mjs`,
`test-payment.mjs`.

---

## Sıra

1. **İş 1** — gün sonu filtresi (tek sorgu, riski sıfır, hemen kapanır)
2. **İş 2 + İş 6** — maliyet kapısı ve çağrı yerleri (çekirdek; ikisi aynı değişiklik)
3. **İş 4** — SWR + ortak formatlayıcılar
4. **İş 5** — çift satış guard'ı
5. **İş 3** — menü/adres taşıma (en çok dosyaya dokunan; adresler değişince test yolları da
   değiştiği için en sona bırakıldı)

---

## Uygulandı — 2026-07-27 ✅

Altı işin tamamı yapıldı. `tsc --noEmit` ve `eslint` temiz.

### Değişen dosyalar

| Yeni | Ne |
|---|---|
| `lib/stock/cost.ts` | AVCO'nun tek tanımı — `avgCostCte` (raw sorgular) + `resolveUnitCosts` / `resolveAllUnitCosts` (TS) |
| `lib/format.ts` | `money` / `money0` / `qty` / `pct` / `parseNum` — dört dosyadaki kopyaların yerine |
| `app/(dashboard)/restoran/raporlar/page.tsx` | Sekmeli rapor sayfası |
| `components/restoran/reports/*.tsx` | Dört rapor, sayfa değil bileşen |

`lib/stock/recipe.ts` → `resolveComponentCosts` **silindi**; çağıranlar (`invoices/route.ts`,
`menu-performans/route.ts`) `resolveUnitCosts`'a bağlandı. `docCostCte` artık `companyId` alan bir
fonksiyon ve ihtiyacı olan `avg_cost` CTE'sini kendisi getiriyor — çağıranın sırayı doğru dizmesi
gerekmiyor.

Reçete ekranı (`/restoran/menu`) SWR'ye alındı ve `companyId`'yi artık `?company=` yerine
`useDashboardCompany()`'den okuyor: sağlayıcı slug'ı cuid'e normalize ediyor, URL etmiyor — ikisi
farklı SWR anahtarı üretiyordu ve satış ekranıyla ortak önbellek hiç çalışmıyordu.

### Doğrulama — Demo Firma A.Ş., gerçek DB ve gerçek HTTP uçları

Giriş `demo@muhasebe.com` ile yapıldı. reCAPTCHA'yı atlamak için **geçici** bir
`.env.development.local` (`.env.local`'den önceliklidir) kullanıldı; test sonunda **silindi**,
kullanıcının env dosyalarına dokunulmadı, kodda değişiklik yok.

| Kontrol | Sonuç |
|---|---|
| **Karlılık ↔ Menü performansı** | ✅ `855 / 551 / 304 · %35,56` — **birebir aynı** (düzeltmeden önce ayrı taban kullanıyorlardı) |
| Menü kalemleri | ✅ Latte 3 adet · maliyet `51` (`recipe`) · Kahve Çekirdeği 1 · `500` (`purchase`) |
| Tüketim | ✅ kahve `0,06 KG/₺30` · süt `0,6 LT/₺18` · vanilya `0,015 LT/₺3` = `₺51` · %58,8 / %35,3 / %5,9 |
| Gün sonu | ✅ 2 fiş · tahsil `1026` · açık `0` · nakit `1026` |
| Ürün ucu (AVCO) | ✅ kahve `500` · süt `30` · vanilya `200`; Espresso/Latte `null` (reçeteli — maliyet bileşenden) |
| `pricelessCount` | ✅ Demo'da `0`; **ÜNAL ARAS ve HİDROEREN'de `1`** — o firmalardaki %100 marj gerçek değil, maliyet eksikliğiymiş |
| Sayfalar | ✅ `/restoran/raporlar`, `?rapor=gun-sonu`, `/restoran/menu`, `/restoran/satis` → 200 |
| Eski adresler | ✅ `NEXT_REDIRECT;replace;/restoran/raporlar?rapor=karlilik;307` — sekme parametresi korunuyor; `/stok/receteler` → `/restoran/menu` |
| Betikler | ✅ `test-recipe-expand` 37/37 · `test-module-gating` 20/20 · `test-payment` 25/25 |

Gün sonu ödeme filtresi (İş 1) **latent** bir düzeltme: SQL karşılaştırması tüm firmalarda
`eski == yeni` verdi, yani bugün hiçbir firmanın alış faturasına bağlı ödemesi yok. Filtre doğru
kurulmuş durumda; ilk alış ödemesi girildiğinde etkisini gösterecek.

### Elle bakılmayan tek şey

Sekmeli sayfanın **görüntüsü** (sekme geçişleri, aralığın sekmeler arası korunması) tarayıcıda
gözle doğrulanmadı — tarayıcı eklentisi bağlı değildi. Veri yolu, adresler ve hesapların tamamı
yukarıda doğrulandı.

---

## İş 7 — Menü kurulumu ekrandan yapılır (2026-07-27) ✅

### Sorun

Menü kalemi, kullanıcı için "reçeteyle tanımlanan bir şey". Kodda ise **önce** Stok
ekranından bir `Product` açmak, **sonra** Menü & Reçeteler'e gidip ona reçete bağlamak
gerekiyordu. "Yeni Reçete" diyaloğu var olan bir ürün seçtiriyordu (`SearchSelect`) —
akış tersten çalışıyordu.

Kavramsal ayrım (Menü Ürünleri / Hammaddeler sekmeleri) ekranda ZATEN vardı; eksik olan
**oluşturma**: iki sekme de yalnızca mevcut ürünleri yeniden sınıflandırabiliyordu.

### Karar

| Konu | Karar |
|---|---|
| Menü ürünü nasıl doğar | Menü ekranındaki tek diyalogda: **ürün + reçete birlikte** |
| Reçete zorunlu mu | **Hayır.** Şişe su / kutu kola menüde durur, satışta kendisi düşer |
| "Menüde göster" kutusu | Stok formunda kalır ama **Restoran & Kafe açıkken** menü diline geçer |
| `/stok` ürün listesi | Restoran açıkken **varsayılan Hammaddeler**; filtreyle menü ürünleri/tümü |

Reçeteyi zorunlu kılmamanın gerekçesi: şişe su için "menüdeki su + stoktaki su bileşeni"
diye iki kayıt gerekirdi — PLAN.md "Adım 2"nin kaçınmak için tasarlandığı çift kayıt tam
olarak budur.

### Değişenler

| Dosya | Ne |
|---|---|
| `lib/stock/quick-create-product.ts` | `category` / `isSellable` / `minStockLevel` / açılış stoğu / KDV-dahil bayrakları taşır |
| `lib/swr/use-module.ts` | **yeni** — `useModuleEnabled("restaurant")`; yalnız ARAYÜZ uyarlaması, yetki değil |
| `components/restoran/raw-material-dialog.tsx` | **yeni** — hammadde oluşturma (ad, birim, alış, kritik seviye, açılış stoğu) |
| `app/(dashboard)/restoran/menu/page.tsx` | Diyalog "Yeni ürün oluştur / Mevcut üründen seç" modlu; reçete opsiyonel; canlı marj; satır içi "Yeni Hammadde" |
| `app/(dashboard)/stok/page.tsx` | Kutu modüle duyarlı; "Hammaddeler / Menü ürünleri / Tümü" filtresi (restoran açıkken varsayılan Hammaddeler) |
| `components/stok/product-edit-dialog.tsx` | Aynı modüle duyarlı etiket |

Yeni ürünün henüz id'si olmadığı için maliyet önizlemesi reçete ağacına onu geçici bir
anahtarla (`NEW_PRODUCT_KEY`) koyar; döngü kontrolü yeni üründe atlanır (hiçbir reçete
ona referans veremez). Marj önizlemesi KDV dahil girilen fiyatı net'e çevirerek hesaplar —
maliyet de net, aksi halde marj olduğundan düşük görünürdü.

### Doğrulama — Demo Firma, gerçek uçlar

Diyaloğun yaptığı çağrılar birebir taklit edildi:

| Kontrol | Sonuç |
|---|---|
| Hammadde oluşturma | ✅ `isSellable=false` · LT · alış 150 · açılış stoğu 5 · kritik 1 |
| Menü ürünü oluşturma | ✅ `isSellable=true` · kategori dolu · **90 ₺ KDV dahil → net 75** |
| Reçete bağlama | ✅ Mocha = 1 Espresso + 200 ML süt + 30 ML sos |
| Çok seviyeli maliyet | ✅ Espresso hammaddeye açıldı: `20GR×500 + 200ML×30 + 30ML×150 = ₺20,50` · marj **%72,7** |
| Menü/hammadde ayrımı | ✅ menüde Latte + Mocha; hammaddede Espresso, kahve, süt, vanilya, sos |
| Türkçe karakter | ✅ UTF-8 gövdeyle `"Çikolatalı Şerbet"` / `"Sıcak İçecek"` tam doğru |
| Temizlik sonrası raporlar | ✅ `855 / 551 / 304` — bozulma yok |

> Not: ilk denemede Türkçe karakterler bozuk göründü; sebep bash/curl'ün Windows'ta satır
> içi `-d` gövdesini mangle etmesiydi (**test harness'ı**, uygulama değil). UTF-8 dosya
> gövdesiyle tekrarlandığında API tamamen doğru sakladı. Test ürünleri sonradan silindi;
> Demo Firma açılış durumunda.

### Elle bakılmayan

Diyaloğun görüntüsü (mod düğmeleri, reçete anahtarının bölümü gizlemesi, satır içi hammadde
ekleme) tarayıcıda gözle doğrulanmadı — tarayıcı eklentisi bağlı değil. Veri yolu ve
hesaplar yukarıda doğrulandı.

---

## İş 8 — Hizmet ayrı eksene çıktı, hammadde gerçek bayrak oldu (2026-07-27) ✅

### Sorun

Ürün formunda **`Hizmet`** ve **`Menüde göster`** yan yana iki eş kutuydu. İkisi aynı türden
seçimmiş gibi okunuyordu, oysa:

- Hizmetin stoğu yoktur, reçetede kullanılmaz ve **her iki satış ekranı da hizmetleri baştan
  dışlar** (`useProducts(companyId, { isService: false })`). Yani hizmette "Menüde göster"
  işaretlemek **ölü durumdu** — hiçbir şey yapmıyordu.
- "Hammadde" diye bir alan yoktu; UI `!isSellable`'ı hammadde sayıyordu. Bu yüzden paket
  olarak da satılan kahve çekirdeği ya menüde ya hammadde olabiliyordu, ikisi birden değil.

### Karar

Hammadde **gerçek bir bayrak** oldu (`Product.isIngredient`), `isSellable` ile birbirini
DIŞLAMAZ. Kullanıcı kararı; tercih edilen alternatif (reçete kullanımından türetme)
reddedildi.

**Bayrak yalnızca SUNUM/FİLTRELEME belirler, davranışı değil.** Reçete motoru bileşenleri
hâlâ `ProductRecipeItem`'dan okur — işaret konmamış bir ürün de reçetede kullanılabilir.
Böylece bayrak gerçekle çelişse bile stok/maliyet sessizce bozulmaz; ürün yalnızca yanlış
sekmede görünür. (Bu, kararın kabul edilen riskine karşı alınan önlem.)

### Form artık iki ayrı başlık

```
TÜR
  [ ] Hizmet (stok takibi yapılmaz)

NEREDE KULLANILIR          ← yalnız hizmet DEĞİLKEN görünür
  [x] Menüde göster   [x] Hammadde
  <dört duruma göre açıklama: lib/stock/usage-label.ts>
```

Hizmet işaretlenince menü/hammadde seçimleri temizlenir ve bölüm gizlenir — ölü durum kalmaz.

### Değişenler

| Dosya | Ne |
|---|---|
| `prisma/schema.prisma` | `Product.isIngredient Boolean @default(false)` |
| `scripts/add-is-ingredient.js` | **yeni** — eklemeli ALTER + geriye dönük doldurma; argümansız kuru çalışır |
| `lib/stock/usage-label.ts` | **yeni** — dört durumun metni tek yerde |
| `app/api/stok/products/route.ts` + `[id]/route.ts` | POST/PUT/PATCH alanı taşır, GET `?isIngredient=` süzer |
| `app/(dashboard)/stok/page.tsx` · `components/stok/product-edit-dialog.tsx` | İki başlıklı düzen; filtre "Hammaddeler / Menüde görünenler / Tümü" |
| `app/(dashboard)/restoran/menu/page.tsx` | Sekmeler ayrı bayraklara bakar; her satırda **iki** anahtar (Ham. / Menü) |
| `components/restoran/raw-material-dialog.tsx` | `isIngredient: true` ile oluşturur |

`prisma db push` KULLANILMADI: veritabanında gerçek müşteri firmaları var. Bunun yerine
hedefli `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `UPDATE` — tamamen eklemeli ve idempotent.

**Doldurma:** `isIngredient = true`, ürün bir reçetede bileşense **veya** `isSellable=false`
ise. 181 üründen 4'ü etkilendi; kalan 177 üründe hiçbir değişiklik olmadı.

### Doğrulama — Demo Firma, gerçek uçlar

| Kontrol | Sonuç |
|---|---|
| Doldurma | ✅ Espresso / Kahve Çekirdeği / Süt / Vanilya → hammadde; Latte → menü |
| `?isIngredient=true` | ✅ 4 hammadde |
| `?isSellable=true` | ✅ yalnız Latte |
| **Asıl senaryo: ikisi birden** | ✅ Kahve Çekirdeği'ne "Menüde göster" açıldı → **her iki listede de** çıktı (tek kart, tek stok) |
| Reçeteler | ✅ Espresso ve Latte bozulmadı |
| Raporlar | ✅ `855 / 551 / 304` · tüketim `0,06 KG / 0,6 LT / 0,015 LT` |

Test sonrası Kahve Çekirdeği eski durumuna döndürüldü; Demo Firma açılış durumunda.

> Uyarı: bu turda `perl -0pi` ile yapılan bir düzenleme `app/api/stok/products/route.ts`
> içindeki **mevcut** Türkçe karakterleri bozdu (çift kodlama). Dosya `git checkout` ile geri
> alınıp değişiklikler doğru araçla yeniden uygulandı; tüm değişmiş dosyalar tarandı, başka
> hasar yok. **UTF-8 dosyalarda perl in-place kullanılmamalı.**

---

## İş 9 — UI sadeleştirmesi: kontrol azaltma (2026-07-27) ✅

### Neden

Kullanıcı geri bildirimi: *"çok fazla parametre var ve benzer şeyler; altyapı sağlam
çalışsa da UI çok karışık."* Haklıydı — İş 7 ve 8 her sorunu çözerken UI'a kontrol
ekledi. Bu iş **ekleme değil çıkarma** işi.

### Ölçüm — sorun somut

Üç boolean (`isService` / `isSellable` / `isIngredient`) üç ayrı onay kutusu olarak
soruluyordu. Gerçek veride:

```
 157 ürün → Menü ürünü
  21 ürün → Hizmet          ← ve 21'inde de "Menüde göster" İŞARETLİYDİ (ölü durum)
   5 ürün → Hammadde
   1 ürün → Hem satılan hem bileşen

8 teorik kombinasyon · gerçekte kullanılan 4 · anlamlı olan 4
```

Yani üç kutu tek bir **4 seçenekli soruyu** soruyordu. Üstelik üçü birden kapalıyken
ürün hiçbir listede görünmüyordu ve uyarı yoktu.

`/stok`'ta ayrıca **iki örtüşen filtre** vardı (`Tümü/Ürünler/Hizmetler` ve
`Hammaddeler/Menüde görünenler/Tümü`) — "hizmet" ikisinde birden geçiyordu.

### Yapılanlar

**Kavram tek yere indi:** `lib/stock/product-kind.ts` — `ProductKind`
(`menu` / `ingredient` / `both` / `service`), `productKindOf()`, `flagsForKind()`,
`productKindOptions(isRestaurant)`, `matchesKindFilter()`. Şema DEĞİŞMEDİ; yalnızca
ulaşılabilir durumlar kısıtlandı ve isimler tek yerden geliyor.

| Kaldırılan / birleştirilen | Yerine |
|---|---|
| Ürün formunda 3 onay kutusu | **1 seçim**, 4 isimli seçenek (restoran kapalıysa 3) |
| Düzenleme diyaloğunda 3 kutu | Aynı seçim, **birebir aynı isimler** |
| `/stok`'ta 2 örtüşen filtre | **1 tür filtresi**, form seçenekleriyle aynı isimler |
| Menü ekranında satır başına 2 anahtar | **1 tür seçici** (`KindSelect`) |
| Diyalogda "Yeni ürün / Mevcut üründen seç" modu | Kaldırıldı — satırdaki "Reçete" düğmesi aynı işi yapıyordu |
| Diyalogda "Girilen fiyat KDV dahil" anahtarı | Kaldırıldı — kafede fiyat daima brüt; alan etiketi "(KDV dahil)" |
| Diyalogda "Aktif" anahtarı | Yalnız DÜZENLEMEDE gösteriliyor |
| `lib/stock/usage-label.ts` | **Silindi** — seçenek açıklamaları product-kind'a taşındı |

Mod düğmeleri kalkınca kaybolan tek yol (reçetesi olmayan bir hammaddeye reçete
kurmak — Espresso gibi yarı mamüller böyle doğar) **satıra taşındı**: Hammaddeler
sekmesinde her satırda artık "Reçete ekle" düğmesi var.

### Sonuç

| | Önce | Sonra |
|---|---|---|
| Menü ekranı anahtar | 7 | **2** |
| Menü ekranı toplam kontrol | 24 | **17** |
| Ürün formu tür kontrolü | 3 kutu | **1 seçim** |
| `/stok` tür filtresi | 2 select | **1 select** |

### Yol boyunca yakalanan hata

`PATCH /api/stok/products/[id]` **`isService`'i sessizce yok sayıyordu**: gövdede
gönderilse bile yazılmıyor, yanıt yine 200 dönüyordu. Dört tür geçişi test edilirken
`service` geçişinin çalışmadığı görüldü. Üç bayrak artık tek döngüde işleniyor.

### Doğrulama — Demo Firma, gerçek uçlar

| Kontrol | Sonuç |
|---|---|
| Dört tür geçişi (PATCH) | ✅ `menu` / `ingredient` / `both` / `service` → doğru bayraklar |
| Sayfalar | ✅ `/stok`, `/restoran/menu`, `/restoran/satis`, `/restoran/raporlar` → 200 |
| Raporlar | ✅ `855 / 551 / 304` |
| Demo verisi | ✅ test sonrası açılış durumuna döndürüldü |

`tsc --noEmit` temiz; `eslint` yeni uyarı üretmiyor (kalan hatalar dokunulmamış
satırlardaki tırnak kaçışları, değişiklik öncesinde de vardı).

### Elle bakılmayan

Yeni tür seçicisinin **görüntüsü** (kart düğmeleri, satır içi `Select`) tarayıcıda gözle
doğrulanmadı — tarayıcı eklentisi bağlı değil.

---

## İş 10 — Reçete birim tuzağı (2026-07-27) ✅ **veri bozan hata**

### Bulgu

Kullanıcı "tutarlar ve birimler konusunda sıkıntı var, hammaddeden ne kadar
kullanılacağı net seçilemiyor" dedi. Sebep bulundu ve **gerçek veride kanıtlandı**.

`selectComponent` bileşen seçilince reçete birimini **stok birimine** eşitliyordu:

```
Süt seç  →  birim otomatik "LT" gelir  →  kullanıcı "200" yazar (200 ml kastederek)
         →  reçeteye porsiyon başına 200 LİTRE süt girer
```

Hiçbir katman itiraz etmiyor çünkü `LT → LT` geçerli bir dönüşüm. Kayıt kabul
ediliyor, `canConvert` geçiyor, `UNIT_MISMATCH` çıkmıyor.

**Demo Firma'da koşulan kanıt:** 200 LT'lik reçeteyle **tek bir adet** satıldığında
süt stoğu `19,4 LT → −180,6 LT` oldu. (Fiş iptal edildi, stok geri alındı.)

### Düzeltme — üç katman

**1. Varsayılan birim ailenin KÜÇÜĞÜ.** Yeni `defaultRecipeUnit()`
(`lib/data/units.ts`): `LT→ML`, `KG→GR`, `TON→GR`, `MT→CM`, aile dışı birimler
kendileri. Reçete miktarları neredeyse daima küçük birimdedir; yanlış tarafa
düşmek artık bilinçli bir seçim gerektiriyor.

**2. Dönüşüm satırda AÇIKÇA yazıyor.** Her bileşen satırının altında
`Stoktan düşecek: 0,2 LT / porsiyon`. "200 LT → 200 LT" ile "200 ML → 0,2 LT"
arasındaki fark artık gözle yakalanabilir.

**3. Aşırı tüketim uyarısı.** Tek porsiyon eldeki stoğun tamamını aşıyorsa kırmızı
uyarı çıkıyor ve **tek tıkla doğru birime çeviren** bir düğme sunuyor
("ML mi olmalıydı?"). Engellemiyor — stok gerçekten bitmiş olabilir (PLAN.md
"Adım 4": uyar, engelleme) — ama sessiz de geçmiyor.

Satış ekranındaki mevcut yetersizlik uyarısı dördüncü katman olarak duruyor.

### Doğrulama

| Kontrol | Sonuç |
|---|---|
| Hatanın yeniden üretimi | ✅ `200 LT` kaydı kabul edildi, 1 satışta stok `19,4 → −180,6 LT` |
| Düzeltme sonrası aynı giriş | ✅ `200 ML` → 1 satışta stok `19,4 → 19,2 LT` |
| Birim testleri | ✅ `test-recipe-expand.mjs` **45/45** (37'den; `defaultRecipeUnit` için 8 yeni test) |
| Demo verisi | ✅ test fişleri iptal + silindi, stoklar açılış değerlerinde |

### Not

Bu, altyapının değil **arayüz varsayılanının** yol açtığı bir veri bozulmasıydı:
genişletme motoru, dönüşüm ve stok düşümü baştan beri doğru çalışıyordu — kendisine
verilen sayıyı doğru işliyordu, sadece verilen sayı yanlıştı. "Altyapı sağlam ama UI
karışık" tespitinin en pahalı örneği.

---

## İş 11 — İptal edilen alış AVCO'ya sızıyordu (2026-07-29) ✅ **maliyet bozan hata**

### Bulgu

İptal (ve silme) alış hareketini **silmez**: `revertStockByReference` aynı `reference` ile
**fiyatsız** bir ters hareket yazar. AVCO sorgusu ise yalnız `unitPrice IS NOT NULL` olan
`IN`/`PURCHASE` satırlarını topluyordu — yani ters hareketi hiç görmüyor, **iptal edilmiş
alışın fiyatı ortalamada kalmaya devam ediyordu**.

Gerçek veride bulundu (REYPO, `Özel Crm Yazılım ve Uygulama`):

```
28 Tem 09:36  IN   +1  1.000.000  AAA2026000000011 - Satın alma faturası
28 Tem 09:37  OUT  −1      —      AAA2026000000011 - Fatura iptali (stok iade)
28 Tem 09:37  IN   +1  1.000.000  AAA2026000000011 - İade faturası
28 Tem 09:38  OUT  −1      —      AAA2026000000011 - Fatura iptali (stok iade)
28 Tem 09:40  IN   +1  1.000.000  IAD-2026-0001    - İade faturası
28 Tem 09:40  OUT  −1      —      IAD-2026-0001    - Fatura iptali (stok iade)
```

Üç belgenin **üçü de** iptal edilmiş, hatta faturalar DB'den silinmiş (`reference` artık var
olmayan bir id'yi gösteriyor) — buna rağmen ürünün birim maliyeti **₺1.000.000** görünüyordu.

### Neden "faturaya bakıp iptal olanı ele" yetmez

İlk akla gelen çözüm `stock_movements.reference` → `invoices.status = 'CANCELLED'` join'i.
Yukarıdaki gerçek vaka bunu çürütüyor: fatura **silindiğinde** satır DB'de kalmıyor, join
boş dönüyor ve hareket yine sayılırdı. Doğru bilgi belgede değil, **hareketlerin kendisinde**.

### Düzeltme — ağırlık artık belge bazında

`AVG_COST_SELECT` tek `LEFT JOIN` yerine `LEFT JOIN LATERAL` + `GROUP BY doc_key` kullanıyor
(`doc_key` = `reference`, boşsa hareketin kendi id'si):

| Belge başına | Nereden |
|---|---|
| `priced_qty` / `priced_value` | yalnız fiyatlı `IN`/`PURCHASE` satırları |
| `net_qty` | belgenin **TÜM** satırları (ters hareket dahil) |
| ağırlık | `LEAST(priced_qty, GREATEST(net_qty, 0))` |

Ters hareket fiyatsız olsa da `net_qty`'yi sıfırlıyor → belgenin ağırlığı 0 oluyor.
Kısmi geri almada (fatura düzenlenip miktar düşürülmüş) ağırlık kalana iniyor.
Referanssız elle hareketler tek tek kendi belgesi sayılıyor — bir fire çıkışı, ilgisiz bir
elle girişi götürmesin diye.

Yazma tarafına **hiç dokunulmadı**: şema değişmedi, ters hareket hâlâ fiyatsız yazılıyor.
Bu yüzden düzeltme **geçmiş veriye de** uygulanıyor — migration gerekmiyor.

### Doğrulama — `node scripts/test-avco-revert.js`

Test, koşacağı SQL'i `lib/stock/cost.ts`'ten **okur** (kopya tutmaz, sorgu değişirse test de
değişir) ve tüm senaryoları gerçek DB'de tek transaction'da kurup **geri sarar** — kalıcı
hiçbir şey yazmaz.

| Senaryo | Sonuç |
|---|---|
| Hareketsiz ürün → elle girilen fiyat | ✅ `100` |
| İki alış (10×50 + 10×100) | ✅ `75` |
| **Biri iptal (fiyatsız ters hareket)** | ✅ `50` — eski sorgu aynı veride hâlâ `75` diyor |
| Kısmi geri alma (10×200 → 5 iade) | ✅ `125` → `100` |
| Satış + satış iptali | ✅ ortalama değişmiyor (satış fiyatı `300` sızmıyor) |
| Referanssız elle giriş/çıkış | ✅ birbirini götürmüyor (`84` sabit) |
| TRANSFER `999` fiyatlı | ✅ ortalamaya girmiyor |
| Hepsi geri alınırsa | ✅ elle girilen fiyata dönüyor |
| `avgCostCte` / `resolveUnitCosts` biçimleri | ✅ ikisi de derleniyor (15/15 geçti) |
| `tsc --noEmit` | ✅ temiz |

**Gerçek veri taraması** (tüm firmalar, eski↔yeni karşılaştırması): tek fark yukarıdaki
REYPO ürünü — `1.000.000 → null`. `null` doğru cevap: ürünün `purchasePrice`'ı yok, fiyatlı
alışların hepsi geri alınmış, yani maliyet gerçekten **bilinmiyor**. Raporlarda "maliyeti
eksik" sayacına düşer (bkz. İş 2 `pricelessCount`). **Demo Firma dahil diğer tüm firmalarda
tek kuruş değişmedi** — `855 / 551 / 304` aynı.

**Sorgu planı** (116 ürünlü firma): ürün başına `stock_movements_productId_idx` üzerinden
index taraması, `Execution Time: 0,997 ms`. Eski sorguyla ölçülen süre farkı yok.

### Yol boyunca görülen, DÜZELTİLMEYEN iki şey

- **İade faturası alış fiyatı gibi işleniyor.** `RETURN` tipli fatura `type: "IN"` + kalem
  fiyatıyla hareket yazıyor (`invoices/route.ts:465`); satış iadesinde bu **satış fiyatı**
  olduğu için AVCO'ya satış fiyatı girer. Yukarıdaki ₺1.000.000 kayıtlarının ikisi tam olarak
  bu. Ayrı iş: iade, alış iadesi mi satış iadesi mi ayırt edilmeli.
- **Alış irsaliyesi fiyatsız stok girişi yazıyor** (`irsaliye/[id]/route.ts:137` `unitPrice`
  vermiyor). İrsaliyeyle giren mal AVCO'ya hiç katılmıyor; faturası kesilene kadar maliyet
  elle girilen `purchasePrice`'tan geliyor.

---

### Sırada ne var

- **Modül kapısının sunucu tarafı** — kapı artık VAR (`assertRestaurantModule`,
  `lib/restoran/tickets.ts`) ve Aşama 2 uçlarının hepsi ondan geçiyor. v1'in altı ucu
  (dört rapor + iki reçete) hâlâ korumasız: `restaurant` kapalı bir firmanın kullanıcısı
  onları çağırabiliyor. Her birine tek satır eklemek kaldı.
- **ÖKC / yazarkasa konumlandırması** — ticari karar, PLAN.md "Açık riskler" 1.
- ~~İptal edilen alışın AVCO'ya sızması~~ → **İş 11'de düzeltildi**.
- **Aşama 2 — masa/adisyon + salon planı**: PLAN.md "Adım 7", ayrı plan belgesi
  [ASAMA2.md](./ASAMA2.md).
