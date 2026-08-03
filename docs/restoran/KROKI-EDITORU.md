# Salon planı 2. tur — kare kroki editörü, masa durumları, rezervasyon, birleştirme

**Tarih:** 2026-08-01 · **Önceki:** [ASAMA2.md](./ASAMA2.md) (Faz B — ilk salon planı)

## Neden

Kullanıcı geri bildirimi, birebir:

> "duvar mutfak düzenleme kısmı tıklayıp boyut girmekle değil de fiş tasarımında olduğu gibi
> kenarından köşesinden çekerek olmalı, şu anda tasarım yapması zor. kroki kısmı birden fazla
> ve eklenebilir olmalı ayrıca kare olmalı… tümü kısmında ön bahçenin arka bahçenin planını
> görebilmeliyiz."

İlk sürümde kroki öğesinin ölçüsü yalnız diyalogdan **sayı girerek** değişiyordu ve tuval,
içeriğe göre büyüyen bir **dikdörtgendi**. İkisi birlikte "krokiyi çizmek" işini
"koordinat hesaplamak" işine çeviriyordu.

Aynı oturumda kullanıcıya sorulan işletme soruları da karara bağlandı: masa durumları,
rezervasyon ve masa taşıma/birleştirme eklendi; masa QR'ı ertelendi.

---

## 1. Tuval artık KARE ve ölçekli

> **2026-08-02'de değişti** — tuval yataya döndü, kare değil. Sebebi ve yeni
> kurallar bu belgenin sonundaki *"Ek: tuval yataylaştı"* bölümünde; aşağıdaki
> ölçek/kaydırma kuralları geçerliliğini koruyor.

`grid × grid` hücre; hücrenin piksel boyu kapsayıcı genişliğinden türetilir
(`components/restoran/floor-plan-canvas.tsx`). Koordinat DB'de **hücre** cinsinden durmaya
devam ediyor — telefon, geniş ekran ve yazdırma aynı planı gösteriyor.

Kare olması bilinçli: dikdörtgen tuvalde "ne kadar yer var" sorusunun cevabı ekran oranına
bağlıydı, aynı plan geniş ekranda bol dar ekranda dolu görünüyordu.

Hücre `MIN_CELL`in (18px) altına inecekse tuval küçülmek yerine **kaydırmaya** geçer:
32'lik bir plan telefonda 8 piksellik hücrelere inip dokunulamaz hale gelmesin.

### Plan boyutu bölgede saklanır

`RestaurantArea.gridSize` (varsayılan 16, adımlar 10/12/16/20/24/32/40). Küçük kafe 12'de
kalır, çok masalı mekân 32'ye çıkar.

Küçültme **içeriği kesecekse reddedilir** (409): masayı zorla içeri çekmek yerleşimi
sessizce bozardı, bunun yerine "en fazla N hücreye kadar küçültülebilir" denir.

**"Bölgesiz" planın saklayacak satırı yok** → boyutu içeriğinden türetilir
(`requiredGrid`). Bu bir kısıt olduğu için editörde çıkış yolu var: *"Bu planı adlandır"*
düğmesi bölgeyi oluşturur ve bölgesiz masa/kroki öğelerini **tek işlemde** oraya taşır
(`POST /api/restoran/bolgeler` + `adoptUnassigned`). Tek tek PATCH atmak yarıda kalırsa
planı ikiye bölerdi.

## 2. Çoklu plan — "Tümü"de boş bölgeler de görünür

Bölgeler zaten ayrı tuvallere çiziliyordu ama **boş bölümler gizleniyordu**: yeni açılan
"Ön Bahçe" ilk masası konana kadar hiç görünmüyordu, eklenebilir olduğu hissedilmiyordu.
Artık her bölge kendi kare tuvaliyle listede duruyor.

Bakma kipinde geniş ekranda iki plan yan yana (`xl:grid-cols-2`), düzenleme kipinde tek
sütun: tuval ne kadar büyükse tutamaç o kadar rahat. *(2026-08-02: iki sütun kalktı, her
plan kendi satırını kaplıyor — bkz. ek bölüm.)*

Sekme şeridinden **Plan ekle**, bölüm başlığından **yeniden adlandır / boyut / sil**.
Bölge silmek masayı silmez (şemadaki `SetNull`), masalar "Bölgesiz"e düşer.

## 3. Tutamaçtan sürükle-boyutlandır

