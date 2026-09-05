# Finansal raporlar — düzeltme ve genişletme planı

> Başlangıç: 2026-09-05. Referans: parasut.com ön muhasebe rapor seti.
> Sıra bağlayıcıdır: Faz 0 bugün ekranda **yanlış rakam** basan yerleri düzeltir,
> sonraki fazlar üstüne yeni rapor ekler.

## Neden

Kobipo'da mali tablolar (Kar/Zarar, Bilanço, Nakit Akış) **var ama menüde yok**:
`lib/nav/pages.ts`teki "Raporlar" grubunda 7 öğe var, bu üçü yok. Tek erişim yolu
pano → hızlı işlem kartı → `/raporlar` → `/raporlar/finansal` → rapor (üç tık,
ikisi menüsüz kavşak sayfası).

Ayrıca üç tablo da kendi içinde tutmuyor (ayrıntı Faz 0).

Paraşüt'e göre asıl eksik olan iki rapor: **kategori/etiket kırılımlı Gelir-Gider
(karlılık)** ve **ileriye dönük nakit akışı projeksiyonu**. Her ikisinin de veri
modeli Kobipo'da zaten hazır (`Invoice.category`, `Invoice.tags[]`,
`Invoice.dueDate`, `dueWindowOf()`), sadece okuyan rapor yok.

---

## Faz 0 — Hesap hataları

### 0.1 `lib/raporlar/nakit-akisi.ts` — bakiye ekseni tutmuyor

Dört ayrı hata:

**(a) Dönem başı/sonu bakiyesi tarihe bakmıyor.**
`beginningBalance`, `createdAt < start` olan hesapların **bugünkü** bakiyelerinin
toplamı; `endingBalance` ise tarihten tamamen bağımsız bugünkü toplam. Yani
`beginningBalance + netCashFlow ≠ endingBalance` — tablo kendi içinde çelişiyor.

Düzeltme: bakiye tarihe göre geriye sarılır.
```
M(a→b)  = [a,b] aralığındaki net nakit hareketi
endingBalance    = Σ güncel bakiye (createdAt ≤ end)   − M(end→şimdi)
beginningBalance = Σ güncel bakiye (createdAt < start) − M(start→şimdi)
netCashFlow      = endingBalance − beginningBalance      (tanım gereği tutar)
```

**(b) Virman (TRANSFER) bacakları gelir sayılıyor.**
`app/api/finans/transactions/route.ts:249` hesaplar arası virmanda kaynak hesaba
`type=TRANSFER`, **hedef hesaba `type=INCOME`** kaydı yazıyor (`reference` =
`TRANSFER:<hesapId>`). `computeCashFlow` tüm INCOME'ı topladığı, TRANSFER'i ise
hiç saymadığı için kendi cebinden cebine para aktarmak nakit akışını şişiriyor.

Düzeltme: `reference LIKE 'TRANSFER:%'` olan INCOME/EXPENSE hareketleri
sınıflandırma dışında bırakılır (bakiye ekseninde net etkileri zaten sıfır).

**(c) Kanalsız fatura ödemeleri nakit sanılıyor.**
Rapor `transactionId: null` olan `InvoicePayment`leri "Transaction üretmeyen
doğrudan ödeme" varsayıyor. Oysa `app/api/faturalar/odemeler/route.ts:186`
kanal verildiğinde **daima** Transaction yazıyor; `transactionId` null demek
`accountId` de null demek, yani **hiç nakit hareketi olmamış** demek (fatura
"ödendi" işaretlenmiş ama kasa/banka seçilmemiş).

Düzeltme: `transactionId: null` **ve** `accountId: { not: null }` — yalnız eski
(Transaction yazılmadan önce girilmiş) gerçek kasa hareketleri.

**(d) `investingActivities` / `financingActivities` sabit 0.**
Sınıflandırma yok, satırlar boşuna duruyor ve tabloyu denkleştirmiyor.

Düzeltme: ikisi kaldırılır, yerine **denge kalemi** gelir:
`unclassified = netCashFlow − operatingActivities.net`. Dönem içinde açılan
hesabın devir bakiyesi, virman farkı ve elle bakiye düzeltmesi buraya düşer.
`isActive` süzgeci bakiye tarafından kalkar: hareketleri sayılan pasif hesabın
bakiyesi sayılmazsa denge yine bozulur.

