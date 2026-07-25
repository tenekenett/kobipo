# Restoran & Kafe Modülü — İlerleme Günlüğü

> Mimari kararlar ve gerekçeleri: [PLAN.md](./PLAN.md)
> Bu dosya "ne yapıldı, ne kaldı, nereden devam edilecek" kaydıdır.

**Son güncelleme:** 2026-07-26 (3. oturum sonu — **v1 kapsamı bitti**, Adım 1–8 tamam)

---

## ⚠️ Başka bir makinede devam ederken ÖNCE

```bash
git pull
npm install
npm run db:generate          # prisma generate — ProductRecipe modelleri için ŞART, atlanırsa
                             # "Unknown argument productRecipe" hatası alırsın
npm run dev
```

**`db:push` GEREKMİYOR.** Veritabanı 2026-07-25'te canlı Supabase'e uygulandı ve doğrulandı:
`product_recipes` + `product_recipe_items` tabloları oluştu, `Product.isSellable` eklendi,
4 stok kolonu `numeric(10,2)` → `numeric(14,4)`'e genişledi. Her iki makine **aynı** Supabase'e
bağlandığı için yeni makinede şema zaten hazır — sadece Prisma client'ı üretmen yeterli.

`supabase/migrations/` altındaki iki SQL dosyası (`20260725000001_stock_precision.sql`,
`20260725000002_product_recipes.sql`) **başka bir ortama** (ör. yeni bir Supabase projesi) elle
uygulamak için duruyor; ikisi de idempotent.

`.env` git'te değil — yeni makinede `DATABASE_URL` / `DIRECT_URL` / `NEXTAUTH_SECRET` lazım.
`NEXTAUTH_SECRET` iki makinede **aynı olmalı**, aksi halde e-Dönüşüm "tekrar bağlan" der.

Doğrulama (üçü de DB gerektirmez, saniyeler sürer):

```bash
node scripts/test-recipe-expand.mjs    # 37/37
node scripts/test-module-gating.mjs    # 20/20
node scripts/test-payment.mjs          # 25/25 — ödeme/parçalı tahsilat mantığı
npx tsc --noEmit                       # .next/types/validator.ts'teki 2 hata ESKİ, ilgisiz
npm run build                          # geçiyor; dev sunucusu AÇIKKEN Prisma DLL kilidi
                                       # yüzünden EPERM verir — önce dev'i durdur
```

`npx eslint` çıktısındaki 2 `react/no-unescaped-entities` hatası (`stok/page.tsx`,
`product-edit-dialog.tsx`) **bu işten önce de vardı**; "TL'ye" metnindeki kesme işaretinden.

**Modül varsayılan olarak KAPALI** (`optIn: true`). Ekranları görmek için bir firmaya elle açmak gerekiyor: `/system-admin/companies/[id]` → Modüller → "Restoran & Kafe". Stok da otomatik açılır.

**Test verisi hazır:** Demo Firma A.Ş.'de (`cmod4a8xz0001liqswmpjb6x2`) modül açık ve PLAN.md'nin
kurulum tablosu kurulu — Kahve Çekirdeği / Süt / Vanilya Şurubu / Espresso / Latte + 2 reçete.
Bozulursa `node scripts/seed-restoran-demo.mjs` ile geri kurulur (idempotent).
Demo Firma'da 3 test fişi var: `FS-SAT-2026-0001` (iptal edilmiş), `FS-SAT-2026-0002` (reçetesiz
regresyon testi), `FS-SAT-2026-0003` (3 Latte + 306 ₺ nakit — 8. adımın rapor doğrulaması,
raporlarda gerçek veri görünsün diye duruyor). Bu yüzden stok seed başlangıcından biraz düşük:
kahve `8,94` · süt `19,4` · vanilya `1,985`. Seed script'i baseline'a döndürür.

7. adımda hammaddelere `minStockLevel` eklendi (kahve 2, süt 5, vanilya 3) — satış ekranındaki
**kritik hammadde paneli** demo veriyle boş görünmesin diye. Vanilya (stok 2 ≤ eşik 3) bilinçli
olarak eşiğin altında; panel açılışta bir satır gösterir. Seed script'ine de işlendi.

---

## Durum

| # | İş | Durum |
|---|---|---|
| 1 | Stok hassasiyet göçü → `Decimal(14,4)` | ✅ Bitti, **DB'ye uygulandı** |
| 2 | Birim dönüşüm aileleri | ✅ Bitti |
| 3 | Reçete şeması + `isSellable` + API | ✅ Bitti, **DB'ye uygulandı** |
| 4 | Genişletme motoru + satış bağlantısı | ✅ Bitti, **uçtan uca doğrulandı** |
| 5 | Modül tanımı, nav ve gating | ✅ Bitti, **uçtan uca doğrulandı** |
| 6 | Reçete ekranı `/stok/receteler` | ✅ Bitti, **uçtan uca doğrulandı** |
| 7 | Kahveci satış ekranı `/restoran/satis` | ✅ Bitti, **uçtan uca doğrulandı** |
| 8 | Dört rapor ekranı | ✅ Bitti, **uçtan uca doğrulandı** |

