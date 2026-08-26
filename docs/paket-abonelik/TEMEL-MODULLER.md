# Temel (ücretsiz) modüller — "herkeste açık gelen" modül kümesi

**Durum:** kod tarafı bitti (şema + sunucu + arayüz + testler). Kalan: migrasyonun canlıya
uygulanması ve panelden ilk seçim. **Tarih:** 2026-08-26

---

## Neden

`docs/paket-abonelik/MODUL-KILIDI.md` ile kurulan düzende modül **yalnızca satın almayla**
açılıyordu: yeni firma yedi modülün hepsi kapalı doğuyor, ilk giriş `LockedAccount`
ekranına düşüyordu. Ürün kararı değişti — bazı modüller temel sayılıp herkese ücretsiz
verilecek, ve bu **kodda sabit değil, sistem yönetiminden yönetilebilir** olacak.

## Karar

- Ücretsizlik işareti `PricingItem.isFree` alanında durur. Her yönetilebilir modülün zaten
  bir `PricingItem` satırı var (`module:sales`, …) ve sistem-admin fiyat tablosu bu
  satırları düzenliyor; ayrı bir tablo/ayar anahtarı **ikinci bir kaynak** yaratırdı.
- Ücretsizlik **abonelikten bağımsızdır**: aboneliği hiç olmayan, süresi dolmuş ya da
  kilitlenmiş hesapta da açıktır.
- Ücretsiz modül `Subscription.purchasedModules`a **yazılmaz**. Yazılsaydı modül sonradan
  ücretliye çevrildiğinde o hesapta "satın alınmış" görünür ve bedava açık kalırdı.
- Bir modülün **gereksinimi ücretli kalamaz**: Restoran & Kafe ücretsiz yapılmak istenirse
  Stok da ücretsiz olmalı (yoksa bağımlılık tamamlama ücretli modülü bedavaya açar).
- İşaret değişince **mevcut hesaplar da hizalanır** — kural yalnız yeni firmalara
  işlemez, "herkese ücretsiz" gerçekten herkes demektir.

## Akış

```
sistem-admin → Paket & Fiyat Yönetimi → Tekil Fiyatlar → "Ücretsiz" kutusu → Kaydet
   │
   ├─ PUT /api/billing/pricing
   │     ├─ doğrulama: kota kalemi ücretsiz olamaz, gereksinimi ücretli olan modül olamaz
   │     ├─ PricingItem.isFree yazılır
   │     └─ syncFreeModuleGrants(önceki, sonraki)  → MEVCUT firmaların disabledModules'ı
   │
   ├─ yeni firma      → createCompany → defaultDisabledModules(free)  (ücretsizler açık)
   ├─ her yetki yazma → applyEntitlements → granted ∪ free            (hiç kapanmaz)
   └─ satın alma      → computeOrder → ücretsiz modül satır üretmez, tutara girmez
```

## Dosyalar

| Dosya | Ne yapar |
|---|---|
| `prisma/schema.prisma` → `PricingItem.isFree` | İşaretin tek kaynağı. |
| `supabase/migrations/20260826000003_pricing_item_is_free.sql` | Kolonu ekler; kota kalemlerinde false'a sabitler. Yeni tablo yok → RLS satırı gerekmez. |
| `lib/modules.ts` | Saf kurallar: `sanitizeFreeModules` (bağımlılık kuralı, fixpoint), `defaultDisabledModules`, `isAccountLocked(disabled, free)`. |
| `lib/billing/free-modules.ts` **(yeni)** | Kümeyi okur (`getFreeModuleKeys`, 10 sn süreç içi önbellek + `invalidateFreeModuleCache`), `freeModulesFromPricingItems`, `paidDependenciesOf`. |
| `lib/billing/free-modules-sync.ts` **(yeni)** | `freeModuleDelta` + saf `planFreeModuleSync` + DB'ye yazan `syncFreeModuleGrants`. Ayrı dosya, çünkü hem free-modules'ı hem entitlements'ı okuyor (döngüsel import olmasın). |
| `lib/billing/entitlements.ts` | `applyEntitlements` ücretsizleri ekler (tek çoke point); `setAccountModules` onları `purchasedModules`tan ayıklar ve `durable` hesabını ücretliye göre yapar. |
| `lib/company/create-company.ts` | Yeni hesap/ek firma `defaultDisabledModules(free)` ile doğar. |
| `lib/billing/pricing.ts` | `computeOrder` ücretsizi ücretlendirmez; `resolvedModules` (satın alınan) dışında tutar, `freeModules` alanıyla ayrı döner. |
| `lib/billing/order-amount.ts` | Kümeyi SUNUCUDAN okur — istemcinin "bu bende ücretsiz" iddiasına bakılmaz. |
| `app/api/billing/pricing/route.ts` | `isFree` yazımı + iki doğrulama + hizalama; yanıtta `sync` özeti. |
| `app/api/billing/catalog/route.ts` | Müşteri ekranına `freeModules` verir; ücretsiz kalem pasif olsa da listede kalır. |
| `components/system-admin/package-admin.tsx` | "Ücretsiz" sütunu (yalnız modül satırlarında), fiyat alanları kilitlenir, kaç firmanın hizalandığı toast'ta. |
| `components/system-admin/company-modules-card.tsx` | Ücretsiz modülün anahtarı devre dışı — firma bazında kapatmak `applyEntitlements` tarafından geri alınırdı. |
| `app/(dashboard)/ayarlar/abonelik/page.tsx` | "Ücretsiz" rozeti, seçimden çıkarılamaz, tutara girmez. |
| `components/dashboard/locked-account.tsx` | Ücretsizler "satın alınacaklar" listesinden çıkar, "hesabınızda açık" satırında görünür. |
| `app/(dashboard)/dashboard/{,admin,sales,stock,accountant,viewer}/page.tsx` | Kilit kontrolü ücretsiz kümeyi alır. |
| `lib/modules.test.ts`, `lib/billing/pricing.test.ts` **(yeni)**, `lib/billing/free-modules-sync.test.ts` **(yeni)** | 28 yeni test. |