### 0.2 `lib/raporlar/bilanco.ts` — öz sermaye anlamsız, aktif ≠ pasif

`bilanco.ts:145` öz sermayeyi şöyle buluyor:
```ts
prisma.accountingEntry.aggregate({ where: { companyId, date: { lte: date } }, _sum: { amount: true } })
```
Her yevmiye kaydının bir borç + bir alacak hesabı ve **tek** `amount`'ı var;
hepsini toplamak öz sermayeyi değil **toplam fiş hacmini** verir. Üstelik hesap
planı hiçbir yerde otomatik açılmıyor (`accountPlan.create` yalnız
`/api/muhasebe/hesap-plani`ta) ve otomatik fiş sadece satış faturasında yazılıyor
(`app/api/e-donusum/invoices/route.ts:670`) — çoğu firmada bu toplam ya 0 ya da
yalnız satışların yarısı. Dışa aktarmadaki "Denge → Fark" satırı bu boşluğu zaten
itiraf ediyor.

Düzeltme — öz sermaye üç parçaya ayrılır:
```
retainedEarnings  = başlangıçtan asOfDate'e kümülatif net kâr (computeProfitLoss)
adjustments       = (aktif − yükümlülük) − retainedEarnings   ← denge kalemi
equity.total      = aktif − yükümlülük                        ← tanım gereği tutar
```
"Sermaye ve diğer düzeltmeler" satırı, kârla açıklanamayan kısmı (kuruluş
sermayesi, ortak cari, kayıt dışı devir) görünür kılar; gizlemez.

Ek düzeltme: negatif alacak/borç **sıfıra kırpılıyor** (`> 0 ? : 0`) ve para
kayboluyor. Negatif alacak = müşteriden alınan avans → yükümlülüğe; negatif borç
= tedarikçiye verilen avans → varlığa taşınır.

### 0.3 `lib/raporlar/kar-zarar.ts` — satır adları hesabı anlatmıyor

- "Satılan Malın Maliyeti" aslında **dönemdeki tüm alış faturaları**. Stok alımı
  ≠ SMM; kira/danışmanlık gibi hizmet alışları da buraya düşüyor.
- "İşletme Giderleri" yalnız **faturasız** `EXPENSE` işlemleri.
- `otherIncome` virman bacaklarını (0.1b) içeriyor → ciro şişiyor.

Düzeltme: `costOfGoodsSold` → `purchases`, ekran ve dışa aktarmada "Alışlar (mal
ve hizmet)" / "Diğer Giderler (faturasız)"; virman bacakları hariç tutulur.

### 0.4 `lib/dashboard/admin-queries.ts` — pano rakamları

`getAdminStats` gelir/gideri **tarih süzgeci olmadan** (tüm zamanlar) ve virman
bacakları dahil topluyor; `getMonthlyCashflow` de virmanı sayıyor.

Düzeltme: iki sorgudan da `reference LIKE 'TRANSFER:%'` çıkarılır.

### 0.5 Nöbetçi testler

`lib/raporlar/*.test.ts` desenine uygun saf birim testleri:
- nakit akışı: `beginningBalance + netCashFlow === endingBalance`
- bilanço: `assets.total === liabilities.total + equity.total`
- virman bacağı ne kâr/zarara ne nakit akışına girer

---

## Faz 1 — Finansal pano + menü görünürlüğü

1. `lib/nav/pages.ts`e **"Finansal Raporlar" → `/raporlar/finansal`** girişi
   (roller: ADMIN, BRANCH_MANAGER, ACCOUNTANT, VIEWER). `lib/page-access.ts`
   sahiplik eşlemeleri ve `lib/nav/report-hubs.ts` açıklamaları güncellenir.
2. `/raporlar/finansal` link listesinden **panoya** dönüşür:
   - KPI kartları: dönem cirosu, brüt kâr, net kâr, açık alacak, açık borç,
     kasa+banka bakiyesi (hepsi mevcut `compute*` fonksiyonlarından)
   - 12 aylık gelir/gider/kâr sütun grafiği (`components/dashboard/revenue-chart`)
   - Vade özeti şeridi (yaşlandırmadan: vadesi geçmiş / 0-30 / 31-60 / 61-90)
   - Altta mevcut detay rapor kartları