**v1 kapsamındaki tüm adımlar tamam.** `ComingSoon` yer tutucusu kalmadı.
Sırada PLAN.md'deki açık işler var: ÖKC konumlandırması, ürün formuna "Satışta göster",
stok listesinde "Reçeteli" rozeti (aşağıdaki liste).

---

## Yapılanlar

### 1 — Hassasiyet göçü ✅

`Decimal(10,2)` gram bazlı reçeteyi taşıyamıyordu (5 ml vanilya LT cinsinden 0,005 → yuvarlanıp kayboluyordu).

- `prisma/schema.prisma` — 4 kolon `Decimal(14,4)`'e çıkarıldı:
  `Product.stockQuantity`, `Product.minStockLevel`, `WarehouseStock.quantity`, `StockMovement.quantity`
- `supabase/migrations/20260725000001_stock_precision.sql` — **yeni**

`InvoiceItem.quantity` bilinçli olarak **değiştirilmedi** (satılan mamül adedi; UBL/e-Fatura tarafına dokunmamak için).

Kontrol edildi: stok yolunda (`lib/stock/warehouse.ts`, `app/api/stok/**`) 2 ondalığa yuvarlayan kod **yok** — göç güvenli.

### 2 — Birim dönüşümü ✅

- `lib/data/units.ts` — mevcut dosyanın sonuna eklendi:
  `UNIT_FAMILIES` (mass: GR/KG/TON · volume: ML/LT · length: CM/MT),
  `unitFamily()`, `canConvert()`, `convertUnit()`, `convertibleUnits()`

Dosyadaki mevcut `normalizeUnitCode()` yeniden kullanılıyor, yani "kilogram"/"kg"/"KGM" hepsi çalışıyor.
Aile dışı dönüşüm (ADET↔GR) `null` döner — paket boyu kavramı kapsam dışı.

### 3 — Reçete şeması + API ✅

