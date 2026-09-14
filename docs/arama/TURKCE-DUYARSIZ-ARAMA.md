# Türkçe duyarsız arama — teşhis ve uygulama planı

Durum: **UYGULANDI** (2026-09-14). Kural CLAUDE.md'de ("Arama Türkçe duyarsızdır");
bu dosya teşhisi ve kararın gerekçesini saklar.

Plandan tek SAPMA: **migrasyon yok.** `tr_fold()` veritabanı fonksiyonu yerine
`translate()` ifadesi sorguya gömüldü (`lib/db/tr-search.ts`, harf tablosu TS'ten).
Sebep: fonksiyon canlıya bağımlılık ve deploy sırası tuzağı ekliyordu — migrasyon
deploy'dan önce uygulanmazsa cari listesi "function tr_fold does not exist" ile
düşecekti. `LIKE '%x%'` zaten index kullanamadığı için fonksiyonun performans
faydası da yoktu. İleride ifade index'i istenirse migrasyon O ZAMAN yazılır.

## Şikâyet

"Müşteri arama kısmında Türkçe karakter (I harfi vb.) duyarlı değil; hiçbir yerde
bu sorun yaşanmamalı."

## Teşhis (koddan; sonradan canlı Postgres'te de doğrulandı)

Kök neden iki katmanda aynı: **I/ı ve İ/i** harfleri Türkçe kuralla küçültülmüyor.

- **Postgres `ILIKE`** (cari listesi bunu kullanıyor — `lib/cari/list-query.ts`;
  Prisma `mode: "insensitive"` de ILIKE üretir): `lower('I') = 'i'`,
  `lower('ı') = 'ı'`. Yani `'IŞIK' ILIKE '%ışık%'` **false**; `'Işık' ILIKE '%IŞIK%'`
  de false (`işık` ≠ `işik`). Kayıt büyük harfle girilmişse küçük harfle aranınca
  bulunmuyor — kullanıcının gördüğü tam olarak bu.
- **JS `toLowerCase()`** aynı hatayı yapar; üstüne `"İ".toLowerCase()` iki kod
  birimi ("i" + birleşik nokta U+0307) üretir, "i" ile hiç eşleşmez.
- `toLocaleLowerCase("tr")` kullanan yerler I/ı'yı doğru küçültür ama kullanıcı
  Türkçe harfsiz ("isik", "sisli") yazınca yine bulmaz.

Canlıda doğrulandı (2026-09-14, `scripts/tr-arama-kontrol.ts`): 12 örnekte
Postgres `lower(translate(...))` ile JS `trFold()` birebir aynı anahtarı üretiyor.

## Karar

Arama iki yanı da **aynı anahtara indirger**: büyük/küçük harf VE Türkçe aksan
farkı yok sayılır — `ı/i/İ/I → i`, `ş → s`, `ğ → g`, `ü → u`, `ö → o`, `ç → c`,
`â → a`, `î → i`, `û → u`; kalanı `lower`. Bu, repoda ZATEN 5+ yerde kopyalanmış
`norm()` yardımcısının kuralıdır (`components/ui/*-combobox.tsx`,
`lib/data/turkish-cities.ts`, `lib/data/units.ts`) — tek yere toplanıp her arama
oradan geçer. Yalnız ARAMA/EŞLEŞTİRME içindir; görüntülenen metne dokunmaz.

Neden `unaccent` uzantısı / ICU collation değil:
- `unaccent` uzantı ister, IMMUTABLE değildir, canlıya bağımlılık ekler.
- ICU (`tr-x-icu`) collation yalnız büyük/küçük harfi çözer, aksanı çözmez ve
  ~15 sütunda ALTER gerektirir.
- Açık `translate` tablosu uzantısız, deterministik, JS tarafıyla birebir aynı.

## Uygulama

### 1) Tek kaynak: `lib/text/tr-fold.ts` (saf, istemcide de çalışır)

```ts
export function trFold(value: string | null | undefined): string
  // önce harf tablosu (İ'yi toLowerCase'e sokmadan!), sonra .toLowerCase()
export function trMatcher(term: string): (...fields: Array<string | number | null | undefined>) => boolean
  // terim BİR kez katlanır; boş terim her şeyi eşler
```

`lib/text/tr-fold.test.ts`: `IŞIK`/`ışık`/`Işık`/`isik` hepsi aynı anahtar;
`İstanbul` = `istanbul` = `ISTANBUL`; `Şişli` = `sisli`; boş/null → "".

### 2) SQL karşılığı: gömülü `translate` (migrasyon YOK)

```sql
lower(translate(btrim(<sütun>), 'IİıŞşĞğÜüÖöÇçÂâÎîÛû', 'iiissgguuooccaaiiuu'))
```

19 ↔ 19 karakter; tablo `lib/text/tr-fold.ts`ten (`TR_FOLD_FROM`/`TR_FOLD_TO`)
geliyor, yani JS ile SQL aynı sabiti paylaşıyor. `btrim`, JS tarafındaki
`.trim()`in karşılığıdır.

Ölçüm (SALT OKUR, veri okumaz — var olmayan bir companyId ile sorguları Postgres'e
ayrıştırtır):

```bash
npx tsx scripts/tr-arama-kontrol.ts              # SQL sağlaması + tablo eşitliği
npx tsx scripts/tr-arama-kontrol.ts --firma=<id> # gerçek veride arama sonucu
```

`lib/text/tr-fold.canli.test.ts` (`npm run test:canli`) aynı eşitliği test olarak
sabitler: bir örnek kümesinde `SELECT lower(translate(...))` ile `trFold()`
karşılaştırılır, iki tablo ayrışırsa orada görünür.

### 3) Sunucu yardımcısı: `lib/db/tr-search.ts`

```ts
trLikePattern(term)                     // trim + \ % _ kaçır + iki yana %
trFoldAnyLike(columns, pattern)         // Prisma.sql: (tr_fold(a) LIKE tr_fold($1) OR ...)
                                        // sütun adı doğrulanır (Prisma.raw parametrelemez)
trContainsIds({ table, columns, companyId, term })         // id ön-süzgeci
trEqualsIds({ table, companyId, fields: { name, code } })  // eşitlik (içe aktarım)
trSearchDistinctValues({ table, column, companyId, term }) // ör. gönderici adları
```

Prisma `where` içine SQL fonksiyonu sokulamadığı için Prisma sorguları **iki
adım** çalışır: önce raw ön-süzgeç id listesi, sonra `id: { in: ids }`. Liste
her zaman BOYUT tablosuyla sınırlı tutulur (müşteri/tedarikçi/ürün/gönderici
adı), olgu tablosuyla (fatura satırları) DEĞİL — aksi halde "a" araması on
binlerce fatura id'si üretir ve bind parametre sınırına çarpar.

### 4) Değişecek sunucu noktaları

| Dosya | Bugün | Olacak |
|---|---|---|
| `lib/cari/list-query.ts` (4 blok) | `ILIKE ${searchLike}` | `trFoldAnyLike(["c.name","c.nickname","c.code","c.taxNumber","c.email"], pattern)` |
| `lib/asistan/veri/urun.ts:391` | `ILIKE ${like}` | `trFoldAnyLike([...], pattern)` |
| `app/api/stok/products/route.ts` | Prisma OR contains ×4 | `where.id = { in: await trContainsIds(products: name, code, barcode, shelfCode) }` |
| `lib/export/datasets/products.ts` | aynı OR | aynı ön-süzgeç (ekran = Excel) |
| `app/api/personel/employees/route.ts` | OR contains ×4 + nationalId | `OR: [{ id in trContainsIds(employees: firstName,lastName,department,position) }, { nationalId contains }]` |
| `lib/faturalar/list-query.ts` | `customer.is.name contains`, `supplier.is.name`, `senderName contains` | `customerId in trContainsIds(customers: name)`, `supplierId in ...(suppliers)`, `senderName in trSearchDistinctValues(incoming_invoices.senderName)`; `partyIs()` müşteri/tedarikçi için ayrı id listesi alır. `invoiceNo`/`eDocumentNo`/`uuid` ILIKE olarak KALIR (ASCII). |
| `lib/integrations/e-invoice/incoming-list-query.ts` | `senderName contains` (sender + q) | `senderName in ...`; `buildIncomingFilterConditions/Where/WhereWithoutDate` **async** olur ve `companyId` alır. Çağıranlar: `app/api/e-donusum/inbox/route.ts` (2), `lib/export/datasets/gelen-e-faturalar.ts`, `lib/otomasyon/veri/yanit-bekleyen-fatura.ts`. `status equals insensitive` KALIR (ASCII). |
| `lib/raporlar/stok-hareket.ts` | `product: { OR contains ×3 }` | `productId in trContainsIds(products: name, code, barcode)` |
| `lib/import/apply.ts` (ürün + cari aday havuzu) | `equals insensitive` | `id in trEqualsIds(...)`; **`lib/import/rows.ts` → `comparable()` de `trFold`e geçer** — havuz ile `pickMatch` aynı kuralı kullanmalı, yoksa "SEKER" satırı havuza girer ama seçilmez ve ürün ikinci kez açılır. Sonuç: içe aktarım aksan duyarsız eşleşir ("SEKER" → "Şeker" günceller). `rows.test.ts` + `apply.canli.test.ts`e Türkçe örnek eklenir. |

### 5) Değişecek istemci / bellek-içi noktalar (hepsi `trFold`/`trMatcher`)

Yerel `norm()` kopyaları silinir:
`components/ui/{unit,text,search-select,product,city}-combobox.tsx`,
`lib/data/turkish-cities.ts` (`normalizeCity`), `lib/data/units.ts` (`normTrUnit`),
`components/e-donusum/{category,product,counterparty,tax-type,withholding}-combobox.tsx`
(product-combobox'ta boyut ayracı silme mantığı korunur, yalnız `toLowerCase` → `trFold`),
`components/dashboard/menu-search.tsx`,
`components/restoran/{menu-grid,tickets-screen,table-list-screen}.tsx`,
`components/system-admin/{user-table,company-table,access-log-table,subscription-admin}.tsx`,
`components/stok/label-designer/{print-dialog,preview-product-picker}.tsx`,
`app/(dashboard)/{alis/irsaliye,alis/siparis,alis/teklif,satis/irsaliye,satis/siparis,personel,personel/zimmet,restoran/menu,raporlar/stok}/page.tsx`,
`lib/asistan/veri/cari.ts` (`cariAra`), `lib/export/datasets/reports.ts` (stok raporu
dışa aktarımı — ekranla aynı süzgeç), `lib/import/rows.ts` (`normalizeHeader`).

Kapsam DIŞI bırakılanlar (arama değil, bilinçli): `access denied` mesaj
karşılaştırmaları, e-posta normalizasyonu, klavye kısayolları, etiket metinleri,
`lib/fis-ocr` ürün adı eşleme haritası ve `invoice-editor.tsx`teki kod/ad eşitliği
(ayrı iş: OCR/gelen satır eşleştirmesi; istenirse aynı `trFold` ile).

### 6) Doğrulama

- `npm test` (tr-fold + rows testleri), `npx tsc --noEmit`.
- Migrasyon uygulandıktan sonra `npm run test:canli` (SQL ↔ JS tablo eşitliği,
  içe aktarım Türkçe örnek).
- Tarayıcı: cari listesinde `IŞIK`, `ışık`, `Işık`, `isik` dördü de aynı kartı
  bulmalı; fatura editörü müşteri seçicisinde de aynı.

### 7) Yapıldı

1. `lib/text/tr-fold.ts` (+ 15 test) ve `lib/db/tr-search.ts`; migrasyon yerine
   gömülü `translate` (yukarı bak).
2. Cari listesi (şikâyetin geldiği yer), ürün/personel/fatura/gelen e-fatura/stok
   hareket aramaları, içe aktarım eşleştirmesi — 4. tablodaki tüm sunucu noktaları.
3. 5'teki istemci noktalarının tamamı; yerel `norm()` kopyaları silindi
   (`trFold` kullanan dosya: 35, `tr-search`: 9).
4. `lib/text/tr-fold.canli.test.ts` + `lib/import/apply.canli.test.ts`e Türkçe
   örnekler; `scripts/tr-arama-kontrol.ts`; CLAUDE.md bölümü.

Doğrulandı: `npm test` (1139 geçti), `npx tsc --noEmit`, `npm run build`,
`npx tsx scripts/tr-arama-kontrol.ts` (SQL ↔ JS 12 örnekte birebir).
KALAN: tarayıcıda elle e2e — cari listesinde `IŞIK` / `ışık` / `Işık` / `isik`
dördü de aynı kartı bulmalı; `npm run test:canli` (canlı DB'ye yazar).
