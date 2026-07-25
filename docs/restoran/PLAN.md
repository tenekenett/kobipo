# Kobipo Restoran & Kafe Modülü — Plan

> Karar kaydı. Adım adım, her adımda karar alınarak oluşturuldu.
> Günlük ilerleme ve "kaldığım yer" için bkz. [ILERLEME.md](./ILERLEME.md)

## Context

Kobipo genel amaçlı bir ön muhasebe SaaS'ı. Kafe/restoran dikeyi için 16 başlıklık kaba bir taslak çıkarıldı; taslak kod tabanıyla karşılaştırıldı ve ilk çıkışın **self-servis kahvecilerde fiş takibi** olmasına karar verildi.

Bu kararın kapsama iki net etkisi var:

- **Gerçek zamanlılık kapsam dışı.** Projede realtime altyapı yok (Supabase yalnızca Postgres + Storage olarak kullanılıyor, her şey SWR polling). Mutfak ekranı, canlı akış, garson bildirimi bu aşamada yapılmayacak.
- **Yeni rol gerekmiyor.** Mevcut ADMIN / BRANCH_MANAGER / SALES / ACCOUNTANT / STOCK rolleri yeterli.

Geriye kalan çekirdek problem: **bir latte satıldığında 20 gr kahve + 200 ml sütün stoktan düşmesi.** Kobipo'da bunun hiçbir parçası yoktu — ne reçete/BOM modeli, ne birim dönüşümü (kg→gr), ne de gram hassasiyetini taşıyacak kolon genişliği (`Product.stockQuantity` `Decimal(10,2)` idi). Bu olmadan taslaktaki "Bugünkü Karlılık", "Menü Performansı", "Kritik Stok Uyarısı" başlıklarının hiçbiri hesaplanamaz.

---

## Adım 1 — Konumlandırma

| Konu | Karar |
|---|---|
| Modül adı | **Restoran & Kafe** (sidebar grup başlığı), anahtar `restaurant` |
| Reçete nerede yaşar | **Stok modülünde** — sayfa `/stok/receteler`, menüde "Stok" grubunda |
| Reçeteyi kim görür | Yalnızca **Restoran & Kafe** paketi olanlar |
| Modül bağımlılığı | Restoran & Kafe, **Stok'u zorunlu kılar** |
| Deneme hesapları | Modül **gizli** — opt-in |

### Neden böyle

Reçete restorana özgü bir kavram değil ("3 m kumaş + 12 düğme = 1 gömlek" aynı yapıdır), bu yüzden kod ve URL olarak Stok'un altında duruyor — ileride imalat/üretim dikeyine açılırsa taşınması gerekmez. Ama ticari olarak Restoran & Kafe paketinin değer önerisi olduğu için erişimi o modüle bağlı.

Stok zorunluluğu doğal sonuç: reçetenin tek işi stok düşürmek, Stok modülü kapalıyken anlamsız. Ayrıca sayfa "Stok" menü grubunda durduğu için, grup gizlendiğinde reçete de onunla kaybolurdu.

### Gereken mimari eklemeler

Modül kilidi bugün **tamamen grup seviyesinde** çalışıyor: `nav.tsx:62-65` grup başlığını (`"Stok"`) modül anahtarına (`stock`) çevirip grubu komple gizliyor; `moduleKeyForPath()` de aynı grup taramasını yapıyor. "Stok grubunun içinde ama başka bir modüle bağlı sayfa" ifade edilemiyor. Üç küçük ekleme:

**a) Öğe bazlı modül bağı** — `components/dashboard/nav-config.tsx`

```ts
export type NavItemDef = {
  href: string; label: string; icon: LucideIcon; roles: string[]
  /** Verilirse öğe grubundan bağımsız olarak bu modüle bağlanır.
   *  Verilmezse bugünkü davranış: grubundan miras alır. */
  module?: string
}

// Stok grubuna eklenen öğe:
{ href: "/stok/receteler", label: "Reçeteler", icon: ChefHat,
  roles: ["ADMIN", BM, "STOCK", "ACCOUNTANT"], module: "restaurant" }
```

`nav.tsx` içindeki `groupedItems` hesabına, grup filtresinden sonra bir öğe filtresi eklenir: `item.module && disabledModules.has(item.module)` ise öğe düşer.

**b) Yol istisnası** — `moduleKeyForPath()`

Grup taramasından **önce** bakılan açık bir eşleme, böylece `ModuleGuard` URL ile doğrudan girişi de kilitler:

```ts
const PATH_MODULE_OVERRIDES: Record<string, string> = {
  "/stok/receteler": "restaurant",
}
```

**c) Modül kataloğu** — `lib/modules.ts`

```ts
requires?: string[]   // bu modül seçilince zorunlu eklenen modüller
optIn?: boolean       // deneme hesaplarının blanket erişimine DAHİL DEĞİL

{ key: "restaurant", group: "Restoran & Kafe", label: "Restoran & Kafe",
  description: "Menü, reçeteli stok düşümü, kahveci satış ekranı, günlük karlılık",
  requires: ["stock"], optIn: true }
```

`requires` iki yerde uygulanır: satın alma ekranı (`/ayarlar/abonelik`) seçimi otomatik tamamlar, `lib/billing/entitlements.ts` → `applyEntitlements()` yazmadan önce bağımlılıkları kapatır (arayüz atlanırsa da tutarlı kalsın diye).

`optIn` tek yerde uygulanır — `resolveGrantedModules()` bugün deneme için `[...MODULE_KEYS]` döndürüyor; dokunulmazsa **her deneme hesabına** (nalbura, tekstilciye) Restoran menüsü çıkar:

```ts
if (isTrialActive(sub, now))
  return MANAGEABLE_MODULES.filter((m) => !m.optIn).map((m) => m.key)
```

Ücretli hesaplar için ek iş yok: yeni anahtar `Subscription.purchasedModules`'ta olmadığı için `applyEntitlements` onu doğal olarak kapalı bırakır. `lib/billing/constants.ts` → `defaultPricingItems()` `module:restaurant` fiyat kalemini otomatik üretir (0 ₺ başlar, sistem-admin belirler).

---

## Adım 2 — Ürün modeli

Tek yeni alan: **`Product.isSellable Boolean @default(true)`**. Menü kategorisi için mevcut serbest metin `category` alanı korunuyor, göç yapılmıyor.

**Kritik nokta: "hammadde" ayrı bir bayrak değil.** Bir ürünün hammadde olup olmadığı `ProductRecipeItem`'da kullanılıp kullanılmadığından türetilir. Faydası: kahve çekirdeğini 250 gr paket olarak da satıyorsan `isSellable = true` kalır ve aynı anda latte reçetesinde bileşen olarak durur — **tek ürün kartı, tek stok bakiyesi.** Ayrı bayrak (`isIngredient`) veya üçlü enum kullanılsaydı kullanıcı aynı şeyi iki kez tanımlar, iki ayrı stok tutar ve sonuç sessizce yanlış çıkardı.

`@default(true)` sayesinde göç gerekmiyor — mevcut tüm firmaların ürünleri bugünkü gibi davranır.

### Yan etkiler (henüz yapılmadı)

- `/stok/urunler` listesi hammaddelerle kalabalıklaşacak → filtre eklenir (Tümü / Satılanlar / Hammaddeler)
- Reçetesi olan ürünün kendi `stockQuantity`'si anlamsız → stok listesinde "Reçeteli" rozeti
- Ürün formuna onay kutusu: "Satışta göster"

### Bilinçli ertelenen borç

`Product.category` serbest metin, yönetilen kategori listesiyle (`CompanyDefinition`, tip `PRODUCT_CATEGORY`) FK bağı yok — kategori yeniden adlandırılırsa ürünler kategorisiz kalır. Düzeltmesi mevcut tüm firmaların verisini göçürmeyi gerektirdiği için kapsam dışı.

---

## Adım 3 — Reçete yapısı

| Konu | Karar |
|---|---|
| Hassasiyet | Stok kolonları `Decimal(10,2)` → **`Decimal(14,4)`** |
| Yarı mamül | **Çok seviyeli**, ama **sanal** — stok bakiyesi tutulmaz, satışta hammaddeye kadar açılır |
| Boy/porsiyon | **Her boy ayrı ürün** ("Latte (Büyük)") |
| Birim dönüşümü | **Standart birim aileleri** (KG↔GR↔TON, LT↔ML, MT↔CM) |

Bu seçimler birbirini tamamlıyor: çok seviyeli reçete, "her boy ayrı ürün" kararının bakım maliyetini büyük ölçüde siliyor. "Latte (Büyük)" = 1 Espresso + 300 ml süt kurulduğunda, kahve gramajı değişince 60 reçete değil **tek Espresso reçetesi** düzenlenir.