**Şema** (`prisma/schema.prisma`):
- `Product.isSellable Boolean @default(true)` — satış/menü ekranlarında listelenir mi
- `Product.recipe` + `Product.usedInRecipes` ilişkileri
- **`ProductRecipe`** modeli (`productId` unique → ürün başına tek reçete, `yieldQuantity`, `isActive`, `note`)
- **`ProductRecipeItem`** modeli (`componentProductId`, `quantity`, `unit`, `wastageRate`, `order`; component'e `onDelete: Restrict`)
- `Company.productRecipes` ilişkisi
- `supabase/migrations/20260725000002_product_recipes.sql` — **yeni**

**Kod:**
- `lib/stock/recipe-expand.ts` — **yeni**, SAF ve İZOMORFİK. `expandRecipeLines()` + `findRecipePath()` + `MAX_RECIPE_DEPTH = 10`
- `lib/stock/recipe.ts` — **yeni**, sunucu tarafı. `loadRecipeContext()` (tek sorguda tüm reçeteler + birimler), `assertNoRecipeCycle()`, `RecipeCycleError`
- `app/api/restoran/recipes/route.ts` — **yeni**. GET (liste, `?productId=`), POST (upsert; kalemler tümüyle değiştirilir)
- `app/api/restoran/recipes/[id]/route.ts` — **yeni**. GET, DELETE

POST doğrulamaları: bileşen miktarı > 0, birim zorunlu, aynı bileşen iki kez olamaz, ürün+bileşenler **aynı firmaya** ait olmalı (tenant sızıntısı önlemi), **birim uyumu kayıt anında** kontrol edilir (çalışma anında değil), **döngü kontrolü** (`assertNoRecipeCycle`).

### 4 — Genişletme motoru + satış bağlantısı ✅

**`lib/stock/recipe-expand.ts` sonuç şekli sonradan ikiye ayrıldı** (raporlar reçete tüketimini doğrudan satıştan ayırabilsin diye):

```ts
{
  direct:     [{ productId, quantity }]                      // reçetesiz — kendisi düşer
  components: [{ productId, quantity, sources: string[] }]   // reçeteden türeyen
  errors:     ExpandError[]
}
```

`sources` = bu miktara yol açan üst düzey mamül(ler). Alt seviyelerde kök taşınır: Espresso üzerinden gelen kahve de **Latte'ye** atfedilir.

**`lib/stock/recipe.ts`'e eklendi:** `resolveComponentCosts(companyId, productIds)` — `Product.purchasePrice`, boşsa ürünün **son IN hareketinin** `unitPrice`'ı. Son alış fiyatı tek sorguda çekiliyor (Postgres `DISTINCT ON`), ürün başına `findFirst` döngüsü yerine.

**`app/api/e-donusum/invoices/route.ts`** (~433–520): satış stok bloğuna genişletme girdi.

Kritik tasarım detayı — **yalnızca reçetesi olan kalemler genişleticiye giriyor**:

```ts
const toExpand    = stockItems.filter((s) => willExpand(s.productId))
const passthrough = stockItems.filter((s) => !willExpand(s.productId))
```

Gerekçe: genişletici aynı ürünün birden çok satırını tek satırda topluyor. Reçetesiz ürünleri de ondan geçirseydik, aynı üründen iki satırı olan bir faturada iki yerine tek hareket ve tek birim fiyat yazılırdı — mevcut davranıştan sapma. Bu ayrımla **reçetesiz ürünler için hiçbir şey değişmiyor.**

Diğer garantiler:
- Genişletme **yalnız SALES**'te çalışır; alış/iade dokunulmadan geçer
- `isService` filtresi genişletmeden **sonra** uygulanır
- Bileşen hareketleri `reference = invoice.id` (iptal bu sayede bedava çalışıyor)
- `description = "{fişNo} - Reçete: {mamül adı}"` → raporlar `description LIKE '%Reçete:%'` ile ayıracak
- Maliyet hareket üzerine **dondurulur** (`StockMovement.unitPrice`)
- Reçete katmanı çökerse `try/catch` ile satış genişletme öncesi davranışla devam eder — fiş asla bloklanmaz
- Firmanın hiç reçetesi yoksa `toExpand` boş kalır, akış birebir eskisi gibi ilerler

---

### 5 — Modül tanımı, nav ve gating ✅

**`lib/modules.ts`**
- `ModuleDef`'e `requires?: string[]` + `optIn?: boolean`
- `restaurant` kaydı: `group: "Restoran & Kafe"`, `requires: ["stock"]`, `optIn: true`
- `DEFAULT_TRIAL_MODULE_KEYS` — opt-in olmayan modüller (deneme hesapları bunu alır)
- `withModuleDependencies(keys)` — bağımlılıkları tamamlar
- `modulesRequiring(key, selected)` — bir modülü kilitleyen seçili modüller
- `reconcileDisabledModules(disabled)` — açık modülün gerektirdiği modül kapalı kalamaz

**`lib/billing/entitlements.ts`** — deneme dalı artık `DEFAULT_TRIAL_MODULE_KEYS` döndürüyor (eskiden `[...MODULE_KEYS]`); ücretli dal ve `applyEntitlements` bağımlılıkları tamamlıyor.

**`lib/billing/pricing.ts`** → `computeOrder` — **fiyatlandırma açığı kapatıldı.** Bağımlılık burada tamamlanıyor; aksi halde "restaurant" satın alan `applyEntitlements` sayesinde `stock`'u da alırdı ama sipariş satırlarına girmediği için **ücretsiz** almış olurdu. `computeOrder` hem istemci önizlemesinde hem sunucu siparişinde kullanıldığı için tek yerde çözüldü.

**`components/dashboard/nav-config.tsx`**
- `NavItemDef.module?` — öğeyi grubundan bağımsız bir modüle bağlar
- `PATH_MODULE_OVERRIDES = { "/stok/receteler": "restaurant" }`, `moduleKeyForPath()` bunu grup taramasından **önce** kontrol ediyor → `ModuleGuard` URL girişini de kilitliyor
- Stok grubuna "Reçeteler" (`module: "restaurant"`), yeni "Restoran & Kafe" grubu (5 sayfa)

**`components/dashboard/nav.tsx`** — `groupedItems` içinde öğe bazlı filtre: `item.module && disabledModules.has(item.module)` → öğe düşer.

**`app/(dashboard)/ayarlar/abonelik/page.tsx`** — `toggleExtra` seçimde bağımlılıkları ekliyor; bir modülü zorunlu kılan başka modül seçiliyse buton kilitli ve altında "… için gerekli" yazıyor.

**`app/api/system-admin/companies/[id]/route.ts`** — `sanitizeDisabledModules` yerine `reconcileDisabledModules`; sistem-admin elle "restaurant açık, stock kapalı" gibi tutarsız bir duruma düşemiyor.

**`lib/dashboard/page-titles.ts`** (6 başlık) ve **`lib/theme/dark-routes.ts`** (`/restoran`) güncellendi.

**Yer tutucu sayfalar** — nav'daki 6 link 404 vermesin diye mevcut `ComingSoon` bileşeniyle:
`app/(dashboard)/stok/receteler/page.tsx` ve `app/(dashboard)/restoran/{satis,karlilik,menu-performans,tuketim,gun-sonu}/page.tsx`.
Her biri gerçek ekranın ne yapacağını listeliyor; 6–8. adımlarda içleri doldurulacak.

---

### 6 — Reçete ekranı ✅

`app/(dashboard)/stok/receteler/page.tsx` — `ComingSoon` yer tutucusunun yerine gerçek ekran.

**İki sekme:**
- **Menü Ürünleri** (`isSellable=true`): Ürün · Reçete · Maliyet · Satış · Marj · İşlem. Reçetesi olanın kendi stoğu **gösterilmiyor** (düşmediği için yanıltıcı olurdu).
- **Hammaddeler** (`isSellable=false`): Ürün · Stok · Birim Maliyet · Kullanıldığı Reçeteler · Menüde. Yarı mamülde stok **"—"** (sanal) ve birim maliyet kendi reçetesinden hesaplanır.

Her satırda `isSellable` anahtarı — ürünü menüden çıkarıp hammaddeye çevirir (`PATCH /api/stok/products/[id]`, iyimser güncelleme).

**Dialog:** ürün seçimi (yeni reçetede) · üretim miktarı · bileşen satırları (bileşen `SearchSelect` + miktar + birim + fire %) · not · aktiflik anahtarı · canlı maliyet/marj özeti.

**Kritik tasarım kararı — maliyet `expandRecipeLines` ile hesaplanıyor**, elle çarpımla değil. Sunucunun stok düşümüyle **aynı saf fonksiyon**; böylece ekrandaki maliyet ile satışta fiilen düşen miktarlar hiçbir zaman ayrışmaz ve çok seviyeli reçete (Latte → Espresso → kahve) kendiliğinden doğru çıkar.

Taslak, kayıtlı reçetelerin üzerine bindirilerek önizlenir (`new Map(recipeMap)` + taslak) — kullanıcı kaydetmeden marjı görür.

**Döngü kontrolü istemcide de var** (`findRecipePath`, sunucudaki `assertNoRecipeCycle` ile aynı mantık): "Reçete döngüsü oluşur: Espresso → Latte → Espresso" yazar ve **Kaydet kilitlenir**. Sunucu tarafı asıl savunma olarak yerinde duruyor.

Birim listesi `convertibleUnits(bileşeninStokBirimi)` ile daraltılıyor — kullanıcı dönüştürülemeyecek birimi baştan seçemiyor.

**API'ye eklenenler** (`isSellable` hiç ele alınmamıştı):
- `GET /api/stok/products` → `?isSellable=` filtresi (7. adımdaki satış ekranı da kullanacak)
- `POST` → `isSellable` (gönderilmezse `true`, mevcut çağıranlar etkilenmiyor)
- `PUT` → `isSellable`
- `PATCH` → `isSellable` (tek alan; reçete ekranındaki anahtar bunu kullanıyor)

**Yakalanan hata:** `/api/stok/products` Prisma kaydını olduğu gibi döndürüyor, yani Decimal alanlar JSON'a **string** olarak geliyor ("85"). Aritmetik JS zorlamasıyla sessizce çalışıyor ama `Intl.NumberFormat` string'i geçersiz sayıp **0 basıyordu** — dialogda "Satış ₺0,00 · Brüt kâr ₺68,00" gibi tutarsız bir tablo çıktı. Çözüm: `normalizeProduct()` ile yükleme anında tek yerde sayıya çevirmek.

---

### 7 — Kahveci satış ekranı ✅

`app/(dashboard)/restoran/satis/page.tsx` artık `ComingSoon` değil; ince sarmalayıcı →
**`components/restoran/cafe-sale-screen.tsx`** (`/satis/hizli` deseniyle aynı).

**Ekran:** solda kategori sekmeli büyük dokunmatik menü kartları + arama; sağda (yapışkan)
sepet, yetersizlik uyarısı, ödeme kutusu ve Tamamla. `F2` satışı tamamlar.
Menü kartında fiyat **KDV dahil** gösterilir (kahvecide fiyat listesi brüttür); sepette ve
faturada net + `vatRate` gider — fatura API'si net bekliyor.

**Yetersiz stok uyarısı — engellemiyor.** Sepet değiştikçe istemcide `expandRecipeLines`
çalışır (sunucunun düşümüyle **aynı saf fonksiyon**), `components` ve `direct` miktarları
ürünün `stockQuantity`'siyle karşılaştırılır. Eksiye düşen her satır için "stok → sonuç"
kırmızı listede çıkar, altında "Satış engellenmez" notu. Genişletme hataları (birim
uyuşmazlığı, döngü) da aynı kutuda gösteriliyor — bunlar stoğu **sessizce eksik düşürür**,
görünmeleri şart.

**Kritik hammadde paneli:** aktif reçetelerde bileşen olarak geçen, **kendi reçetesi olmayan**
(yarı mamül sanaldır, stok tutmaz) ve `stockQuantity <= minStockLevel` olan ürünler.

**Perakende varsayılan:** cari alanı ekranda yok. Yalnız "Veresiye" açılınca müşteri seçici
beliriyor; müşterisiz veresiyede "kimseye borç yazılmaz" uyarısı çıkıyor.

**Dar kapsamlı ayıklama (PLAN "Adım 5"):**

| Yeni dosya | İçerik |
|---|---|
| `lib/satis/payment.ts` | SAF: `buildPaymentParts`, `paymentSummary`, `parseAmount`, `PaymentState` |
| `components/satis/payment-panel.tsx` | Ödeme kutusu UI: nakit/kart/havale, parçalı, para üstü, veresiye |
| `lib/stock/recipe-expand.ts` → `buildRecipeMap()` | Kayıt listesi → genişletme haritası (yalnız aktif) |
| `lib/swr/use-company-data.ts` → `useRecipes()` | Reçeteler + hazır `recipeMap`; `RefProduct`'a `isSellable`/`isActive`/`minStockLevel`/`avgPurchasePrice` |
| `scripts/test-payment.mjs` | Ödeme mantığının birim testleri (25 kontrol) |

`quick-sale-screen.tsx` **bilerek refactor edilmedi** — 1.328 satır, çalışıyor, uçtan uca
doğrulanmış tahsilat yolu var. Paylaşılan parçalar yeni ekranda kullanılıyor; hızlı satışı
`PaymentPanel`'e taşımak ayrı ve isteğe bağlı bir iş (mantık artık tek yerde test edildiği
için mekanik olacak).

