# Restoran & Kafe Modülü — İlerleme Günlüğü

> Mimari kararlar ve gerekçeleri: [PLAN.md](./PLAN.md)
> Bu dosya "ne yapıldı, ne kaldı, nereden devam edilecek" kaydıdır.

**Son güncelleme:** 2026-07-25

---

## ⚠️ Başka bir makinede devam ederken ÖNCE

```bash
npm install
npm run db:generate          # prisma generate — yeni modeller (ProductRecipe...) için ŞART
```

**Veritabanı henüz güncellenmedi.** Şema ve SQL yazıldı ama hiçbir DB'ye uygulanmadı:

```bash
npm run db:push              # prisma schema -> DB  (DİKKAT: canlı Supabase'e gider)
```

`db:push` yerine `supabase/migrations/` altındaki iki dosya elle de uygulanabilir:
- `20260725000001_stock_precision.sql`
- `20260725000002_product_recipes.sql`

İkisi de idempotent. Hassasiyet göçü kolon **genişletmesi** olduğu için veri kaybetmez.

Doğrulama (ikisi de DB gerektirmez):

```bash
node scripts/test-recipe-expand.mjs    # 33/33
node scripts/test-module-gating.mjs    # 20/20
```

**Modül varsayılan olarak KAPALI** (`optIn: true`). Ekranları görmek için bir firmaya elle açmak gerekiyor: `/system-admin/companies/[id]` → Modüller → "Restoran & Kafe". Stok da otomatik açılır.

---

## Durum

| # | İş | Durum |
|---|---|---|
| 1 | Stok hassasiyet göçü → `Decimal(14,4)` | ✅ Kod yazıldı, **DB'ye uygulanmadı** |
| 2 | Birim dönüşüm aileleri | ✅ Bitti |
| 3 | Reçete şeması + `isSellable` + API | ✅ Kod yazıldı, **DB'ye uygulanmadı** |
| 4 | Genişletme motoru + satış bağlantısı | ✅ Bitti (uçtan uca test DB bekliyor) |
| 5 | Modül tanımı, nav ve gating | ✅ Bitti |
| 6 | Reçete ekranı `/stok/receteler` | ⬜ Yer tutucu var ← **kaldığım yer** |
| 7 | Kahveci satış ekranı `/restoran/satis` | ⬜ Yer tutucu var |
| 8 | Dört rapor ekranı | ⬜ Yer tutucu var |

Tüm nav sayfaları `ComingSoon` yer tutucusuyla mevcut — modül açıldığında hiçbir link 404 vermiyor.

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

## Doğrulama durumu

| Kontrol | Sonuç |
|---|---|
| `npx prisma validate` | ✅ geçti |
| `npx prisma generate` | ✅ geçti |
| `npx tsc --noEmit` | ✅ yeni kodda hata yok |
| `node scripts/test-recipe-expand.mjs` | ✅ 33/33 |
| `node scripts/test-module-gating.mjs` | ✅ 20/20 |

`tsc` çıktısında kalan 2 hata **önceden var olan** ve bu işle ilgisiz: `.next/types/validator.ts` içinde, var olmayan `app/api/billing/checkout` ve `app/api/billing/webhook` route'larına işaret ediyor (eski build çıktısından kalma stale tip dosyası).

`scripts/test-recipe-expand.mjs` PLAN.md'deki doğrulama senaryolarının saf-fonksiyon kısmını koşuyor: 3 Latte → kahve 0,06 KG / süt 0,6 LT / vanilya 0,015 LT, espresso ve latte düşmez, fire, yieldQuantity, döngü, birim uyuşmazlığı.

**Henüz uçtan uca (DB + UI) test EDİLMEDİ** — DB'ye push yapılmadığı için.

---

## ← KALDIĞIM YER: Adım 6 — Reçete ekranı

**Arka uç tamamen bitti.** Kalan iş yalnızca arayüz: 6, 7, 8. adımlar birer ekran işi, hepsinin API'si ya hazır ya da tek `$queryRaw` uzağında.