### 3.1 Hassasiyet göçü

`Decimal(10,2)` küçük gramajları **sessizce yanlış** düşürüyordu: 5 ml vanilya LT cinsinden 0,005 → 0,01 veya 0,00 olur.

```
products.stockQuantity        numeric(10,2) → numeric(14,4)
products.minStockLevel        numeric(10,2) → numeric(14,4)
warehouse_stocks.quantity     numeric(10,2) → numeric(14,4)
stock_movements.quantity      numeric(10,2) → numeric(14,4)
```

En küçük temsil edilebilir miktar 0,0001 KG = 0,1 gram.

`InvoiceItem.quantity` **değişmedi**: satılan mamül adedi (1 latte) için 2 ondalık yeterli ve UBL/e-Fatura tarafına dokunmamak gerekiyor.

### 3.2 Yarı mamül için ayrı bayrak GEREKMİYOR

Yarı mamül = **reçetesi olan ve `isSellable = false` olan ürün.** Espresso tam olarak budur. Genişletme kuralı tek cümle:

> **Bileşenin aktif reçetesi varsa açılır; yoksa düşülür.**

Sanal olması da bundan geliyor: Espresso'nun `stockQuantity`'si hiç değişmez, çünkü ona hiç dokunulmaz.

### 3.3 Birim dönüşümü

`lib/data/units.ts` yalnızca isim eşlemesi yapıyordu (UBL `KGM`→`KG`), çarpan yoktu. Eklenen: `UNIT_FAMILIES` (mass: GR/KG/TON, volume: ML/LT, length: CM/MT) + `canConvert()` + `convertUnit()` + `convertibleUnits()` + `unitFamily()`.

**Bilinen sınır:** paket dönüşümü ("1 koli = 24 adet", "1 paket kahve = 250 gr") kapsam dışı. Reçete formunda aile uyuşmazlığı varsa kayıt reddedilir.

### 3.4 Döngü koruması

İki katman:
- **Kayıt anında (asıl savunma):** `assertNoRecipeCycle()` — eklenen bileşenden ürüne ulaşılabiliyorsa kayıt reddedilir, kullanıcıya zincir ürün adlarıyla gösterilir
- **Genişletme anında (savunmacı):** ziyaret edilen `productId` kümesi + **derinlik sınırı 10**. Veri elle bozulsa bile satış ekranı sonsuz döngüye girmez

---

## Adım 4 — Stok düşümü ve iptal

| Konu | Karar |
|---|---|
| Genişletme | Reçeteli ürün **kendisi düşmez**, bileşenlerine açılır (özyinelemeli) |
| Hareket referansı | Reçete hareketleri de `reference = invoiceId` ile yazılır |
| Yetersiz stok | **Uyar ama izin ver** — satış engellenmez, stok eksiye düşebilir |
| Görünürlük | Satış ekranında **kritik hammadde paneli** (`minStockLevel` ile) |

### İptal bedavaya geliyor

`revertStockByReference()` (`lib/stock/warehouse.ts:114`) bir belgeye ait hareketleri `reference` üzerinden gruplayıp net'in tersini uyguluyor ve idempotent. Reçete hareketlerini de aynı `reference` ile yazınca:

- Fiş iptalinde kahve ve süt **otomatik** geri gelir — ek kod, ek tablo, ek idempotency mantığı yok
- İki kez iptal/sil denenirse stok bir daha oynamaz (net zaten 0)
- **Reçete satıştan sonra değişse bile doğru çalışır** — geri alma kayıtlı hareketlere bakar, güncel reçeteyi yeniden hesaplamaz

Son madde ince ama kritik: aksi halde bir reçete güncellemesi, o güncellemeden önce kesilmiş fişlerin iptalini sessizce bozardı.

### Genişletme motoru — saf ve izomorfik

Sunucunun düşümü ile satış ekranının uyarısı **aynı sonucu vermek zorunda**. Bu yüzden genişletme saf bir fonksiyon: sunucu reçeteleri DB'den, istemci SWR'den yükleyip aynı fonksiyonu çağırır. (Mevcut örnek: `lib/billing/pricing.ts` → `computeOrder` aynı gerekçeyle saf yazılmış.)

Bileşen miktarı: `(item.quantity / recipe.yieldQuantity) × üst_miktar × (1 + wastageRate/100)`, ardından `convertUnit(item.unit → bileşenin stok birimi)`.