**Ödeme mantığının inceliği (testle sabitlendi):** parçalı ödemede kart/havale **önce**,
nakit **en sona** işlenir. Toplamı aşan kısım nakitten kırpılıp para üstü olur; kart
kırpılsaydı gerçekten çekilmiş tutar eksik kaydedilirdi.

**Yan iş — mevcut Hızlı Satış'ın ızgarası düzeltildi:** `quickProducts` artık
`isSellable` filtreliyor, yani "Kahve Çekirdeği / Süt / Espresso" hızlı ürün tuşlarında
görünmüyor. Arama/barkod kutusu (`ProductCombobox`) tümünü göstermeye devam ediyor —
hammadde bilinçli satılmak istenirse oradan bulunur.

**Reçete ekranı da tek kaynağa bağlandı:** oradaki satır içi harita kurulumu silinip
`buildRecipeMap` çağrısına indi (davranış aynı, kural artık tek yerde).

---

### 8 — Dört rapor ✅

`/restoran/{karlilik,menu-performans,tuketim,gun-sonu}` — dördü de `ComingSoon` yerine gerçek ekran.

**Ortak katman (tek kaynak):**

| Dosya | İş |
|---|---|
| `lib/restoran/reports.ts` | `reportScope()` + `docCostCte` — kapsam ve maliyet tanımı |
| `components/restoran/report-ui.tsx` | Tarih aralığı, SWR çekimi, StatTile/Bar/ReportState, biçimleyiciler |