Seçili öğenin 8 kenar/köşe tutamacı var; jest boyunca ölçü canlı, bırakınca tek
`PATCH {x,y,width,height}` gider.

Matematik **etiket tasarımcısıyla ortak**: `lib/geometry/rect.ts`
(`applyResize`, `handleCursor`, `handleAnchor`, `RESIZE_HANDLES`). Daha önce yalnız
`lib/labels/geometry.ts` içindeydi; kopyalansaydı "batı tutamacı karşı kenarı sabit tutar"
kuralı bir tarafta düzeltilip diğerinde unutulurdu. Etiket tarafı hâlâ kendi modülünü
görüyor (yeniden dışa veriliyor), o ekranda hiçbir şey değişmedi.

Izgaraya oturtma `lib/restoran/floor-plan.ts`te: fark **önce tam hücreye yuvarlanır**,
sonra dikdörtgene uygulanır — ters sıra batı tutamacında titremeye yol açıyordu.

Diyaloglardaki **sayısal genişlik/yükseklik alanları kaldırıldı**; yerlerinde salt okunur
bir ölçü satırı var. Klavye de çalışıyor: ok tuşları taşır, `Shift`+ok boyutlandırır,
`Delete` siler, `Ctrl+D` çoğaltır.

## 4. Kalem modu (kullanıcı "ikisi birden" dedi)

Araç çubuğundan bir tür seçilir (Masa / Duvar / Kapı / Bar / Mutfak / WC / Merdiven /
Bitki / **Sedir** / **Dolap** / **Sahne** / Yazı — son üçü bu turda eklendi):

- **Tuvale sürükle** → öğe tam çizdiğiniz boyutta doğar
- **Tek tık** → aracın varsayılan boyutunda doğar (`planItemDefaults`)

Araç seçili kalır (`Esc` bırakır): arka arkaya duvar çizmek kafede en sık yapılan iş.

Masayı kalemle koyarken **ad sorulmaz**, sıradaki `M{n}` verilir; sonradan düzenlenir.
Her masada ad sormak 30 masalık bir salonu çizilemez hale getiriyordu.

## 5. Masa durumları

Plan artık beş durum gösteriyor (`components/restoran/plan-kinds.ts` → `tableState`):

| Durum | Nereden gelir | Davranış |
|---|---|---|
| Boş | — | Dokun → adisyon açılır (tek dokunuş, hızlı yol korunuyor) |
| Dolu | açık adisyon | Dokun → adisyona git |
| **Hesap istendi** | `RestaurantTicket.billRequestedAt` | Adisyon AÇIK kalır; yalnız planda öne çıkar |
| **Toplanacak** | `RestaurantTable.cleaningSince` | Kapanışta damgalanır; masayı **kilitlemez** |
| **Rezerve** | yaklaşan `RestaurantReservation` | Dokun → ne yapılacağı sorulur |

Sıra önemli: hesap istendi doluluğun önüne geçer (garson önce oraya gitmeli); temizlik ve
rezervasyon ancak masa boşken anlamlıdır.

**Temizlik için ayar yok, bilinçli.** Damga masayı kilitleseydi bu akışı kullanmayan bir
işletmede her masa iki dokunuş isterdi. Yeni adisyon damgayı kendiliğinden temizler; ayrıca
"Masa toplandı" ile elle de temizlenir. Yani kullanmayan hiçbir bedel ödemez.

Renk tek başına bırakılmadı: hesap istendi masada ayrıca **ikon** taşır (renk körlüğü).

"Hesap istendi" adisyon ekranındaki **İşlemler** tepsisinden veriliyor — o ekranın kuralı
"yeni yetenek düğme olarak eklenmez" (SATIS-EKRANI.md K1/K8).

## 6. Rezervasyon

Yeni tablo `restaurant_reservations`. Adisyondan **ayrı** yaşar: adisyon "şu an oturan"ı
anlatır ve ciroya girer, rezervasyon henüz gerçekleşmemiştir. Aynı kayıtta yaşasalardı her
ciro sorgusu "olacak" hesapları elemek zorunda kalırdı ve gün sonuna hayalet masa girerdi.

- Masa seçmek **zorunlu değil**: "cumartesi 20:00, 6 kişi" masası belli olmadan alınır.
- Bitiş saati saklanmaz, `durationMin`den türetilir (iki alan ayrışırdı). Bu yüzden
  çakışma kontrolü tek SQL sorgusuyla sorulamıyor; ±8 saatlik pencere çekilip bellekte
  karşılaştırılıyor (masa başına günde birkaç kayıt).