## Doğrulama

```bash
npx tsc --noEmit    # temiz
npx vitest run      # 43 dosya / 494 test geçti
npm run check:company-create   # firma oluşturma tek yolda
```

Testlerin baktığı asıl asimetri: hata hep **para** yönüne düşüyor. "Satın alınmış modülü
kapatma", "ücretsizi purchasedModules'a yazma", "ücretsizin ücretli bağımlılığını bedavaya
açma" ayrı ayrı sınandı.

## Kalan iş

1. Migrasyonu canlıya uygula (kullanıcı çalıştırır):
   ```bash
   node scripts/apply-migration.js supabase/migrations/20260826000003_pricing_item_is_free.sql
   ```
2. Sistem yönetimi → **Paket & Fiyat Yönetimi → Tekil Fiyatlar**'dan temel modülleri
   işaretle. Kaydettiğinde mevcut firmalar da hizalanır (toast kaç firma olduğunu söyler).
3. Elle uçtan uca: ücretsiz modülün (a) yeni firmada açık doğduğu, (b) süresi dolmuş
   hesapta kapanmadığı, (c) satın alma ekranında "Ücretsiz" göründüğü ve tutara girmediği.

## Bilinen sınırlar (bilinçli)

- **Her modül ücretsiz yapılırsa kilit kavramı ortadan kalkar** — `isAccountLocked` false
  döner, `LockedAccount` hiç görünmez. Doğru davranış: satılacak bir şey kalmamıştır.
- **Paket içeriğine dokunulmadı.** Ücretsiz bir modül bir `Plan.includedModules` içinde
  kalmaya devam eder ve satın alınan kümede sayılır — bedeli paket fiyatına dahildir, o
  yüzden ücretsizlik kalkarsa müşteri hakkını kaybetmez.
- **Hizalama tüm firmaları tarar.** Bugün hesap sayısı küçük; `planFreeModuleSync` yalnız
  değişen firmaları yazıyor ve yazma 100'lük parçalara bölünüyor, ama okuma tek seferde
  tüm `companies` tablosunu çekiyor. Ölçek büyürse sorguyu `disabledModules` içeriğine
  göre daraltmak gerekir.
- **Ücretsizken verilen yeni sipariş, o modülü satın alınan kümeden düşürür.** Modülü
  daha önce ÖDEYEREK almış bir hesap, modül ücretsizken yeni bir sipariş verirse
  `purchasedModules` o anahtarsız yeniden yazılır; ücretsizlik sonradan kalkarsa modül
  kapanır. Bugün kabul edildi (ücretsizliğin geri alınması nadir ve bilinçli bir karar);
  düzeltmek istenirse `computeOrder` "hâlihazırda satın alınmış" kümeyi de girdi almalı.
- **Ücretsiz modülün fiyat alanı korunur.** Kaydederken alan kilitleniyor ama eski değer
  DB'de duruyor; ücretsizlik kalkınca aynı fiyat geri gelir.