Dördü **aynı kapsam CTE'sini** kullanıyor; ayrı yazılsalardı aynı gün için farklı ciro
gösterirlerdi.

**Kapsamda çözülen üç incelik:**

1. **İptal edilen fiş.** `revertStockByReference` geri alma hareketlerini `"… - Fatura iptali"`
   açıklamasıyla yazıyor, yani `LIKE '%Reçete:%'` filtresine takılmıyor. Hareketleri tarihe göre
   toplasaydık iptal edilmiş fişin maliyeti raporda kalırdı. Bu yüzden hareketler **belgeye
   join'leniyor** ve `status NOT IN ('CANCELLED','CONVERTED')` orada uygulanıyor.
2. **Faturaya dönüştürülen fiş.** Dönüştürme stoğu tekrar işlemiyor: hareketler FİŞTE kalıyor,
   ciro FATURAYA geçiyor. `ref` CTE'si `convertedInvoiceId` üzerinden ikisini eşliyor — olmasaydı
   o satışlar **maliyetsiz** görünür, marj yapay olarak %100 çıkardı.
3. **Saat dilimi.** Kolonlar `timestamp without time zone` ve UTC. Gün kırılımı
   `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul'` ile yerel takvim gününe göre yapılıyor;
   aralık sınırlarını da istemci yerel gece yarısından ISO'ya çevirip gönderiyor. Aksi halde
   TSİ 00:00–03:00 arası satışlar bir önceki güne düşerdi.

**Maliyetin iki farklı kaynağı bilinçli olarak ayrı:**

- **Reçeteli ürün** → `Σ |miktar| × unitPrice` (satış anında **dondurulmuş**).
- **Reçetesiz ürün** (şişe su) → ürün kartındaki alış fiyatı. Doğrudan satışın stok hareketindeki
  `unitPrice` **satış** fiyatıdır, maliyet değil — o alan kullanılamaz. Karlılıkta ayrı satır
  olarak gösteriliyor, çünkü biri gerçekleşmiş veriye diğeri güncel fiyata dayanıyor.

**Menü performansında maliyet neden reçeteden hesaplanıyor:** reçete hareketi fatura başına tek
satır yazılıyor ve kaynak mamüller açıklamada birleşiyor (`"Reçete: Americano, Latte"`). Bir fişte
iki kahve varsa ortak sütü ürünlere bölecek veri yok. Çözüm: **bileşenin gerçekleşen birim
maliyeti** dondurulmuş hareketlerden, **ürün başına miktar** ise `expandRecipeLines` ile
reçeteden. Toplam, karlılıktaki dondurulmuş toplamla aynı çıkıyor; sapma ancak aralık içinde
reçete değiştiyse olur ve ekranda uyarı olarak gösteriliyor (`totals.frozenRecipeCost`).

**Ekranlarda ayrıca:** tüketim raporunda "günlük ortalama" ve **"kaç günlük stok kaldı"**
(satın alma planlaması için), gün sonunda fiş listesi + ödeme dağılımı + `CashCount`
karşılaştırması. Gün sonunda fişler **belge** tarihine, ödemeler **tahsilat** tarihine göre
gelir — dünkü veresiyenin bugünkü tahsilatı bugünün kasasına girer.

---

## Doğrulama durumu

