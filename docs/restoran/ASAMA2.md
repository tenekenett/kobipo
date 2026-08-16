# Restoran & Kafe — Aşama 2: Masa, adisyon ve salon planı

> v1 karar kaydı: [PLAN.md](./PLAN.md) "Adım 7" · v1 sonrası sadeleştirme: [SADELESTIRME.md](./SADELESTIRME.md)
> Bu belge Aşama 2'nin kararlarını ve uygulama sırasını tutar.

## Neden

v1 kahveci içindi: kasiyer menüye basar, ödeme alınır, fiş çıkar. Masalı bir yerde
akış farklıdır — sipariş **saatlerce açık kalır**, garson ekler, masa değişir,
hesap sonda istenir. Bunun tek eksik parçası **adisyon**: kapanana kadar yaşayan,
masaya bağlı bir çalışma kaydı.

---

## Alınan kararlar

| Konu | Karar | Gerekçe |
|---|---|---|
| Adisyon modeli | Yeni `RestaurantTicket` (+`RestaurantTicketItem`) | PLAN.md Adım 7. `Order` teslim tarihli resmî bir belge; adisyonla aynı tabloda yaşatmak ikisini de bozar |
| Kapanış | Mevcut fiş yolu (`isReceipt: true`) | v1'in tüm zinciri (stok düşümü, reçete genişletme, iptal, raporlar) zaten buradan geçiyor — ikinci bir satış yolu açmıyoruz |
| **Stok ne zaman düşer** | **Adisyon KAPANINCA** | Kalem eklerken düşmek, her kalem silmede ters hareket demek; iptal/stok tarihçesi adisyon boyu şişer. Yetersiz stok uyarısı yine canlı gösterilir (uyar, engelleme) |
| Yerleşim (koordinat) | **Masa satırında** (`x/y/width/height/shape`) | PLAN.md "firma bazlı Json plan" diyordu — **bilinçli sapma**, gerekçe aşağıda |
| Bölge/salon | Ayrı `RestaurantArea` tablosu | "Bahçe/Üst Kat" sekmeleri; masa adı firma genelinde tekil |
| Adisyon numarası | `ADS-YYYY-NNNN`, firma bazlı sayaç | Fiş numarasından ayrı; adisyon fişe dönüşünce fiş kendi numarasını alır |
| Kalem silme | Adisyon AÇIKKEN serbest, kapandıktan sonra yok | v1'de mutfak/kasa ayrımı yok; ürün mutfağa gitmeden önce silmek normal iş |

### Neden koordinat masanın satırında (PLAN.md'den sapma)

PLAN.md yerleşimi Etiket Tasarımcısı desenine bakarak firma bazlı bir `Json` alanında
tutmayı öngörüyordu. Etikette bu doğru: oradaki öğelerin **kimliği yok**, tasarım tek
parça bir belgedir. Masanın ise kimliği var — DB satırı, açık adisyonu, cirosu.

Yerleşim ayrı bir JSON'da dursaydı her masa **iki yerde** yaşardı ve ikisi kaçınılmaz
olarak ayrışırdı (masa silindi, JSON'da kaldı; JSON'a elle masa eklendi, karşılığı yok).
Sürükle-bırak da tek satırlık `PATCH /api/restoran/masalar/:id {x,y}` yerine tüm planı
yeniden yazmayı gerektirirdi. Etiket tasarımcısından **alınan** şey desen değil, editör
mekaniği (ızgaraya oturma, sürükleme, seçim) — o kısım yeniden yazılmayacak.

### Neden stok kapanışta düşer

Kalem eklendiğinde düşmek "canlı stok" verir ama bedeli ağır: 3 saat açık kalan bir
masada eklenen/silinen her kalem bir stok hareketi + ters hareketi demek. Bunlar AVCO'ya
girmez (fiyatsız yazılır) ama tüketim raporunu ve hareket listesini okunmaz hale getirir.
Kapanışta düşmek, v1'in kanıtlanmış yolunu (fiş → reçete genişletme → stok) aynen
kullanır ve iptal davranışı da beklendiği gibi kalır.