3. Dönem seçici (bu ay / bu çeyrek / bu yıl / özel) tek bileşende, alt raporlara
   query ile taşınır.

## Faz 2 — Gelir-Gider (karlılık) raporu

Paraşüt'ün amiral gemisi. `Invoice.category` + `Invoice.tags[]` zaten dolu.

1. `lib/raporlar/gelir-gider.ts` (yeni, saf hesap + test):
   - **`netAmount`** üzerinden (KDV geliri değildir), iadeler düşülmüş
   - kırılım eksenleri: `category`, `tag`, `customer/supplier`, `month`
   - dönem karşılaştırması (önceki dönem / geçen yılın aynı dönemi), % değişim
2. `/api/raporlar/gelir-gider` **yeniden yazılır** (bugün ölü uç: ekranı yok,
   `totalAmount` topluyor, kırılımı yok).
3. `/raporlar/gelir-gider` ekranı: özet kartlar + kategori/etiket kırılım
   tabloları + pasta grafik + Excel/PDF dışa aktarma.

## Faz 3 — İleriye dönük nakit akışı

1. `lib/raporlar/nakit-projeksiyon.ts`: bugünkü kasa+banka bakiyesinden başlayıp
   `Invoice.dueDate`e göre açık alacak/borçları haftalara (12) ve aylara (12)
   dağıtan kümülatif eğri. Vadesi geçmiş ve vadesiz tutarlar ayrı sütunda.
   Kova mantığı `cari-yaslandirma-buckets.ts`ten yeniden kullanılır.
2. `/raporlar/nakit-akisi` ekranına "Projeksiyon" sekmesi; Faz 1 panosuna
   "gelecek 12 hafta" grafiği.

## Faz 4 — Gider kategorileri

1. Migrasyon: `Transaction.category String?` + `(companyId, category)` index
   (+ `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` gerekmez, mevcut tablo).
2. Gelir/gider işlem formuna kategori alanı (fatura kategorisiyle aynı desen:
   serbest metin + mevcut değerlerden öneri).
3. Harcamalar raporu: kategori bazlı gider dökümü; Faz 2 raporuna faturasız
   giderler de kategoriyle katılır.

---

## Uygulama durumu (2026-09-05)

### Faz 0 — TAMAM

- `lib/finans/nakit-hareket.ts` (yeni): bakiyeyi ne değiştirir, tek tanım.
  Virman bacağı (`TRANSFER:` önekli `reference`), eski Transaction'sız ödemeler
  ve tarihe göre bakiye geri sarımı burada.
- `lib/raporlar/nakit-akisi.ts`: yeniden yazıldı. Net akış artık iki bakiyenin
  FARKI (kimlik tanım gereği tutar); sınıflandırma farkı açıklar, açıklayamadığı
  kısım "sınıflandırılmamış" satırında durur. `investing`/`financing` kaldırıldı.
- `lib/raporlar/bilanco.ts`: öz sermaye yevmiye toplamından ÇIKARILDI; net varlık
  (aktif − yükümlülük) + kümülatif kâr + denge kalemi. Negatif cari bakiye artık
  kırpılmıyor, avans olarak karşı tarafa geçiyor. Nakit ve belge süzgeçleri
  tarihe uyuyor. Stok maliyetinde "alış fiyatı yoksa satış fiyatı" düşüşü kaldırıldı.
- `lib/raporlar/kar-zarar.ts`: `costOfGoodsSold` → `purchases` (satır adı hesabı
  anlatıyor), virman bacakları ciro dışı.
- `lib/dashboard/admin-queries.ts`: pano gelir/gider ve 6 aylık grafikten virman
  bacakları çıkarıldı.
- `lib/raporlar/date-range.ts`: `resolvePeriodBounds` — dönem sonu artık günün
  TAMAMINI kapsıyor (eskiden gece yarısı, o günün belgeleri düşüyordu).
- Saf birleştiriciler + nöbetçi testler: `nakit-akisi-ozet.ts`, `bilanco-ozet.ts`,
  `mali-tablo-denge.test.ts` (13 test).
- **Fazladan bulgu:** `/api/export/rapor-*` uçları, 2026-08-20'de `/api/raporlar/*`
  için kapatılan yetki açığının AÇIK kalmış yarısıydı — ekran kâr/zararı
  reddederken aynı veri Excel olarak indirilebiliyordu. Dört mali tablo dosyası
  uçlarıyla aynı dar kapıya bağlandı.