### Bağlanacağı yer

`app/api/e-donusum/invoices/route.ts` — satış stok bloğu (~416. satır). Kalem listesi doğrudan `adjustWarehouseStock`'a gidiyor; araya genişletme girer.

**Korunması gereken iki mevcut davranış:**

- `isService` ürünler stok hareketi oluşturmuyor. Reçeteli menü ürünleri bu daldan **geçmemeli** — atlanmamalı, genişletilmeli. Filtre sırası: önce genişlet, sonra `isService` ele.
- **Reçetesi olmayan ürün bugünkü gibi kendisi düşer.** Reçete motoru yalnızca reçetesi olanlara dokunur.

Maliyet, bileşen hareketinin `StockMovement.unitPrice` alanına yazılır (kolon zaten var). Hareketler `description = "Reçete: {mamül adı}"` ile işaretlenir.

### Yetersiz stok — uyar, engelleme

Mevcut satış akışında **hiçbir stok yeterlilik kontrolü yok**; fiş kesilirken stok eksiye düşebiliyor ("Yetersiz stok" kontrolü yalnızca elle stok hareketinde — `app/api/stok/movements/route.ts:98`). Bu davranış korunuyor: **sunucu satışı reddetmez.**

Uyarı tamamen satış ekranında yaşar: sepet değiştikçe `expandRecipeLines` istemcide çalışır, yetersizse kırmızı işaret çıkar.

Gerekçe: kahvecide stok girişleri gecikir (10 kg kahve alındı, faturası akşam girilecek). Engelleyici kontrol kasayı kilitler — sahada kabul edilemez.

---

## Adım 5 — Satış ekranı

Yeni ekran `/restoran/satis`. Ortak parçalar `quick-sale-screen.tsx`'ten **dar kapsamlı** ayıklanır. Park edilen satışlar v1'de tarayıcıda kalır.

| Ayıklanacak (paylaşılan) | Kahveciye özgü yazılacak |
|---|---|
| Ödeme kutusu: nakit/kart/havale, bölünmüş ödeme, para üstü | Büyük dokunmatik ürün kartları + kategori sekmeleri |
| Fiş yazdırma (`lib/fis/receipt-html.ts` + `receiptTemplate`) | Reçete yetersizlik uyarıları |
| | Kritik hammadde paneli |
| | Cari sorulmadan akış — perakende varsayılan |

Kaydetme yolu değişmiyor: `POST /api/e-donusum/invoices` (`isReceipt: true`).

### Halihazırda çözülmüş olanlar (tekrar üretme!)

- **Cari opsiyonel** — `quick-sale-screen.tsx:918` "perakende için boş bırakın"
- **Park edilen satışlar** — `Ticket` tipi (satır 103) paralel sepetleri tutuyor; adisyonun tarayıcı içi prototipi fiilen çalışıyor
- **Bölünmüş ödeme** — `splitMode` (satır 183), kalanı doldurma dahil

`components/satis/quick-sale-screen.tsx` 1.328 satır ve çalışıyor — geniş çaplı dokunmak gereksiz risk.

---

## Adım 6 — Karlılık

| Konu | Karar |
|---|---|
| Maliyet kaynağı | `Product.purchasePrice`, boşsa **son alış hareketinin** `unitPrice`'ı |
| Dondurma | Değer satış anında `StockMovement.unitPrice`'a yazılır |
| Yerleşim | Raporlar **Restoran & Kafe grubunda** |

`Product.purchasePrice` yalnızca elle güncelleniyor — alış faturası kesmek onu değiştirmiyor. `StockMovement.unitPrice` ise her alış hareketinde gerçekten ödenen fiyatı zaten kaydediyor. Mevcut kabulle de uyumlu: `app/api/raporlar/bilanco/route.ts:90` aynı mantığı (`purchasePrice ?? salePrice`) kullanıyor.

**Dondurma** kritik: satış anında hesaplanan birim maliyet bileşen hareketinin `unitPrice` alanına yazılır. Sonucu: kahveye zam gelse geçmiş günlerin karlılığı **değişmez**; günlük maliyet = reçete hareketlerinin `Σ |quantity| × unitPrice`'ı (tek sorgu).

**Kabul edilen zayıflık:** kullanıcı alış fiyatını güncellemezse maliyet eskir. Menü ekranında son 90 günde güncellenmemiş bileşenler için "maliyet güncel olmayabilir" uyarısı gösterilir.