**Sonucu:** açık adisyondaki mallar stoktan düşmüş görünmez. Kritik hammadde uyarısı bu
yüzden açık adisyonları da hesaba katarak gösterilir (Faz C).

---

## Veri modeli

```
RestaurantArea      bölge/salon      (companyId, name, order)
RestaurantTable     masa             (companyId, areaId?, name, capacity, shape, x,y,w,h)
RestaurantTicket    adisyon          (companyId, tableId?, code, status, guestCount,
                                      openedAt/By, closedAt/By, invoiceId?, customerId?)
RestaurantTicketItem adisyon kalemi  (ticketId, productId?, description, unit,
                                      quantity, unitPrice(NET), vatRate, note)
```

Kararlar:

- **`tableId` opsiyonel** — paket/gel-al adisyonu masasız açılır.
- **`unitPrice` NET (KDV hariç)** — fatura API'si net bekliyor; ekranda brüt gösterilir.
  Kahveci ekranındaki `grossPrice` mantığının aynısı (bkz. `cafe-sale-screen.tsx`).
- **Kalem adı kopyalanır** (`description`) — ürün adı sonradan değişse adisyon değişmez.
- **`invoiceId` tekil** — kapanan adisyon tek fişe bağlanır; fiş iptal edilirse adisyon
  `CANCELLED` olur (fiş iptali stoğu zaten geri alıyor).
- Masa **silinmez, pasifleştirilir** (`isActive`) — geçmiş adisyonlar masasız kalmasın.

---

## Fazlar

| Faz | Kapsam | Durum |
|---|---|---|
| **A** | Şema + migration + API (bölge/masa CRUD, adisyon aç/kalem/kapat) + testler | ✅ 2026-07-29 |
| **B** | Salon planı ekranı `/restoran/masalar` — sürükle-bırak yerleşim, durum renkleri | ✅ 2026-07-30 |
| **C** | Adisyon ekranı — menü ızgarası, kalem ekleme, kapanış → ödeme → fiş | ✅ 2026-07-30 |
| **D** | Raporlara bağlanma: gün sonunda açık adisyonlar, ortalama masa süresi/sepet | ✅ 2026-07-30 |

Faz A'dan sonra ekran olmadan da uçtan uca çalışıyordu (API üzerinden adisyon açılıp
kapatılıyor, fiş kesiliyor, stok düşüyor); B ve C bunun üstüne oturdu.

---

## Faz A — Uygulandı (2026-07-29) ✅

### Şema ve migration