### 6 — Reçete ekranı `/stok/receteler`

Dosya: `app/(dashboard)/stok/receteler/page.tsx` (şu an `ComingSoon` yer tutucusu — içi doldurulacak).

API hazır:
- `GET /api/restoran/recipes?companyId=&productId=` — liste (ürün + bileşen adları, birimleri, alış fiyatları ve stokları dahil, Decimal'ler sayıya çevrilmiş)
- `POST /api/restoran/recipes` — upsert (`{ companyId, productId, yieldQuantity, isActive, note, items: [{ componentProductId, quantity, unit, wastageRate }] }`); kalemler tümüyle değiştirilir
- `GET/DELETE /api/restoran/recipes/[id]?companyId=`

Ekran iskeleti (mevcut sayfa desenini izle — `"use client"` → `useSearchParams().get("company")` → firma yoksa "Lütfen bir firma seçin" kartı):
- Menü ürünleri listesi (`isSellable=true`), satırdan "Reçete Düzenle" → dialog
- Dialogda bileşen seçimi: mevcut `ProductCombobox` (`components/e-donusum/product-combobox.tsx`)
- Birim seçimi: mevcut `UnitCombobox`; listeyi daraltmak için `convertibleUnits(bileşeninStokBirimi)` kullanılabilir — kullanıcı en baştan dönüştürülemeyecek birim seçemesin
- Canlı maliyet/marj özeti: `Σ (miktar × bileşenin purchasePrice)` vs `ürünün salePrice`
- Hammadde sekmesi: `isSellable=false` ürünler

Sunucu hataları kullanıcıya olduğu gibi gösterilebilir — Türkçe ve açıklayıcı yazıldı (birim uyuşmazlığı, döngü zinciri, mükerrer bileşen).

### 7 — Kahveci satış ekranı `/restoran/satis`

`components/satis/quick-sale-screen.tsx`'ten **ödeme kutusu** ve **fiş yazdırma** ayıklanıp paylaşılacak; ürün ızgarası ve sepet kahveciye özgü yazılacak.

**Tekrar yazma — mevcut ekranda zaten var:** cari opsiyonel (satır 918 "perakende için boş bırakın"), park edilen satış (`Ticket` tipi, satır 103), bölünmüş ödeme (`splitMode`, satır 183).

Yetersizlik uyarısı için istemcide `expandRecipeLines` çağrılır — sunucunun kullandığı **aynı saf fonksiyon**, bu yüzden uyarı ile fiili düşüm hiçbir zaman çelişmez.

Kaydetme: `POST /api/e-donusum/invoices` + `isReceipt: true`. Reçete genişletmesi sunucuda zaten çalışıyor, ek bir şey göndermeye gerek yok.

### 8 — Dört rapor

`/restoran/karlilik`, `/restoran/menu-performans`, `/restoran/tuketim`, `/restoran/gun-sonu`.

Reçete hareketlerini ayırma anahtarı: `stock_movements.description LIKE '%Reçete:%'` (yazım: `"{fişNo} - Reçete: {mamül adı}"`), belge bağı `reference = invoice.id`.
Maliyet: `Σ |quantity| × "unitPrice"`.
Desen: `app/api/raporlar/kar-zarar/route.ts` — tek `$queryRaw`.
Grafik için ortak bileşen yok; mevcut rapor ekranları bar'ları elle CSS ile çiziyor (`raporlar/satis/page.tsx:167-189`).

---

## Karar dışı bırakılan / hatırlanacak

- **ÖKC/yazarkasa** konusu hâlâ açık ve ticari olarak en kritik risk — satıştan önce konumlandırma kararı gerekiyor (bkz. PLAN.md "Açık riskler").
- Modifier/seçenek sistemi ("soya sütü", "ekstra shot") v1'de yok; boy sorunu "her boy ayrı ürün" ile çözüldü.
- `Product.category` hâlâ serbest metin, FK değil — menü sekmeleri buna dayanacak.