### Faz 1 — TAMAM

- `/raporlar/finansal` menüye eklendi (`lib/nav/pages.ts` + Raporlar grubu +
  ikon). Sahiplik eşlemeleri EKLENDİ, eskiler düşürülmedi: mevcut kısıtlı roller
  erişimini yitirmesin.
- Sayfa link listesinden PANOYA dönüştü: dönem seçici (bu ay / geçen ay / bu
  çeyrek / bu yıl / geçen yıl), KPI kartları (ciro, brüt kâr, net kâr, kasa+banka)
  önceki döneme göre % değişimle, açık alacak/borç kartları, 12 aylık trend
  grafiği, 12 haftalık projeksiyon grafiği, detay rapor kartları.
- `lib/raporlar/donem.ts` (saf, 11 test) + `lib/raporlar/finansal-ozet.ts` +
  `/api/raporlar/finansal-ozet` (tek çağrı).

### Faz 2 — TAMAM

- `lib/raporlar/gelir-gider-kirilim.ts` (saf, 12 test) + `gelir-gider.ts`.
- Ölü uç `/api/raporlar/gelir-gider` yeniden yazıldı: artık `netAmount`,
  kategori/etiket/cari/ay kırılımlı ve kâr/zararla AYNI ölçüyü kullanıyor.
- `/raporlar/gelir-gider` ekranı (4 sekme, pay çubukları, cari kartına link,
  kategorisiz uyarısı) + Excel/PDF dışa aktarma (`rapor-gelir-gider`).

### Faz 3 — TAMAM

- `lib/raporlar/nakit-projeksiyon-kova.ts` (saf, 10 test) + `nakit-projeksiyon.ts`
  + `/api/raporlar/nakit-projeksiyon`.
- `/raporlar/nakit-akisi` iki sekme oldu: **Tablo** (geçmiş) ve **Projeksiyon**
  (gelecek 12 hafta / 12 ay, darboğaz uyarısıyla).
- Veri yaşlandırmadan gelir — pano, projeksiyon ve yaşlandırma raporu aynı
  "vadesi geçmiş" rakamını gösterir.

### Faz 4 — TAMAM

- `supabase/migrations/20260905000002_transaction_category_tags.sql` +
  `prisma/schema.prisma`: `Transaction.category` / `tags[]` + index.
- `lib/finans/siniflandirma.ts`: kategori/etiket önerileri artık fatura VE kasa
  hareketlerinin BİRLEŞİMİ (iki form ayrı küme önerseydi "Kira"/"kira" raporu
  bölerdi). Fatura ucu da bu ortak fonksiyona bağlandı.
- `/api/finans/transactions/classifications` (yeni uç — veri aynı, ayrı olmasının
  sebebi yetki: kasa ekranı fatura izni olmadan açılabilir).
- Gelir/gider işlem formuna kategori alanı (virmanda sorulmaz).
- Gelir-gider raporu faturasız hareketleri artık KENDİ kategorileriyle sayıyor;
  kategorisi olmayan eskiler "Faturasız işlemler (kategorisiz)" satırında.

> Migrasyon 2026-09-05'te `prisma db push` ile uygulandı; sütunlar ve
> `transactions_companyId_category_idx` indeksi veritabanında doğrulandı.

### Faz 5 — Harcamalar Raporu (TAMAM)

İlk turda "gelir-gider raporunun kategori sekmesiyle çakışır" diye yazılmamıştı;
ayrı ekran istendi ve ÇAKIŞMAYACAK biçimde yazıldı — iki şey ekliyor:

1. **Kategori AĞACI.** Kategori metnindeki `>` ayracı ana/alt kırılım üretir:
   "Personel > Maaş" ve "Personel > SGK" tek başlıkta toplanır. Gelir-gider
   raporunun düz listesinde bu üç ayrı satırdır ve "personele toplam ne ödedim"
   sorusu cevapsız kalır. Ayraç yazmayanın kategorisi tek seviyeli kalır, hiçbir
   şey bozulmaz — ayrı bir sütun eklemek fatura/kasa ortak kategori kümesini
   ikiye bölerdi.
2. **Harcama defteri.** Alış faturaları + faturasız giderler tek listede, tarihe
   göre, belge ve cari kartına bağlı. Ağaçta bir kategoriye tıklamak listeyi
   süzer. Gelir-gider raporunda kalem düzeyi hiç yok.