**Raporlar neden Restoran grubunda:** Raporlar da satın alınabilir bir modül (`reports`). Kafe raporları oraya konsaydı müşteri **üç kalem** öderdi (Stok + Raporlar + Restoran).

### v1 raporları

| Sayfa | İçerik | Kaynak |
|---|---|---|
| `/restoran/karlilik` | Ciro, fiş adedi, ortalama fiş, hammadde maliyeti, brüt kâr, marj % | Fişler + reçete hareketleri |
| `/restoran/menu-performans` | Ürün bazında satış adedi, ciro, maliyet, kâr, marj | `InvoiceItem` + reçete hareketleri |
| `/restoran/gun-sonu` | Günün fişleri, ödeme tipi dağılımı, kasa sayımı karşılaştırması | `InvoicePayment` + `CashCount` |
| `/restoran/tuketim` | Aralıkta hangi hammaddeden ne kadar gitti | Reçete hareketleri |

Dördü de `$queryRaw` ile tek sorguya iner (`app/api/raporlar/kar-zarar/route.ts` deseni). Reçete hareketleri `description LIKE 'Reçete:%'` + `reference` üzerinden ayrılır.

Rapor sayfaları için **ortak chart bileşeni yok** — mevcut ekranlar bar'ları elle CSS ile çiziyor (`raporlar/satis/page.tsx:167-189`). Aynı yaklaşım izlenir.

---

## Adım 7 — Masa/adisyon (Aşama 2 yönü)

v1 kapsamında değil. Yön burada belirlendi ki v1 kararları ileriyi kapatmasın.

| Konu | Karar |
|---|---|
| Masa/salon | **Görsel salon planı** — sürükle-bırak, koordinatlı |
| Adisyon | **Yeni `Ticket` modeli** — mevcut `Order` akışına dokunulmaz |
| Kapanış | Adım 4'teki aynı fiş yoluna bağlanır (`isReceipt: true`) |

### Salon planı için hazır desen

Görsel plan editörü sıfırdan tasarlanmamalı — projede birebir aynı problemi çözen bir bileşen var: **Etiket Tasarımcısı** (`components/stok/label-designer/*` + `lib/labels/*`). Sürükle-bırak yerleştirme, öğe ağacı, boyut/konum yönetimi ve tasarımın `LabelTemplate.design Json` alanında versiyonlu JSON olarak saklanması.

Salon planı aynı deseni izler: `RestaurantTable` kayıtları masanın kimliğini (ad, kod, bölge, kapasite) tutar; yerleşim (koordinat, şekil, boyut) firma bazlı bir `Json` plan alanında saklanır.

### Ticket neden ayrı model

`Order` teslim tarihli, teklif/faturaya bağlı, resmî bir belge. Adisyon ise saatlerce açık kalan, masaya bağlı, bölünüp birleşen bir çalışma kaydı. İkisini aynı tabloda yaşatmak her iki akışı da karıştırır ve `Order`'ın çalışan faturaya-dönüştürme yolunu riske atar.

---

## Doğrulama senaryoları

### Kurulum

| Kayıt | Tanım |
|---|---|
| Kahve Çekirdeği | hammadde, **KG**, alış 500 ₺/KG, stok **10 KG**, `isSellable=false` |
| Süt | hammadde, **LT**, 30 ₺/LT, stok **20 LT**, `isSellable=false` |
| Vanilya Şurubu | hammadde, **LT**, 200 ₺/LT, stok **2 LT**, `isSellable=false` |
| **Espresso** | yarı mamül, `isSellable=false`, reçete: **20 GR** kahve, yield 1 |
| **Latte** | menü, ADET, satış 85 ₺, reçete: **1 ADET Espresso + 200 ML süt + 5 ML vanilya** |

### 1 — Özyinelemeli düşüm

3 Latte sat:

| Ürün | Önce | Sonra | Hesap |
|---|---|---|---|
| Kahve | 10 KG | **9,9400** | Espresso açıldı → 3 × 20 GR = 0,06 KG |
| Süt | 20 LT | **19,4000** | 3 × 200 ML = 0,6 LT |
| Vanilya | 2 LT | **1,9850** | 3 × 5 ML = 0,015 LT |
| Espresso | — | **değişmez** | sanal ara kat |
| Latte | — | **değişmez** | reçeteli ürün kendisi düşmez |

`StockMovement`: `reference` = fiş id, `unitPrice` = 500 / 30 / 200, `description` = `"Reçete: Latte"`.