| Kontrol | Sonuç |
|---|---|
| `npx prisma validate` / `generate` | ✅ geçti |
| `npx tsc --noEmit` | ✅ yeni kodda hata yok |
| `npx eslint` (değişen dosyalar) | ✅ temiz |
| `node scripts/test-recipe-expand.mjs` | ✅ 37/37 (`buildRecipeMap` dahil) |
| `node scripts/test-module-gating.mjs` | ✅ 20/20 |
| `node scripts/test-payment.mjs` | ✅ 25/25 |
| Modülün 6 sayfası (giriş yapılmış istek) | ✅ hepsi 200, dev log'da hata yok |
| **Uçtan uca (canlı DB + gerçek uçlar)** | ✅ aşağıdaki iki tablo |

`tsc` çıktısında kalan 2 hata **önceden var olan** ve bu işle ilgisiz: `.next/types/validator.ts` içinde, var olmayan `app/api/billing/checkout` ve `app/api/billing/webhook` route'larına işaret ediyor (eski build çıktısından kalma stale tip dosyası).

### Uçtan uca doğrulama — Demo Firma A.Ş., 2026-07-25

PLAN.md "Doğrulama senaryoları" tablosu gerçek DB ve gerçek satış ekranıyla koşuldu:

| # | Senaryo | Sonuç |
|---|---|---|
| 1 | **Özyinelemeli düşüm** — 3 Latte sat | ✅ kahve `9.94` KG · süt `19.4` LT · vanilya `1.985` LT; **Espresso ve Latte değişmedi** |
| 2 | **Hassasiyet** | ✅ vanilya tam `0,015` LT düştü — `numeric(10,2)` bunu `0,02`'ye yuvarlardı |
| 3 | **İptal + idempotency** | ✅ iptal sonrası `10 / 20 / 2`'ye döndü; hareketlerin **net'i 0**, ikinci geri alma etkisiz |
| 4 | **Döngü koruması** | ✅ Espresso'ya Latte eklenince "Espresso → Latte → Espresso", Kaydet kilitli |
| 6 | **Karlılık** | ✅ ciro `₺255`, maliyet `₺51` (`0,06×500 + 0,6×30 + 0,015×200`), marj **%80** — ekrandaki değerle birebir |
| 7 | **Regresyon** | ✅ reçetesiz ürün (Kahve Çekirdeği) satıldığında **kendisi** düştü (`10→9`), açıklama "Satış faturası", genişletme hiç devreye girmedi |
| 8 | **Modül kapıları** | ✅ `restaurant` kapatılınca Reçeteler nav'dan düştü, "Restoran & Kafe" grubu kayboldu, URL ile giriş `ModuleGuard` ile "Bu modül kapalı" |

Yazılan hareketler (`reference` = fiş id, maliyet dondurulmuş):

```
Kahve Çekirdeği  -0.06  × 500  [OUT] FS-SAT-2026-0001 - Reçete: Latte
Süt              -0.6   ×  30  [OUT] FS-SAT-2026-0001 - Reçete: Latte
Vanilya Şurubu   -0.015 × 200  [OUT] FS-SAT-2026-0001 - Reçete: Latte
```

Senaryo 3'ün üçüncü parçası (reçete değişince eski fişin iptali) ayrıca koşulmadı; gerekmiyor: `revertStockByReference` yalnızca `stock_movements`'ı `groupBy` ile okuyor, reçeteye **hiç bakmıyor** — yukarıdaki net=0 gözlemi aynı kod yolunu kanıtlıyor.

### Senaryo 5 — yetersiz stok (7. adım, **başsız** doğrulandı)