- `SEATED`e **yalnız adisyon açılışıyla** geçilir (`POST /adisyonlar` + `reservationId`).
  El ile verilebilseydi hiçbir adisyona bağlı olmayan "oturdu" kayıtları birikir,
  rezervasyon–ciro bağı anlamını yitirirdi. Uç bunu 409'la reddediyor.
- Plan yalnız **yaklaşan** rezervasyonu gösterir (geçmişte 30 dk, gelecekte 6 saat);
  yoksa plan yarın akşamın kayıtlarıyla dolardı.

Rezerve masaya dokununca "rezervasyonu oturt / rezervasyonsuz aç / gelmedi" sorulur —
gelen geçen müşteriyi otomatik oturtmak rezervasyonu yakardı.

## 7. Masa taşıma ve birleştirme

Kullanım kipinde **dolu masayı başka masanın üstüne bırakın**:

- Hedef boşsa → **Taşı** (`PATCH /adisyonlar/[id] {tableId}` — bu uç zaten vardı)
- Hedef doluysa → **Birleştir** (`POST /adisyonlar/[id]/birlestir` — yeni)

Birleştirmede kalemler **taşınır, kopyalanmaz**: kopyalasaydık aynı ürün iki adisyonda
görünür, ikram/zayi sayımı ve stok düşümü ikiye katlanırdı. Kalem sırası hedefin sonundan
devam eder.

Kaynak adisyon silinmez: `CANCELLED` + **`mergedIntoId`**. İptalden ayırt edilmesi şart
çünkü cirosu kaybolmadı, hedefe geçti — rapor ve ekran bu alana bakıp "iptal" değil
"birleştirildi" diyebilir.

Kaynağın iskontosu düşer (yüzde + tutar karışımı tek hesapta toplanamaz); hedefin notuna
`ADS-xxxx birleştirildi` izi yazılır ve onay diyaloğunda bu açıkça söylenir.

## 8. Masa boş bekleme süresi (rapora eklendi)

Masalar raporu bugüne kadar yalnız "hesap ne kadar sürdü"yü ölçüyordu. Devir hızını
artırmanın en ucuz yolu masa eklemek değil, **masanın boşta geçirdiği zamanı kısaltmaktır**;
o rakam hiç görünmüyordu.

**Ölçüm geçmiş veriden türetiliyor — yeni alan yok.** Aynı masada ardışık iki adisyon
arasındaki boşluk, SQL'de tek bir pencere fonksiyonuyla çıkıyor:

```sql
LAG(t."closedAt") OVER (PARTITION BY t."tableId", <yerel gün> ORDER BY t."openedAt")
```

`cleaningSince` kullanılmadı bilerek: o alan ANLIK durumu tutar, temizlenince geçmişi
kalmaz. Adisyon geçmişi ise hem zaten var hem de **geriye dönük** çalışıyor — rapor eski
verilerde de dolu geliyor.

İki eleme kuralı var, ikisi de rakamı anlamlı tutmak için:

- **Gün değişimi sayılmaz** (pencere yerel güne bölünüyor): yoksa her masaya her gece
  "12 saat boş bekledi" yazardı.
- **120 dakikadan uzun boşluklar sayılmaz** (`IDLE_MAX_MINUTES`): öğle servisi 14:00'te
  biten masanın 19:00'da açılması "5 saat bekledi" değildir, orada servis yoktur. Elenen
  boşluk sayısı ekranda açıkça yazıyor, rakam sessizce kırpılmıyor.

Ekranda: **"Ortalama boş bekleme"** kutusu (+ kaç devirde toplam ne kadar ölü zaman),
masa tablosunda **"Ort. boş"** ve **"Toplam boş"** sütunları, bölge kartlarında bölge
ortalaması.

---

## Veri modeli değişiklikleri

`supabase/migrations/20260801000001_floor_plan_and_table_states.sql` (tamamı eklemeli):

| Tablo | Alan | Ne için |
|---|---|---|
| `restaurant_areas` | `gridSize` | Kare krokinin kenar uzunluğu |
| `restaurant_tables` | `cleaningSince` | "Toplanacak" damgası |
| `restaurant_tickets` | `billRequestedAt` / `billRequestedBy` | "Hesap istendi" |
| `restaurant_tickets` | `mergedIntoId` | Birleştirme izi (iptalden ayrı) |
| `restaurant_reservations` | *(yeni tablo)* | Rezervasyon |