### 2 — Hassasiyet

1 Latte sat → vanilya tam **0,0050 LT** düşmeli. `numeric(10,2)` bunu 0,01'e yuvarlardı (iki katı).

### 3 — İptal ve idempotency

Fişi iptal et → kahve 10,0000 / süt 20,0000 / vanilya 2,0000'a dönmeli.
**İkinci kez** iptal → stok bir daha oynamamalı.
Reçeteyi değiştir (vanilyayı çıkar), **eski bir fişi** iptal et → vanilya yine geri gelmeli (kayıtlı harekete göre).

### 4 — Döngü koruması

Espresso reçetesine Latte eklemeye çalış → kayıt reddedilmeli, zincir gösterilmeli.

### 5 — Yetersiz stok

Sütü 0,1 LT'ye düşür, 3 Latte sepete ekle → kırmızı uyarı çıkmalı ama **Tamamla çalışmalı**.

### 6 — Karlılık

3 Latte: ciro 255 ₺, maliyet `0,06×500 + 0,6×30 + 0,015×200 = 51 ₺`, brüt kâr **204 ₺**, marj **%80**.

### 7 — Regresyon (en önemlisi)

- Reçetesi **olmayan** ürünle mevcut Hızlı Satış'tan fiş kes → bugünkü davranış birebir korunmalı
- Aynısını satış faturası ve alış faturası ile tekrarla
- `isService` ürün sat → hâlâ hiç stok hareketi oluşmamalı

### 8 — Modül kapıları

- Deneme hesabıyla giriş → "Restoran & Kafe" görünmemeli, Stok grubunda "Reçeteler" olmamalı
- `restaurant` kapalı firmada `/stok/receteler`'e URL ile git → `ModuleGuard` engellemeli
- Abonelik ekranında "Restoran & Kafe" seç → Stok otomatik eklenmeli

---

## Açık riskler

**1. ÖKC / yazarkasa — ticari olarak en kritik açık.** Türkiye'de kafe/restoranda perakende satış yasal olarak ÖKC fişi gerektiriyor; Kobipo'nun `isReceipt` fişi **mali değer taşımıyor**. İki yoldan biri: (a) "adisyon takibi + ön muhasebe, mali fiş ÖKC'den" konumlandırması, (b) yol haritasına ÖKC entegrasyonu. Planı etkilemiyor ama **satıştan önce netleşmeli.**

**2. Modifier / seçenek sistemi yok.** "Soya sütü", "ekstra shot", "şekersiz" — kahvecide sık. Boy sorunu "her boy ayrı ürün" + çok seviyeli reçete ile çözüldü ama seçenekler için ölçeklenmiyor. Aşama 2'de değerlendirilmeli.

**3. Maliyet elle güncelleniyor.** `Product.purchasePrice` alış faturasıyla otomatik güncellenmiyor. Gerçek çözüm (ağırlıklı ortalama maliyet) stok modülünün tamamını ilgilendiren ayrı bir iş.

**4. `Product.category` FK değil.** Menü sekmeleri serbest metin kategoriye dayanacak.

---

## v1 kapsamı dışında (taslaktaki diğer başlıklar)

| Taslak başlığı | Durum |
|---|---|
| #2 Masa yönetimi, #8 müşteri hafızası | **Aşama 2** — yön Adım 7'de belirlendi |
| #3 Mutfak paneli, #4 garson, #1 canlı akış | Realtime altyapı gerektiriyor; bu aşamada yapılmayacak |
| #5/#6 Kontrol listeleri, #13 temizlik, #14 bakım | Projede **görev/hatırlatma/takvim modeli hiç yok**; ayrı "operasyon" alt modülü |
| #7 Personel vardiya/puantaj | `Employee`'de `userId` bile yok — önce İK kartı ↔ login bağı kurulmalı |
| #10 Kritik uyarılar | İlk parçası v1'de (kritik hammadde paneli). Bildirim için: `Notification` firma bazlı (`userId` yok), otomatik üretici yok, cron tanımlı değil — zamanlayıcı deseni `lib/billing/cron-auth.ts`'te hazır |
| #15 Gece raporu | Raporlar v1'de var, otomatik gece üretimi zamanlayıcı gerektiriyor |
| #16 Çok şubeli izleme | Altyapı hazır (`parentCompanyId`, `BRANCH_MANAGER`, `lib/auth/branch-access.ts`) |