Bu oturumda tarayıcı eklentisi bağlı olmadığı için ekran **gözle görülmedi**. Onun yerine
satış ekranının yetersizlik hesabı, **gerçek Demo Firma verisi** üzerinde ekranla birebir aynı
saf fonksiyonlarla koşuldu (DB'ye yazmadan, süt stoğu yalnız bellekte 0,1 LT varsayılarak):

```
3 Latte · süt bellekte 0,1 LT
  bileşenler: Kahve Çekirdeği 0.06 KG · Süt 0.6 LT · Vanilya 0.015 LT   (kaynak: Latte)
  uyarı satırı: Süt 0.1 → -0.5 LT · gereken 0.6 · Latte
  gerçek stokla (20 LT) uyarı sayısı: 0
  menüde görünen: Latte     (hammaddeler ızgarada YOK — isSellable filtresi çalışıyor)
  kritik hammadde paneli: Vanilya Şurubu 2/3
```

### Adım 7–8 uçtan uca — 2026-07-26, Demo Firma A.Ş.

Tarayıcı eklentisi bağlı olmadığı için ekranlar **gözle görülmedi**; onun yerine demo hesapla
(`demo@muhasebe.com`, Demo Firma'da ADMIN) oturum açılıp **gerçek HTTP uçları** kullanıldı.
Satış ekranının `handleComplete`'i ne gönderiyorsa aynısı gönderildi.

`FS-SAT-2026-0003` — 3 Latte, 306 ₺ nakit tahsilat (bu oturumda oluşturuldu, duruyor):

| Kontrol | Sonuç |
|---|---|
| Fiş oluştu | ✅ `net 255 · KDV 51 · toplam 306` |
| Reçete düşümü | ✅ kahve `-0.06 × 500` · süt `-0.6 × 30` · vanilya `-0.015 × 200`, hepsi `"FS-SAT-2026-0003 - Reçete: Latte"` |
| Espresso / Latte | ✅ değişmedi (yarı mamül sanal, reçeteli mamül kendisi düşmez) |
| **Karlılık** | ✅ ciro `255` · maliyet `51` · brüt kâr `204` · **marj %80** — PLAN senaryo 6 ile birebir |
| **Menü performansı** | ✅ Latte 3 adet · maliyet `51` · `costBasis: recipe` · hesaplanan = dondurulmuş (sapma yok) |
| **Tüketim** | ✅ kahve `0.06 KG/₺30` · süt `0.6 LT/₺18` · vanilya `0.015 LT/₺3` = `₺51`, paylar %58,8 / %35,3 / %5,9 |
| **Gün sonu** | ✅ 1 fiş · tahsil `306` · açık `0` · nakit dağılımı `306` |
| İptal edilmiş fiş (`FS-SAT-2026-0001`) | ✅ dört raporun hiçbirinde görünmüyor |
| Reçetesiz satış (`FS-SAT-2026-0002`) | ✅ ciro 600 / maliyet 500 (alış fiyatından) / marj %16,7 · `costBasis: purchase` |

Yetersizlik uyarısı ayrıca **başsız** doğrulandı (DB'ye yazmadan, süt bellekte 0,1 LT):

```
3 Latte · süt 0,1 LT → uyarı satırı: Süt 0.1 → -0.5 LT · gereken 0.6 · Latte
gerçek stokla (19,4 LT) uyarı sayısı: 0
menüde görünen: Latte   (hammaddeler ızgarada YOK — isSellable filtresi çalışıyor)
kritik hammadde paneli: Vanilya Şurubu 1,985/3
```

**Kalan tek elle kontrol:** ekranların GÖRÜNTÜSÜ (yerleşim, dokunmatik kartlar, fiş yazdırma
penceresi). Veri yolu ve hesapların tamamı yukarıda doğrulandı.

> Not: giriş için dev sunucusu geçici olarak `RECAPTCHA_SECRET_KEY` boş bırakılarak çalıştırıldı —
> `lib/auth/recaptcha.ts`'in zaten desteklediği lokal geliştirme yolu. Test bitince sunucu normal
> ortamla yeniden başlatıldı, kodda değişiklik yok.

---

## ← KALDIĞIM YER: v1 bitti, sıradakiler

Adım 1–8 tamam. Modül uçtan uca çalışıyor: reçete tanımla → kahveci ekranından sat →
hammadde otomatik düş → dört rapordan oku.

Ekranlar tarayıcıda gözle de doğrulandı (aşağıdaki "Kapanış işleri" bölümü).

**Devam edilecek yerler (öncelik sırasıyla):**

1. **ÖKC / yazarkasa konumlandırması** — kod işi değil, ticari karar. Satıştan önce netleşmeli
   (PLAN.md "Açık riskler" 1).
2. **Dashboard'da `?company=` parametresi sert gezinmede yok sayılıyor** — adres çubuğuna
   `/stok?company=demo-firma-a-s` yazınca sağlayıcı firmayı varsayılana döndürüp URL'i
   yeniden yazıyor (link paylaşımını bozuyor). **Bu modüle özgü değil, tüm panelde var**;
   ayrı bir iş olarak ele alınmalı.

Aşama 2 yönü (masa/adisyon, salon planı) PLAN.md "Adım 7"de duruyor.

---

## Kapanış işleri (aynı oturum) ✅

**"Satışta göster" onay kutusu** — `/stok` ürün formu (`app/(dashboard)/stok/page.tsx`) ve
`components/stok/product-edit-dialog.tsx`. Hızlı Satış ızgarası artık `isSellable` filtrelediği
için bu kutu **zorunlu hale gelmişti**: aksi halde bir ürünü ızgaradan çıkarmanın tek yolu
Restoran modülüne bağlı reçete ekranıydı. Kapalıyken altında ne anlama geldiği yazıyor.

**"Reçeteli" rozeti + stok gizleme** — `/stok` listesinde aktif reçetesi olan ürün rozetle
işaretleniyor ve **stok sütununda sayı yerine "—"** gösteriliyor. Gerekçe: reçeteli ürünün
bakiyesi hiç değişmiyor, Latte listede `0,00 Tükendi` diye kırmızı görünüyordu. Aynı sebeple
düşük stok sayacı ve "yalnızca düşük stok" filtresi de bu ürünleri dışarıda bırakıyor
(Demo Firma'da uyarı 3'ten 1'e indi — geriye yalnız gerçek kritik olan Vanilya kaldı).

### Tarayıcı testinde yakalanan iki hata (düzeltildi)

1. **Rapor ekranları firma değişiminde önceki firmanın rakamlarını gösteriyordu.**
   `useReport`'taki `keepPreviousData` aralık değişiminde titremeyi önlüyor ama firma
   değişiminde birkaç saniye boyunca Reypo'nun cirosu Demo Firma başlığı altında duruyordu.
   Çözüm: yanıt kendi anahtarıyla sarmalanıyor, firma öneki tutmuyorsa veri gösterilmiyor
   (aralık değişiminde önceki veri korunmaya devam ediyor).
2. **Kahveci ekranı ürün listesi çekilemediğinde "Menüde ürün yok" diyordu.** Menü doluyken
   geçici bir DB/ağ hatasında kasiyer menüyü boş sanardı. Yükleme ve hata durumu artık boş
   menüden ayrı gösteriliyor.

### Tarayıcıda gözle doğrulanan (2026-07-26, Demo Firma + Reypo Medya Ajansı)

| Ekran | Görülen |
|---|---|
| Kahveci Satış | Menüde yalnız Latte `₺102,00` (KDV dahil) + reçete ikonu; kritik hammadde paneli `Vanilya 1,985/3`; 3 Latte → `₺255 + ₺51 = ₺306` |
| **Senaryo 5** | 100 Latte → kırmızı `Süt 19,4 → -0,6 LT · Gereken 20 LT · Latte` + "Satış engellenmez" ve **Tamamla aktif kaldı** |
| Karlılık | Demo: `₺855 / ₺551 / ₺304`, günlük kırılımda `26 Tem: ₺255 −₺51 ₺204 %80.0` |
| Menü Performansı | Reypo'da tek satır, karlılıkla birebir aynı toplam (`₺67.312,50 / ₺2.562,50 / %96,2`) |
| Stok listesi | Espresso + Latte'de "Reçeteli" rozeti ve stok `—`; uyarı 3 → 1 |
| Ürün formu | Süt'te "Satışta göster" kapalı; açıp kaydedince menüde belirdi, kapatınca kayboldu |
| **Satış → fiş** | Ekrandan 1 Latte satıldı: `Tam` → `Satışı Tamamla` → `FS-SAT-2026-0004` · "Satış tamamlandı" diyaloğu · **Fiş penceresi açıldı** (ayrı pencere olduğu için eklenti göremedi, "açılır pencere engellendi" uyarısı çıkmadı) |
| **İptal** | Test fişi iptal edildi → stok `8,94 / 19,4 / 1,985`'e **birebir geri döndü**, raporlar fişi dışladı (`₺855 / ₺551 / ₺304`) |

Reypo Medya Ajansı (reçetesi olmayan gerçek firma) da sorunsuz: hammadde maliyeti `₺0`,
reçetesiz ürün maliyeti ayrı satırda `₺2.562,50`.

Test fişi iptal edildiği için demo verisi bu belgede yazan haliyle duruyor —
`FS-SAT-2026-0004` iptal listesinde görünür ama hiçbir rapora girmez.

---

## Karar dışı bırakılan / hatırlanacak

- **ÖKC/yazarkasa** konusu hâlâ açık ve ticari olarak en kritik risk — satıştan önce konumlandırma kararı gerekiyor (bkz. PLAN.md "Açık riskler").
- Modifier/seçenek sistemi ("soya sütü", "ekstra shot") v1'de yok; boy sorunu "her boy ayrı ürün" ile çözüldü.
- `Product.category` hâlâ serbest metin, FK değil — menü sekmeleri buna dayanacak.

### Raporlarda bilinçli bırakılan sınırlar

- **Menü performansında maliyet dağıtımı reçeteden türetiliyor**, hareket satırından değil
  (gerekçe yukarıda: tek satırda birleşen kaynaklar). Kesin çözüm `stock_movements`'a
  `sourceProductId` eklemek olurdu — v1'de gerekmedi, ekranda sapma uyarısı var.
- **Reçetesiz ürünlerin maliyeti güncel alış fiyatından** geliyor, dondurulmuş değil.
  Gerçek çözüm ağırlıklı ortalama maliyet (PLAN.md "Açık riskler" 3), stok modülünün tamamını
  ilgilendiren ayrı bir iş.
- **`lib/restoran/reports.ts` için DB'siz birim testi yok** — modül `Prisma.sql` kullandığı için
  tek başına derlenip çalıştırılamıyor. Doğrulama gerçek uçlar üzerinden yapıldı (yukarıdaki tablo).

### 6–7. adımda görülen, henüz yapılmamış işler

- ~~Mevcut Hızlı Satış ekranı `isSellable`'ı yok sayıyor~~ → **7. adımda yapıldı** (`quickProducts` filtresi).
- ~~Ürün formunda "Satışta göster" onay kutusu yok~~ → **yapıldı**, aşağıya bak.
- ~~Stok listesinde "Reçeteli" rozeti yok~~ → **yapıldı**, aşağıya bak.
- **Kahveci ekranında park/adisyon yok.** Hızlı Satış'ta `Ticket` ile çözülmüş; kahveci ekranı v1'de tek sepet. Masa/adisyon zaten Aşama 2 (PLAN.md "Adım 7").
- **Hızlı Satış `PaymentPanel`'e taşınmadı** — mantık `lib/satis/payment.ts`'te ve testli; taşıma isteğe bağlı, mekanik bir iş.
- **Test ortamı notu:** `yasin.dikdere123@gmail.com` kullanıcısı doğrulama için Demo Firma A.Ş.'ye ADMIN olarak bağlandı (`UserCompany`). Gerekmiyorsa kaldırılabilir.