## Uçlar

| Uç | Ne yapar |
|---|---|
| `POST /api/restoran/bolgeler` | `gridSize`, `adoptUnassigned` eklendi |
| `PATCH /api/restoran/bolgeler/[id]` | `gridSize` (içeriği kesecekse 409) |
| `GET /api/restoran/masalar` | `cleaningSince`, `billRequestedAt`, yaklaşan `reservation` |
| `PATCH /api/restoran/masalar/[id]` | `cleaned` (damga bas/sil) |
| `PATCH /api/restoran/adisyonlar/[id]` | `billRequested` |
| `POST /api/restoran/adisyonlar/[id]/birlestir` | **yeni** — iki açık adisyonu birleştirir |
| `GET/POST /api/restoran/rezervasyonlar` | **yeni** |
| `PATCH/DELETE /api/restoran/rezervasyonlar/[id]` | **yeni** |
| `GET /api/restoran/raporlar/masalar` | boş bekleme alanları (`avgIdleMinutes`, `idleMinutes`, `idleGaps`, `idleSkipped`) |

## Doğrulama — `node scripts/test-restoran-adisyon.mjs` (110/110)

Betiğe beş bölüm eklendi. Öne çıkanlar:

| Kontrol | Sonuç |
|---|---|
| Bölge varsayılan ızgarayla geliyor | ✅ `16` |
| İçeriği kesecek küçültme reddedildi | ✅ 409 "en fazla 14 hücreye kadar" |
| Uçuk ızgara üst sınıra oturdu | ✅ `40` |
| Kalemle çizilen öğe verilen ölçüde doğdu | ✅ `SOFA 5×2 @(3,9)` |
| Adisyon kapanınca masa kendiliğinden "toplanacak" oldu | ✅ |
| Yeni adisyon damgayı temizledi (masa kilitlenmiyor) | ✅ |
| Hesap istendi işaretlendi ve plana yansıdı | ✅ |
| Çakışan rezervasyon reddedildi | ✅ 409 "09:46 TEST Misafir" |
| "Oturdu" el ile verilemiyor | ✅ 409 |
| Plan yaklaşan rezervasyonu masada gösteriyor | ✅ `120 dk` |
| Kalemler hedefe geçti, kaynak "birleştirildi" izi taşıyor | ✅ |
| Adisyon kendisiyle birleştirilemiyor | ✅ 400 |
| Aynı masadaki iki devir arasındaki boşluk ölçüldü | ✅ `1 boşluk · ort 2,2 dk` |
| Masasız (paket) adisyonlar boş bekleme üretmiyor | ✅ 3 paket adisyon, 0 boşluk |
| Günün ilk adisyonundan önce boşluk sayılmıyor | ✅ |

`tsc --noEmit` ve `eslint` temiz.

## Elle bakılmayan

- **Tarayıcıda gözle doğrulama yapılmadı** (kullanıcı tercihi: Chrome doğrulaması
  varsayılan değil). Sürükleme/tutamaç jestleri gerçek dokunmatikte denenmedi.
- **Rezervasyon raporu yok**: "rezervasyondan gelen ciro", "gelmeme oranı" ölçülebilir
  (`ticketId` bağı duruyor) ama ekranı yok.
- **Boş bekleme saat bazında kırılmıyor**: masa ve bölge ortalaması var, "akşam 20:00'de
  masalar ortalama 25 dk boş bekliyor" sorusunun cevabı yok. Aynı veriden çıkar.
- **`IDLE_MAX_MINUTES` sabit (120 dk)**: işletmeye göre ayarlanamıyor. Kahvaltı+akşam
  çalışan bir mekânda doğru, tek servisli bir yerde gereğinden dar olabilir.
- **Birleştirme raporlara yansımıyor**: `mergedIntoId` yazılıyor, gün sonu raporu bu
  adisyonları hâlâ iptal gibi sayıyor.
- **Masa QR'ı ertelendi** (kullanıcı "şimdilik gerekmiyor" dedi).

---

## Ek: tuval yataylaştı (2026-08-02)

Kullanıcı geri bildirimi: *"tek bölge yatayda sayfayı kaplamalı."* Kare tuval geniş
ekranda kartın ortasında yüzen küçük bir kareye dönüşüyor, iki yanında açıklanamayan
boşluk bırakıyordu. Kareyi büyütmek de çare değil: 2000px genişliğinde kare tuval 2000px
uzar, plan ekrandan taşar.

