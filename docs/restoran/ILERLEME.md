# Restoran & Kafe Modülü — İlerleme Günlüğü

> Mimari kararlar ve gerekçeleri: [PLAN.md](./PLAN.md)
> Bu dosya "ne yapıldı, ne kaldı, nereden devam edilecek" kaydıdır.

**Son güncelleme:** 2026-07-26 (2. oturum sonu — Adım 6 bitti, Adım 7'den devam edilecek)

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

Doğrulama (ikisi de DB gerektirmez, saniyeler sürer):

```bash
node scripts/test-recipe-expand.mjs    # 33/33
node scripts/test-module-gating.mjs    # 20/20
npx tsc --noEmit                       # .next/types/validator.ts'teki 2 hata ESKİ, ilgisiz
```

**Modül varsayılan olarak KAPALI** (`optIn: true`). Ekranları görmek için bir firmaya elle açmak gerekiyor: `/system-admin/companies/[id]` → Modüller → "Restoran & Kafe". Stok da otomatik açılır.

**Test verisi hazır:** Demo Firma A.Ş.'de (`cmod4a8xz0001liqswmpjb6x2`) modül açık ve PLAN.md'nin
kurulum tablosu kurulu — Kahve Çekirdeği / Süt / Vanilya Şurubu / Espresso / Latte + 2 reçete.
Bozulursa `node scripts/seed-restoran-demo.mjs` ile geri kurulur (idempotent).
Demo Firma'da 2 test fişi var: `FS-SAT-2026-0001` (iptal edilmiş), `FS-SAT-2026-0002` (regresyon testi).

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
| 7 | Kahveci satış ekranı `/restoran/satis` | ⬜ Yer tutucu var ← **kaldığım yer** |
| 8 | Dört rapor ekranı | ⬜ Yer tutucu var |

Kalan nav sayfaları `ComingSoon` yer tutucusuyla mevcut — modül açıldığında hiçbir link 404 vermiyor.

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

## Doğrulama durumu

| Kontrol | Sonuç |
|---|---|
| `npx prisma validate` / `generate` | ✅ geçti |
| `npx tsc --noEmit` | ✅ yeni kodda hata yok |
| `node scripts/test-recipe-expand.mjs` | ✅ 33/33 |
| `node scripts/test-module-gating.mjs` | ✅ 20/20 |
| **Uçtan uca (canlı DB + tarayıcı)** | ✅ aşağıdaki tablo |

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

Senaryo 5 (yetersiz stok uyarısı) **7. adımın işi** — uyarı satış ekranında yaşayacak, henüz o ekran yok.

---

## ← KALDIĞIM YER: Adım 7 — Kahveci satış ekranı

### 7 — Kahveci satış ekranı `/restoran/satis`

Dosya: `app/(dashboard)/restoran/satis/page.tsx` (şu an `ComingSoon` yer tutucusu).

`components/satis/quick-sale-screen.tsx` (1.328 satır, **çalışıyor — geniş çaplı dokunma**) içinden
**ödeme kutusu** ve **fiş yazdırma** dar kapsamlı ayıklanacak; ürün ızgarası ve sepet kahveciye özgü yazılacak.

**Tekrar yazma — mevcut ekranda zaten çözülmüş** (satır numaraları 2026-07-26'da doğrulandı):

| Ne | Nerede |
|---|---|
| Cari opsiyonel ("perakende için boş bırakın") | `quick-sale-screen.tsx:918` |
| Park edilen satış (paralel sepetler) | `Ticket` tipi, `quick-sale-screen.tsx:103` |
| Bölünmüş ödeme (kalanı doldurma dahil) | `splitMode`, `quick-sale-screen.tsx:183` |
| Fiş yazdırma | `lib/fis/receipt-html.ts` + `lib/fis/receipt-template.ts` |

**Adım 6'dan hazır gelenler — bunları yeniden yazma:**

- `GET /api/stok/products?companyId=&isSellable=true` → menü ızgarası doğrudan bunu çağırsın.
  Filtre 6. adımda eklendi (`app/api/stok/products/route.ts`).
- Maliyet/genişletme deseni `app/(dashboard)/stok/receteler/page.tsx` içinde çalışır halde:
  `recipeMap` kurulumu (yalnız `isActive`), `unitOf`, `costOf`, `describeError`, `normalizeProduct`.
  **Kopyalamak yerine oraya bak** — yetersizlik uyarısı aynı yapıyı kullanacak.
- `normalizeProduct()` şart: `/api/stok/products` Decimal'leri **string** döndürüyor (bkz. 6. adım notu).

Yetersizlik uyarısı için istemcide `expandRecipeLines` çağrılır — sunucunun kullandığı **aynı saf fonksiyon**
(`lib/stock/recipe-expand.ts`), bu yüzden uyarı ile fiili düşüm hiçbir zaman çelişmez.
Sepet değiştikçe `lines: sepet` ile çağır, dönen `components` miktarlarını ilgili ürünün
`stockQuantity`'siyle karşılaştır. **Engelleme yok** — PLAN.md "Adım 4 → Yetersiz stok": kırmızı
uyarı çıkar ama Tamamla çalışır (kahvecide stok girişleri gecikir, engelleyici kontrol kasayı kilitler).

Kaydetme: `POST /api/e-donusum/invoices` + `isReceipt: true`. Reçete genişletmesi sunucuda zaten
çalışıyor ve **uçtan uca doğrulandı** — ek bir şey göndermeye gerek yok.

**Bu adımda birlikte halledilecek yan iş:** mevcut `/satis/hizli` ızgarası hâlâ hammaddeleri
(Kahve Çekirdeği, Süt, Espresso) gösteriyor; `?isSellable=true` filtresi hazır ama bağlanmadı.

PLAN.md **senaryo 5** (sütü 0,1 LT'ye düşür, 3 Latte sepete ekle → kırmızı uyarı çıkmalı ama
Tamamla çalışmalı) bu ekran bitince koşulacak — tek koşulmamış senaryo o.

### 8 — Dört rapor

`/restoran/karlilik`, `/restoran/menu-performans`, `/restoran/tuketim`, `/restoran/gun-sonu`.

Reçete hareketlerini ayırma anahtarı: `stock_movements.description LIKE '%Reçete:%'`, belge bağı `reference = invoice.id`.
**Gerçek satırlar 6. adımda DB'de doğrulandı** — desen tahmin değil:

```
Kahve Çekirdeği  -0.06  × 500  [OUT]  "FS-SAT-2026-0001 - Reçete: Latte"
Süt              -0.6   ×  30  [OUT]  "FS-SAT-2026-0001 - Reçete: Latte"
Vanilya Şurubu   -0.015 × 200  [OUT]  "FS-SAT-2026-0001 - Reçete: Latte"
```

Reçetesiz satışta açıklama `"{fişNo} - Satış faturası"` — LIKE bunu doğru şekilde dışarıda bırakıyor.
Maliyet: `Σ |quantity| × "unitPrice"` (unitPrice satış anında dondurulmuş).
Desen: `app/api/raporlar/kar-zarar/route.ts` — tek `$queryRaw`.
Grafik için ortak bileşen yok; mevcut rapor ekranları bar'ları elle CSS ile çiziyor (`raporlar/satis/page.tsx:167-189`).

---

## Karar dışı bırakılan / hatırlanacak

- **ÖKC/yazarkasa** konusu hâlâ açık ve ticari olarak en kritik risk — satıştan önce konumlandırma kararı gerekiyor (bkz. PLAN.md "Açık riskler").
- Modifier/seçenek sistemi ("soya sütü", "ekstra shot") v1'de yok; boy sorunu "her boy ayrı ürün" ile çözüldü.
- `Product.category` hâlâ serbest metin, FK değil — menü sekmeleri buna dayanacak.

### 6. adımda görülen, henüz yapılmamış işler

- **Mevcut Hızlı Satış ekranı `isSellable`'ı yok sayıyor.** `/satis/hizli` "Hızlı Ürünler" ızgarasında hammaddeler (Kahve Çekirdeği, Süt, Espresso) de görünüyor. Yeni `?isSellable=true` filtresi hazır; `quick-sale-screen.tsx`'e (1.328 satır) eklenmesi tek satırlık ama PLAN.md o dosyaya geniş dokunmamayı öneriyor — 7. adımda birlikte değerlendirilmeli.
- **Ürün formunda "Satışta göster" onay kutusu yok.** API dört yolda da (`POST`/`PUT`/`PATCH`/`GET` filtresi) destekliyor; `isSellable` şimdilik yalnızca reçete ekranındaki anahtardan değiştirilebiliyor. `/stok` ürün diyaloğuna eklenmeli (PLAN.md "Adım 2 → Yan etkiler").
- **Stok listesinde "Reçeteli" rozeti yok** (PLAN.md "Adım 2 → Yan etkiler"). Reçetesi olan ürünün `stockQuantity`'si anlamsız; `/stok` listesinde bu belirtilmiyor — reçete ekranında belirtiliyor.
- **Test ortamı notu:** `yasin.dikdere123@gmail.com` kullanıcısı doğrulama için Demo Firma A.Ş.'ye ADMIN olarak bağlandı (`UserCompany`). Gerekmiyorsa kaldırılabilir.