Toplamlar gelir-gider raporuyla AYNI kaynaktan: etiket/tedarikçi/ay kırılımları
`gelir-gider-kirilim.ts`in saf `buildBreakdowns` fonksiyonundan geliyor, yalnız
ağaç bu rapora özgü (`harcamalar-kirilim.ts`, 15 test).

Ekranda defter 500 satırla sınırlı; dışa aktarma (`rapor-harcamalar`) sınırsız.

### Canlı veri doğrulaması — İKİ HATA DAHA ÇIKTI (düzeltildi)

Migrasyon sonrası hesaplar gerçek bir firmada salt-okuma çalıştırıldı; tip
denetiminin göremeyeceği iki hata çıktı. İkisi de Faz 0-4'te BENİM eklediğim
kodda:

**1. `NOT_TRANSFER_WHERE` referansı NULL olan hareketleri yutuyordu.**
`NOT: { reference: { startsWith: "TRANSFER:" } }` — SQL'in üç değerli mantığında
`NOT (NULL LIKE ...)` TRUE değil NULL üretir, satır süzgeçten geçemez. Referansı
olmayan hareketler çoğunluk olduğu için kâr/zarardaki "Diğer Gelirler", nakit
akışı, gelir-gider ve harcamalar raporu sessizce 0 basıyordu. Ölçüldü: 2.065.445 ₺
gelir ve 215.506 ₺ gider raporlarda hiç görünmüyordu. Prisma'nın
`reference: { not: { startsWith } }` biçimi de aynı tuzağa düşüyor — tek doğru
form açık NULL dalı taşıyan `OR`. Ham SQL yazılan yerler (pano sorguları, aylık
seriler) baştan doğruydu. Nöbetçi test: `mali-tablo-denge.test.ts`.

**2. `cashBalanceBefore` hesapları süzerken hareketleri süzmüyordu.**
Bakiye toplamı `createdAt < sınır` ile daraltılıyor ama geri sarılan hareketler
TÜM hesaplardan alınıyordu. Sınırdan sonra açılmış bir hesabın hareketleri, onun
bakiyesini içermeyen bir tabandan düşülünce olmayan bir eksi bakiye doğuyordu:
tek hesabı 2026'da açılmış bir firmada 2020 başlangıçlı dönem "dönem başı
−2.342.810 ₺" gösteriyordu (doğrusu 0). `cashMovementSince` artık aynı hesap
kümesini alıyor.

Düzeltme sonrası aynı firmada: dönem başı 0, dönem sonu 2.348.437,85,
sınıflandırılmamış 5.627 — ki bu tam olarak hesabın açılış devridir, yani denge
kalemi ne için varsa onu gösteriyor. Denge kimliği üç ayrı dönemde de tutuyor.

### Tarayıcı doğrulaması — bir hata daha (düzeltildi)

Beş ekran Chrome'da gezildi (pano, gelir-gider, harcamalar, nakit akışı iki
sekme, finans formu). Rakamlar salt-okuma smoke testiyle birebir aynı çıktı ve
ekranlar arası tutarlılık doğrulandı: panodaki ciro = gelir-gider raporundaki
gelir; gelir-gider raporundaki gider = harcamalar raporundaki toplam gider;
nakit akışında `0 + 2.348.437,85 = 2.348.437,85`.

Yalnız **trend grafiği geleceğe uzanıyordu**: seri dönem sonundan geriye 12 ay
sayıyordu, "Bu Yıl" seçiliyken dönem sonu 31 Aralık olduğu için eksen
Şub 26 → Oca 27 çıkıyor, dört boş gelecek ay çizilirken geçen yılın verisi hiç
görünmüyordu. Seri artık dönem sonu ile BUGÜN'ün erken olanında bitiyor
(`finansal-ozet.ts` → `seriesUntil`); eksen Eki 25 → Eyl 26 oldu.

Ekranlarda ayrıca doğrulananlar: harcama defterinde alış iadesi "iade" rozetiyle
ve yeşil eksi tutarla görünüyor; kategori seçicisi faturalardaki kategoriyi
("kira") kasa formunda öneriyor (ortak küme çalışıyor); Tip=Virman seçilince
kategori alanı gizlenip "Hedef Hesap" beliriyor.