**Yeni model — saklanan tek ölçü SÜTUN sayısı.** `RestaurantArea.gridSize` artık kenar
değil **sütun** sayısı. Satır sayısı saklanmaz ve sabit bir orana da bağlı değildir;
tuvalde, kutunun kendi ölçüsünden çıkar:

```
minCols = max( gridSize, requiredCols(içerik) )        // zorunlu genişlik
minRows = contentRows(içerik)                          // zorunlu derinlik
cell    = floor(min( kutu / minCols, bütçe / minRows )) // 1) hepsi sığsın
cols    = max( minCols, floor(kutu / cell) )           // 2) artan yer ZEMİN olsun
rows    = max( minRows, floor(bütçe / cell) )
```

Yani **saklanan sütun sayısı bir alt sınırdır**, hedef değil: ızgara ekranda yer olduğu
sürece sağa ve aşağı uzar. Anahtar fikir, artan yeri boşluk değil *kullanılabilir zemin*
saymak — kullanıcının istediği de buydu ("kenarlara koyacak bir şey bulamadım, kullanıcıya
daha fazla alan bırakmış oluruz").

Önce iki yaklaşım denendi ve bırakıldı:

1. **Sabit 16:9 oran** — ultra geniş ekranda tuval yine kartın ortasında yüzen dar bir
   kutuydu.
2. **"Genişliği doldur, yüksekliği taşır"** — tek bir derin öğe (8×7 hücrelik bir masa
   yeter) planı 14 satıra çıkarıp tuvali 1600px'e uzatıyordu; salonun tamamı tek ekranda
   görünmüyordu.

Hücre `MIN_CELL` (18px) ile `MAX_CELL` (96px) arasında kalır: üst sınır olmasa küçük bir
plan geniş ekranda dev masalara dönüşüyordu — artan yer masayı şişirmek yerine zemine
gitmeli. Izgara `PLAN_COLS_MAX`/`PLAN_ROWS_MAX` (40) ile sınırlı; ötesine konan bir öğe
geri okunamazdı.

Koordinatlar hücre cinsinden olduğu için plan her ekranda aynı yerleşimi gösterir; değişen
tek şey hücrenin piksel boyu ve sağda/altta kaç boş hücre kaldığı.

- **Eski kare planlar bozulmaz**: `contentRows` satır sayısını yukarı çektiği için aşağıya
  inen masalar tuvalin dışında kalmıyor. Migration gerekmedi, alanın anlamı daraldı.
- **Aşağı doğru büyüme**: düzenleme kipinde tuval `+2` satır çizilir (`editRows`). Izgara
  zaten kutuyu doldurduğu için derin bir planda aşağıda hiç yer kalmıyor, plan
  büyütülemez hale geliyordu. Alt boşluğa bir öğe konunca plan o derinliği kalıcı kazanır.
- **Daraltma guard'ı yataya indi**: `requiredCols` yalnız `x + width`'e bakar, 409 metni
  "en fazla N sütuna kadar daraltılabilir".
- **Plan boyutu seçimi artık "en az N sütun"**: tuval kendiliğinden genişlediği için bu
  ayar yalnız alt sınırı — dolayısıyla dar ekrandaki genişliği ve ızgaranın sıklığını —
  belirliyor.

**`MIN_CELL` (18px) kaydırma kuralı aynen duruyor**: 40 sütunluk plan telefonda
küçülmez, tuval yatay kaydırmaya geçer.

**Her plan kendi satırını kaplar** — `xl:grid-cols-2` kalktı. Yan yana iki plan tuvalin
genişliğini yarıya indirip masaları küçültüyordu.

**Aynı turda ekrandaki diğer değişiklikler** (`floor-plan-screen.tsx`):

- Masası olmayan planlar kullanım kipinde tuval açmaz, altta tek satırlık çipe iner
  (çipe basmak o plana geçip düzenlemeyi masa kalemiyle açar). §2'deki "boş bölgeler de
  görünür" kararı korunuyor — görünme biçimi değişti.
- Özet şerit **lejant + filtre** oldu: beş durumun renk örneği ve sayacı; tıklayınca o
  durumdaki masalar planda öne çıkar, diğerleri soluklaşır (yerleşim değişmez).
- 6'dan çok masa varsa masa arama kutusu (aynı vurgulama mantığı).
- Sekmelerde `dolu/toplam` rozeti, bölüm başlığında o planın açık hesap toplamı.