`prisma/schema.prisma` + `supabase/migrations/20260729000001_restaurant_tables.sql`
(idempotent, DB'ye uygulandı). Dört tablo: `restaurant_areas`, `restaurant_tables`,
`restaurant_tickets`, `restaurant_ticket_items`. Mevcut hiçbir tablo değişmedi —
yalnız `invoices` ve `customers`'a geriye dönük ilişki eklendi.

### Uçlar

| Uç | Ne yapar |
|---|---|
| `GET/POST /api/restoran/bolgeler` · `PATCH/DELETE /bolgeler/[id]` | Bölge yönetimi. Bölge silinince masalar bölgesiz kalır (silinmez) |
| `GET/POST /api/restoran/masalar` · `PATCH/DELETE /masalar/[id]` | Masa + yerleşim. `GET` masaları **açık adisyon özetiyle** döndürür (plan tek çağrıda çizilir); `PATCH {x,y}` sürükle-bırak |
| `GET/POST /api/restoran/adisyonlar` | Açık adisyon listesi / adisyon açma |
| `GET/PATCH/DELETE /adisyonlar/[id]` | Görüntüle · not-kişi-müşteri-**masa taşıma** · iptal |
| `POST /adisyonlar/[id]/kalemler` · `PATCH/DELETE /kalemler/[itemId]` | Kalem ekle (ürün kartından fiyat kopyalanır, aynı ürün birleşir) · düzelt · sil |
| `GET/POST /adisyonlar/[id]/kapat` | `GET` fiş gövdesini hazırlar, `POST {invoiceId}` adisyonu fişe bağlayıp kapatır |

**Modül kapısı:** Aşama 2 uçlarının **hepsi** `assertRestaurantModule` ile korunuyor
(`restaurant` kapalıysa 403). v1'in altı ucu hâlâ korumasız — kapı artık hazır olduğu
için oraya da eklemek tek satır (bkz. SADELESTIRME.md "Sırada ne var").

### Kapanış neden iki adımlı

Fişi adisyon ucu **kendisi kesmiyor**: `GET .../kapat` fiş gövdesini hazırlıyor, istemci
onu `/api/e-donusum/invoices`'a gönderiyor, sonra `POST .../kapat {invoiceId}` adisyonu
bağlayıp kapatıyor. Sebep: stok düşümü, reçete genişletme, cari ve muhasebe fişi o tek
yolda birlikte yürüyor — ikinci bir satış yolu açmak v1'de doğrulanmış her şeyi yeniden
yazmak olurdu.

Çift kapanış SUNUCUDA engelleniyor (`updateMany(status:"OPEN")` → ikinci istek 0 satır
günceller, 409 alır) ve `invoiceId` tekil olduğu için tek fiş iki adisyona bağlanamıyor.

### Doğrulama — `node scripts/test-restoran-adisyon.mjs`

Gerçek uçlara gerçek HTTP ile gider (mock yok). Oturum, NextAuth'un kendi `encode`'uyla
üretilen JWT çerezidir — giriş ekranından ve reCAPTCHA'dan geçmeye gerek kalmıyor, env
dosyaları ve kod değişmiyor. Test verisi Demo Firma'da oluşup **sonunda temizleniyor**.

| Kontrol | Sonuç |
|---|---|
| Bölge/masa CRUD, aynı ad çakışması | ✅ 409 |
| Otomatik yerleşim (yeni masa üst üste binmiyor) | ✅ `(0,0)` vs `(3,0)` |
| Sürükle-bırak `PATCH {x,y}` | ✅ |
| Adisyon numarası | ✅ `ADS-2026-0001` |
| Aynı masada ikinci adisyon | ✅ 409 + **mevcut adisyonu döndürüyor** (ekran onu açar) |
| Fiyat/KDV ürün kartından kopyalanıyor | ✅ net `85` · %20 |
| Aynı ürün tek satırda birleşiyor (2+1=3) | ✅ · notlu kalem ayrı satır ✅ |
| Toplam (KDV dahil) | ✅ `408` |
| Masa taşıma · dolu masaya taşıma | ✅ · ✅ 409 |
| Boş adisyon kapatma | ✅ 400 |
| Salon planı özeti adisyon tutarıyla aynı | ✅ `102` |
| Fiş notu adisyonu işaretliyor | ✅ `ADS-2026-0001 · Masa T…-2` |
| **Kapanışta stok düştü (reçete genişledi)** | ✅ süt `19,4 → 19,2` |
| İkinci kapatma / kapalıya kalem ekleme | ✅ 409 · ✅ 409 |
| Modül kapalıyken uç | ✅ 403 |
| Temizlik | ✅ fiş silindi, süt `19,4`'e döndü, kalan kayıt 0 |

**33 kontrolün tamamı geçti.** `tsc --noEmit` ve `eslint` temiz.

---

## Faz B + C — Uygulandı (2026-07-30) ✅

### Ekranlar

| Adres | Ne yapar |
|---|---|
| `/restoran/masalar` | **Salon planı.** Bölge sekmeleri, ızgara üzerinde masalar, doluluk (tutar + süre + kalem sayısı), üstte "N masa · M dolu · açık hesap toplamı" |
| `/restoran/adisyon/[id]` | **Adisyon.** Solda menü ızgarası, sağda kalemler + toplam, "Hesabı Kapat" → ödeme → fiş |

Salon planı menüye **Masalar** olarak eklendi (Restoran & Kafe grubunun ilk sırası).
Adisyon ekranı menüde YOK — masadan girilir; ama modül kapısında var, elle yazılan
adres de `restaurant` kapalıyken kilitleniyor.

### İki kip (kullanım / düzenleme)

Salon planında masaya dokunmak **kullanım** kipinde adisyon açar, **düzenleme**
kipinde masayı taşır/ayarlar. Tek kip olsaydı masayı sürüklemeye çalışan her
dokunuş yanlışlıkla adisyon açardı.

Sürükleme `pointer` olaylarıyla (fare + dokunmatik tek yol), bırakınca ızgara
hücresine oturur ve **yalnız değiştiyse** `PATCH {x,y}` gider. Sürükleme sonrası
tarayıcının ürettiği `click` 4 piksellik eşikle eleniyor — aksi halde her taşıma
bırakıldığı anda düzenleme diyaloğunu da açıyordu.

Masa taşıma **iyimser** güncelleniyor: kart parmağın bıraktığı yerde kalır, sunucu
yanıtı beklenirken eski yerine geri zıplamaz.

### Boş masaya dokununca 409 gelirse

Sunucu "bu masada zaten açık adisyon var" derken **mevcut adisyonu da döndürüyor**;
ekran hata göstermek yerine doğrudan o adisyona gidiyor. Aynı masaya iki garsonun
dokunduğu gerçek durumda kullanıcı bir şey fark etmiyor.

Salon planı 20 saniyede bir kendini tazeliyor (`useTables`): masa doluluğunu başka
bir cihaz değiştirebilir.

### Ortaklaştırılan iki parça (kopya değil, AYRIŞMA riski)

| Yeni ortak dosya | Kim kullanıyor | Neden |
|---|---|---|
| `components/restoran/menu-grid.tsx` | Kahveci Satış + Adisyon | "Menüde hangi ürün görünür" (aktif + satılabilir + hizmet değil) tek yerde. İki kopya olsaydı biri `isSellable`'ı unuttuğu an kasiyer bir ekranda görüp diğerinde göremezdi |
| `lib/satis/submit-receipt-sale.ts` | Kahveci Satış + Adisyon kapanışı | Fiş kesme + tahsilat. En tehlikeli ayrıntı burada: tahsilat tutarı istemcinin yuvarlanmamış toplamından değil, **faturanın sunucuda kayıtlı toplamından** gelir |

Kahveci Satış ekranı bu iki parçaya bağlandı; davranışı değişmedi, 950 satırdan
803'e indi.

### Doğrulama

**`node scripts/test-receipt-sale.mjs` — 19/19** (DB/sunucu gerekmez; `fetch`
sahte uçla değiştirilip GİDEN istekler inceleniyor):

| Kontrol | Sonuç |
|---|---|
| Fiş gövdesi (`isReceipt` + `MANUAL` + gönderim yok, net fiyat) | ✅ |
| **Tahsilat sunucunun toplamından** (istemci `306,004` derken sunucu `306`) | ✅ `306` |
| Sunucu toplam vermezse yedek toplam 2 haneye yuvarlanır | ✅ |
| Veresiye → hiç tahsilat yazılmaz | ✅ tek çağrı |
| Parçalı ödeme → her parça ayrı tahsilat, toplamı tutuyor | ✅ `206 + 100` |
| Fiş oluşmazsa tahsilat denenmez (yan etki yok) | ✅ |
| Tahsilat hatasında fatura çağırana döner (fiş silinmez) | ✅ |

**`node scripts/test-restoran-adisyon.mjs` — 37/37** (gerçek uçlar; Faz A'nın 33
kontrolüne dört ekran kontrolü eklendi). Sayfalar oturumla çağrılıp 200 dönmesi
doğrulanıyor: salon planı, adisyon, **Kahveci Satış (refactor sonrası)** ve Menü.

Ayrıca mevcut betikler bozulmadı: `test-recipe-expand` 45/45 · `test-payment` 25/25
· `test-module-gating` 20/20 · `test-avco-revert` 15/15. `tsc --noEmit` ve `eslint`
temiz.

### Elle bakılmayan

Ekranların **görüntüsü** ve sürükle-bırak hissi tarayıcıda gözle doğrulanmadı
(kullanıcı tercihi: tarayıcı testi istendiğinde yapılır). Sunucu tarafı, veri yolu
ve sayfa render'ı yukarıdaki testlerle doğrulandı.

---

## Dükkan krokisi + bölüm ayrımı (2026-07-30) ✅

Kullanıcı isteği: *"masa dizaynı konusunda dükkan krokisi tarzı bir durum da olabilir…
ayrıca tümünde diğer bölgeler de alt alta gözüksün."*

### 1. Kroki öğeleri — yeni `RestaurantPlanItem`

Duvar, kapı, bar, mutfak, WC, merdiven, bitki ve serbest yazı. Masayla **aynı ızgara
koordinatını** kullanırlar (aynı sürükle-bırak, aynı `PATCH {x,y}`) ama ayrı tablodadırlar.

Neden ayrı tablo: masanın kimliği var (adisyon, ciro, kapasite), duvarın yok. Aynı
tabloda yaşasalardı her "masaları getir" sorgusu duvarları elemek zorunda kalırdı ve
"N masa · M dolu" sayacına duvar karışması an meselesiydi.

Kroki **adisyon akışına girmez**: masaların ALTINDA çizilir ve kullanım kipinde
`pointer-events-none` — garson duvara basıp yanlışlıkla adisyon açamaz. Yalnız düzenleme
kipinde taşınır, etiketlenir, boyutlandırılır, silinir.

`areaId` üzerinde **CASCADE** (masadaki SetNull'ın aksine): bölge silinince krokisi de
gider. Masa korunur çünkü geçmiş adisyonları vardır; duvarın geçmişi yoktur.

Öğe türüne göre varsayılan ölçüler (`planItemDefaults`): duvar `8×1`, bar `6×2`, mutfak
`5×4`, kapı `2×1`… Kullanıcı "duvar" deyip 8 hücrelik bir çizgi alıyor, sonra uzatıyor.

| Uç | Ne yapar |
|---|---|
| `GET/POST /api/restoran/plan` | Kroki öğelerini listele / ekle |
| `PATCH/DELETE /api/restoran/plan/[id]` | Taşı, boyutlandır, etiketle / sil |

### 2. "Tümü"de bölgeler alt alta

Önceki hâlde "Tümü" sekmesi tüm bölgelerin masalarını **tek tuvale** çiziyordu — bu
yanlıştı: koordinat bölge içinde anlamlı, iki bölgenin `(0,0)`'ı aynı yer değil, masalar
üst üste binerdi.

Artık her bölge **kendi tuvalinde, alt alta bölüm** olarak çiziliyor; başlığında bölge
adı ve "N masa · M dolu" özeti var. Boş bölümler gizleniyor. Düzenleme kipinde her
bölümün kendi "Masa" ve kroki ekleme düğmeleri var — hangi bölgeye eklendiği tahmine
kalmıyor.

### Doğrulama — `node scripts/test-restoran-adisyon.mjs` (47/47)

| Kontrol | Sonuç |
|---|---|
| Duvar eklendi, varsayılan ölçü uzun | ✅ `8×1` |
| Bar etiketiyle eklendi | ✅ "Kahve barı" |
| Geçersiz öğe türü | ✅ 400 |
| Duvar taşındı + uzatıldı | ✅ `@(2,5) · 12 hücre` |
| Kroki öğeleri bölgeye bağlı (bölüm ayrımının kaynağı) | ✅ |
| İki bölgeye dağılmış masalar ayrı sayılıyor | ✅ `2 masa` / `1 masa` |
| Temizlik | ✅ kalan kroki öğesi 0 |

`tsc --noEmit` ve `eslint` temiz.

---

## Faz D — Uygulandı (2026-07-30) ✅

Adisyon artık **ölçülüyor**. İki ayrı soru, iki ayrı yer:

### 1. Gün sonunda açık kalan masalar (mevcut gün sonu raporuna eklendi)

Açık adisyon fişe dönüşmediği için ciroda **yok** ve malzemesi stoktan **düşmedi**
(stok kapanışta düşer — yukarıdaki "Neden stok kapanışta düşer"). Gün sonu sayımı
yapan kişi bunu bilmezse kasada olmayan parayı arar.

Rapor artık `openTickets` + `summary.openTicketCount/openTicketTotal` döndürüyor;
ekranda amber bir kart olarak listeleniyor (masa, süre, kalem sayısı, tutar) ve her
satır adisyona link. Tutar **ciroya eklenmiyor**, ayrı alanda duruyor.

**Kritik ayrıntı — `status` alanına bakılmıyor.** `status` ANLIK bir alandır: dün
23:00'te açık olan masa bugün kapanmıştır ve artık `CLOSED` görünür. Geçmiş bir gün
sorulduğunda doğru soru zaman aralığıdır:

```
openedAt <= gün_sonu  AND  (closedAt IS NULL OR closedAt > gün_sonu)
```

İptaller hariç: ne ciroya döndüler ne stok düşürdüler. Ortak yardımcı
`loadOpenTickets` (`lib/restoran/reports.ts`) — toplam `ticketTotals` ile hesaplanır,
SQL'de ikinci bir formül yazılmadı: adisyon ekranı, salon planı ve rapor aynı sayıyı
göstermek zorunda.

### 2. Yeni "Masalar" rapor sekmesi

`GET /api/restoran/raporlar/masalar` + `components/restoran/reports/masalar.tsx`.
Diğer dört rapor ÜRÜNE bakar (ne satıldı, ne kazandırdı); bu MASAYA bakar.

| Ölçü | Tanım |
|---|---|
| Ortalama masa süresi | `closedAt − openedAt`, kapanan adisyonlarda |
| Ortalama sepet | fiş toplamı (KDV dahil) / adisyon |
| Masa devir hızı | adisyon sayısı / **aktif** masa sayısı |
| Kişi başı ortalama | yalnız `guestCount` girilmiş adisyonlardan |
| Kırılımlar | masa · bölge · açılış saati (yoğunluk grafiği) |

Kararlar:

- **Tarih ekseni kapanış (`closedAt`)** — diğer raporlar belge tarihini kullanır;
  burada ölçülen şey masanın boşaldığı andır. Pratikte ikisi aynı ana denk gelir
  (fiş adisyon kapanırken kesiliyor).
- **Ciro fatura satırından gelir**, adisyon kalemlerinden değil: kesin tutarı
  (iskonto, yuvarlama) fatura ucu hesaplıyor. İptal/dönüştürülmüş fişler `reportScope`
  ile aynı şekilde dışlanıyor.
- **Devir hızının paydası aktif masa sayısı** — kaldırılmış (pasif) bir masa bugünkü
  devir hızını düşürmemeli.
- **Süresi negatif çıkan adisyon ortalamaya girmez** (saat düzeltmesi/elle müdahale);
  0 saymak ortalamayı sessizce aşağı çekerdi.
- Masasız (paket/gel-al) adisyonlar hem masa hem bölge kırılımında **kendi satırında**
  toplanır; bölgesiz masalar "Bölgesiz" kovasına düşer — aksi halde bölge toplamları
  genel toplamı tutmaz ve kullanıcı farkı arar.
- Saat yerel: `localHour` (`AT TIME ZONE 'Europe/Istanbul'`), `localDay` ile aynı
  dönüşüm. "En yoğun saat 20:00" derken kastedilen TSİ 20:00'dir.

**Yeni uç modül kapısından geçiyor** (`assertRestaurantModule`). v1'in dört rapor ve
iki reçete ucu hâlâ korumasız — ayrı iş, bkz. SADELESTIRME.md "Sırada ne var";
yenisini açık bırakmadık.

### Doğrulama — `node scripts/test-restoran-adisyon.mjs` (68/68)

Faz A–C'nin 47 kontrolüne 21 yeni kontrol eklendi (gerçek uçlar, gerçek HTTP):

| Kontrol | Sonuç |
|---|---|
| Masa cirosu **fişin toplamıyla** aynı | ✅ `102` vs `102` |
| Masa tek adisyon saydı · ortalama sepet = ciro | ✅ |
| Masa süresi ölçüldü (negatif değil) | ✅ |
| **Açık adisyon masa raporuna GİRMİYOR** | ✅ masa 1 yok |
| Devir hızı · saat yoğunluğu | ✅ 2 aktif masa · 1 dilim |
| Gün sonunda açık adisyon listelendi | ✅ `ADS-2026-0002` |
| Açık tutar adisyon ekranıyla aynı | ✅ `204` |
| **Kapanan adisyon açık listesinde YOK** | ✅ |
| **Açık hesap ciroya EKLENMEDİ** | ✅ ciro `102` = fişler, açık `204` hariç |
| **Bir hafta önceki günde bugünün açık adisyonu yok** (`status` tuzağı) | ✅ |
| Masalar / gün sonu sekmeleri render | ✅ HTTP 200 |
| Modül kapalıyken masa raporu | ✅ 403 |

Mevcut betikler bozulmadı: `test-receipt-sale` 19/19 · `test-recipe-expand` 45/45 ·
`test-payment` 25/25 · `test-module-gating` 20/20 · `test-avco-revert` 15/15.
`tsc --noEmit` ve `eslint` temiz.

> Not: Next 16'da `next lint` kaldırıldı; lint artık `npx eslint <dosyalar>` ile
> çalıştırılıyor (`npm run lint` hata veriyor).

### Elle bakılmayan

Ekranların **görüntüsü** tarayıcıda gözle doğrulanmadı (kullanıcı tercihi). Veri yolu
ve sayfa render'ı yukarıdaki testlerle doğrulandı.

---

## Devamı: kroki editörü 2. tur (2026-08-01)

Salon planı bu belgeden sonra bir tur daha gördü — kare/ölçekli tuval, tutamaçtan
boyutlandırma, kalem modu, çoklu plan yönetimi, masa durumları (hesap istendi /
temizlenecek / rezerve), rezervasyon tablosu ve adisyon birleştirme:
**[KROKI-EDITORU.md](./KROKI-EDITORU.md)**.

Aşağıdaki "kapsam dışı" listesinden **hesap bölme** ve **masa taşıma** o turdan önce,
**birleştirme** o turda kapandı.

---

## Kapsam dışı (bu aşamada değil)

- **Mutfak ekranı / adisyon yazıcısı** — sipariş mutfağa düşmüyor, kalem "hazırlanıyor"
  durumu yok.
- **Hesap bölme (split)** — masanın hesabını kişiye/kaleme bölmek. Model buna hazır
  (kalem bazlı), ekran işi ayrı.
- **Garson/personel bazlı ciro** — `openedBy` yazılıyor ama rapor yok.
- **ÖKC/yazarkasa** — PLAN.md "Açık riskler" 1; hâlâ ticari karar bekliyor.
