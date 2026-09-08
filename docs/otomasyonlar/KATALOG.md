# Otomasyon kartları — katalog ve format

> Bu belge iki işi birden yapar:
> 1. Panoya düşecek **otomasyon kartlarının kataloğu** (ne, hangi veriden, hangi aksiyonla).
> 2. Bu kartların **kullanım verisini ilk günden toplayacak** kayıt formatı.
>
> İkinci madde birinciden ayrı düşünülemez: kart kodları bir kez dağıtıldıktan sonra
> DEĞİŞMEZ, çünkü ileride "bu kullanıcı hangi karta yanıt veriyor" sorusunu cevaplayacak
> olan şey bu kodlarla birikmiş geçmiştir. Kod şeması bu yüzden katalogla aynı belgede.

## 0. Durum — 2026-09-07 (üçüncü tur)

### Kodlanan kartlar

| Kod | Kart | Canlı veride |
|---|---|---|
| K-STK-09 | Negatif stok | 7 firmada ateşliyor |
| K-BLG-01 | İşlenmemiş gelen fatura | 8 firmada · ₺484K'ya varan KDV indirimi |
| K-BLG-04 | Taslak fatura | 8 firmada · ₺589K faturalanmamış |
| K-NKT-06 | Vadesi geçmiş çek/senet | 3 firmada · ₺480K'lık çek 89 gündür |
| K-THS-07 | Vadesi geçmiş alacak | 2 firmada · ₺60K 36 gündür, ₺98K 17 gündür |
| K-NKT-08 | Kasada eksi bakiye | 3 firmada · ₺726K + ₺328K iki kasada |
| K-BLG-08 | Ticari faturanın yanıt süresi | 6 firmada · ₺1,41M'lik faturaya **1 gün** kalmış |
| K-MUS-06 | Bir kez alıp dönmeyen müşteri | 1 firmada · 17 müşteri · ₺171.500 ciro |
| K-MUS-07 | Tek müşteriye ciro bağımlılığı | 2 firmada · %72 (aynı müşteride ₺1,2M açık bakiye) |
| K-BLG-09 | Entegratöre takılmış giden fatura | 1 firmada · 6 belge, 4'ü GİB'e hiç ulaşmamış |
| K-BLG-07 | KDV beyan dönemi + kaçan indirim | 6 firmada (ayın 16–28'i arası) · ₺246K kaçan indirim |
| K-THS-08 | Faturasız tahsilat (müşteri) | 5 firmada · ₺100K çek karşılığı hiç fatura yok |
| K-TDR-05 | Tedarikçiye fazla ödeme | 3 firmada · ₺890K ödeme, hiç alış faturası yok |
| K-OPR-06 | Gün devreden açık adisyon | 2 firmada · 32 gündür açık masa, ₺6.832 ciro dışı |
| K-STK-01 | Tükenme + tedarik süresi | sessiz — 61 üründen 43'ü negatif stoklu |
| K-MUS-04 | Aynı ürüne farklı fiyat | sessiz — bulguların tamamı hizmetti, elendi |

### Ölçüldü, YAZILMADI (sebepleriyle)

| Kod | Sebep |
|---|---|
| K-BLG-02 | Mükerrer tanımı çalışmıyor; kalem karşılaştırması gerekiyor (§4.8) |
| K-BLG-03 | Tüm veritabanında 4 irsaliye var |
| K-BLG-05 | `bank_statement_items` tablosu tamamen boş |
| K-OPR-04 | Hiç kasa sayımı kaydı yok |
| K-SIS-01 | 38 firmada kontör var ama kimse bitmeye yakın değil |
| K-TDR-01 | Tek üründe ateşliyor — alış verisi çok ince |
| K-STK-05 | "Ölü stok" ile "yeni alınmış" ayrılamıyor — aşağıya bak |
| K-STK-06 | K-STK-05 ile aynı kümeye düşüyor; ayrı kart değil |
| K-BLG-06 · K-MRJ-02 · K-MUS-03 | Her biri tek firmada tek kayıt — kart bütçesine değmiyor |
| K-THS-05 | Risk limiti 349 müşterinin **2'sinde** dolu; ölçüsü olmayan kart |
| K-TDR-02 | Tüm veritabanında **2** üründe birden çok tedarikçi var (27 üründen) |
| K-MRJ-02 | 2 ürün, ikisi de tek firmada ve test kaydı ("hebele", ₺2,5M "zarar") |
| K-NKT-01/02/04 | İleri eğride **hiç çıkış yok** — borç tarafında vade tanımsız (aşağıda) |
| K-MRJ-03/04 | Marj kapsamı yok: EREN FORKLİFT'te satılan 42 üründen **7'sinin** maliyeti biliniyor |
| Mükerrer finansal hareket | Tüm veritabanında 2 grup, ikisi de aynı firmada ve test kaydı |
| e-Arşiv ↔ e-Fatura uyumsuzluğu | `Customer.eInvoiceAlias` 349 müşterinin **4'ünde** dolu; ölçüt yok |
| Aynı üründe farklı KDV oranı | 114 üründen **2'si**, ikisi de test kaydı (%0 ↔ %20) |
| Tedarikçi bazlı gider sapması (D motoru) | 155 tedarikçi-firma çiftinin **3'ünde** 3 aylık geçmiş var |
| Tek tedarikçiye bağımlılık (K-TDR-04) | Gelen fatura toplamlarında ₺76 milyarlık çöp kayıtlar payı ele geçiriyor |
| Satış ritmi durdu | Bugün hiçbir firmada durmuş ritim yok (en uzunu 8 gün, p75'i 12 gün olan firmada) |
| K-MUS-01 | 3 firmada 1'er müşteri; biri gerçek (₺750K, 58 gün) ama veri ince (§0) |

**K-STK-05 / K-STK-06 ölçümü (2026-09-06).** Hiç satılmamış, stoğu ve maliyeti
olan 206 ürün var ve bağladıkları sermaye **₺2,05M** — kart yazmak için fazlasıyla
yeterli görünüyor. Ama iki ölçü onu durdurdu:

| ölçü | sonuç |
|---|---|
| "satılıyordu, durdu" (K-STK-05'in asıl tanımı) | **0 ürün** |
| ürün yaşı ≥ 90 gün | **0 ürün** — en yaşlısı 45 günlük |

Yani veritabanındaki her "ölü" kalem aslında YENİ: 38–45 gün önce girilmiş ve
henüz satılmamış. Bunlara "ölü stok, elden çıkar" demek kartı ilk günden haksız
çıkarırdı (anatomi kuralı 5). En büyük kalem de bunu doğruluyor: *Motorin,
5.908 LT, ₺336K, 45 günlük* — akaryakıt satılmaz, TÜKETİLİR; hiç OUT hareketi
görmemesi ölü stok değil, ölçünün yanlış ürüne bakması demektir.

İki kart da veri yaşlanınca (≥90 günlük stok geçmişi) yeniden ölçülmeli.

### A motoru ölçümü — 2026-09-07

Faz 2 "çek/senet + maaş + tekrarlayan gider + günlük çözünürlük" olarak
planlanmıştı. Dördü de ölçüldü; **yalnız biri ayakta kaldı.**

| kaynak | ölçüm (canlı, 33 firma) | karar |
|---|---|---|
| çek/senet | ileri vadeli portföy evrakı 3 firmada: **₺1.167.000 giriş, ₺200.000 çıkış** | **projeksiyona eklendi** |
| maaş (`PayrollRecord`) | veritabanının TAMAMINDA **4 kayıt**; 2'si PENDING ve ikisi de GEÇMİŞ dönem (202607, 202608) | K-NKT-03 yazılmadı |
| tekrarlayan gider | son 6 ayda 38 `EXPENSE` hareketi, **kategorili olan 0**; 3+ ay tekrar eden 2 serinin ikisi de "(kategorisiz)" ve sapma ortalamadan büyük (₺276K ± ₺363K) | türetilemiyor |
| günlük çözünürlük | ileri vadeli kalem sayısı **tek haneli**; `Invoice.dueDate` en büyük firmada %0 dolu | ertelendi |

**Çek/senet neden gerçek bir boşluktu.** Projeksiyon kalemlerini cari
yaşlandırmadan alıyor, yaşlandırma ise çek/senedi `getCheckNoteCreditMap` ile
cari kredisi sayıyor: müşteri çek verince faturanın açık tutarı SIFIRLANIYOR.
Fatura eğriden düşüyor, çekin kendisi hiç eklenmediği için **30 gün sonra
gelecek para tabloda hiçbir yerde görünmüyordu.** Çifte sayım değil, doğru
tarihe taşıma: kredi haritası parayı zaten cariden düşmüş durumda.

Etkisi ölçüldü (üretim yolundan, `computeCashProjection`): HİDROEREN'in ileri
eğrisinde **hiç dolu kova yoktu**, şimdi 14-20 Eylül'de ₺100.000 var ve bakiye
−₺5.500'den +₺94.500'e çıkıyor. EREN FORKLİFT PNÖMATİK'te üç yeni kova (₺347K).

**Vadesi geçmiş evrak eğriye GİRMEZ.** Portföyde duran vadesi geçmiş çek
planlanmış nakit hareketi değil, kayıt boşluğudur (K-NKT-06'nın konusu). Canlı
veri bunu ayrıca zorluyor: bir firmada ₺3.213.123.123.123 tutarlı, vadesi geçmiş
bir portföy çeki var — "vadesi geçmiş giriş" toplamına girseydi o firmanın nakit
raporu okunamaz olurdu.

**K-NKT-08 neden yalnız KASA'ya bakıyor.** Kartın gücü tartışılmaz bir gerçeğe
dayanıyor: kasadaki nakit eksiye düşemez, eksiyse kayıt hatası vardır. Banka için
aynısı söylenemez — kredili mevduat ve kredi kartı eksi çalışır. Ölçümde eksi
bakiyeli 6 hesabın 2'si bankaydı ve biri doğrudan "KREDİ KARTI FAHR."
(−₺24.843): karta girseydi ilk gün haksız çıkardı.

### Altyapı

- `automation_card_events` tablosu **uygulandı** (`db push`) ve **RLS açıldı**.
  `db push` migrasyon dosyasını ÇALIŞTIRMAZ; RLS ifadesi elle uygulandı. Yeni bir
  ortamda kurulurken `supabase/migrations/20260906000001_*.sql` koşulmalı.
- Pano bağlantısı: `app/(dashboard)/dashboard/page.tsx`, hero'nun altı.
- Nöbetçi test: `lib/otomasyon/kartlar.test.ts` — kod biçimi, kapı ve link
  doğruluğunu mekanik korur (mutasyonla doğrulandı).

### Pano tarayıcıda çalıştırıldı — 2026-09-06

Arayüz ilk kez canlıda koşturuldu ve **beş hata çıktı**; hiçbiri veri katmanında
değildi, hepsi arayüz–uç arasındaydı:

1. **Uç 500 dönüyordu ve pano bunu hiç göstermiyordu.** Prisma istemcisi şema
   değişince yeniden üretilmemişti (`automationCardEvent` tanımsız). SWR hatası
   yutulunca bileşen `null` dönüyor ve pano SAĞLIKLI görünüyordu. Artık hata
   şeridi basılıyor, kısmi hata da kart kodlarıyla duyuruluyor; `postinstall`
   eklendi, istemci bir daha eskimiyor.
2. **Günlük, ekranda görünmeyen kartı "gösterildi" yazıyordu.** Ekranda 3 kart
   varken 4 satır düşüyordu. `GOSTERILECEK` artık `tipler.ts`te ve uç da onu
   okuyor — ölçüm "gösterildi ama umursanmadı" sorusuna geri döndü.
3. **Aksiyon linkleri kartın saydığı kayıtları AÇMIYORDU.** "517 fatura
   aktarılmadı" diyen kart, varsayılan 30 günlük listeye düşürüyor ve ekran
   *0 fatura listelendi* diyordu. Hedef ekranlar artık `?gun=&durum=&aktarim=`
   okuyor; aynı kart şimdi tam 517 satır açıyor. Sipariş ekranı da kartın
   ürün/miktar/tedarikçi param'larını okuyup formu ön dolduruyor.
4. **K-BLG-04 satış FİŞLERİNİ taslak fatura sayıyordu** (167 yerine 129).
   41 fiş, aksiyonun açtığı fatura listesinde hiç görünmüyordu — fatura listesi
   `isReceipt = false` süzüyor. Kartın saydığı her belge, aksiyonun açtığı
   ekranda görünmeli.
5. Nöbetçi teste dördüncü kural eklendi: **linkteki her param'ı hedef ekran
   okumalı.** Okunmayan param sessizdir; sayfa açılır, kayıtlar görünmez.

### B motoru ölçümü — 2026-09-07

A motorunun kalanı `Invoice.dueDate`e takılınca iki yol ölçüldü.

**(a) Vadeyi doldurmak — kapsamı dar, riski büyük.** Vade müşteri kartından
türetilip forma öneri olarak yazıldı (`lib/cari/vade.ts`). Kapsam ölçüldü: son 6
ayın 303 satış faturasının %5'inde vade yazılı, **%12'si** müşteri kartından
türetilebiliyor, **%83'ünde hiçbir kaynak yok**. Kapsamı büyütmek için düşünülen
"firma varsayılan vadesi" ÖLÇÜMLE REDDEDİLDİ: 30 gün varsayılsaydı **172 fatura
/ ₺7.050.386 bir gecede "vadesi geçmiş"e** düşerdi. Dahası `dueDate` iç bir alan
değil — `mysoft-provider.ts` üzerinden GİB'e giden UBL'e ve fatura PDF'ine
("Vade Tarihi" satırı) basılıyor; yanlış varsayılan yanlış rapor değil, YANLIŞ
RESMÎ BELGE üretir. Bu yüzden vade yalnız cari kartında ZATEN girilmişse,
yalnız yeni faturada, görünür ve düzeltilebilir biçimde doluyor.

**(b) Ödeme davranışını ölçmek — kazanan yol.** Bu işletmeler açık hesap
çalışıyor: ödeme faturaya değil CARİYE işleniyor (bir firmada 4 faturaya bağlı
ödemeye karşılık **101 serbest cari tahsilatı**). Sözleşme vadesi yok ama ritim
var ve ölçülebiliyor.

`lib/cari/odeme-davranisi.ts`: satış faturaları ile fiili tahsilatlar (serbest
tahsilat + bağsız fatura ödemesi + çek/senet, çek VADE tarihinde) FIFO eşlenir;
eşleşen her lira bir "kaç gün" çifti üretir. **Vadeye hiç bakmaz.**

Sonuç: 23 müşteride profil, medyan **11 gün**, çeyrekler 4 ve 30, 180+ gün YOK,
tek negatif değer gerçek (avans veren müşteri).

**Ölü bir gösterge dirildi.** Yaşlandırmadaki "Geri Dönüş" skoru vadesi tanımsız
belgeyi atladığı için 80 müşterinin **78'inde "Veri yok"** basıyordu (%3 kapsam).
Davranış ölçüsü aynı ekranda yedek olarak devreye girdi: kapsam **%3 → %11**
(rapora yalnız açık bakiyeli cariler girdiği için 23'ün 9'u görünüyor).

İki ölçü AYRI alanlarda ve ayrı cümlelerle duruyor — karıştırılmamalı:
`performanceAvgDays` "sözüne göre kaç gün geç" (vade ister),
`paymentBehaviorDays` "kaç günde ödüyor" (vade istemez). 30 gün vadeyle tam
gününde ödeyen müşteri birincide 0, ikincide 30 gündür.

**K-THS "davranış bozuldu" kartı YAZILMADI.** Ölçüldü: profilli müşterilerin
**16'sında açık bakiye sıfır** — geçmişi olan müşteriler güncel. Eşik ne
seçilirse seçilsin kart 2 müşteride ateşliyor. Profil biriktikçe yeniden ölçülür.

### Ters bakiye ve açık adisyon ölçümü — 2026-09-07 (üçüncü tur)

Altı aday veriye soruldu, üçü kart oldu, üçü elendi.

| aday | ölçüm (canlı, 34 firma) | karar |
|---|---|---|
| müşteri bakiyesi ters yönde | 5 firmada 5 cari · ₺1.500 – ₺100.000 | **K-THS-08 yazıldı** |
| tedarikçiye fazla ödeme | 3 firmada 5 cari · en büyüğü ₺890.000 | **K-TDR-05 yazıldı** |
| gün devreden açık adisyon | 2 firmada 5 adisyon · 19–32 gün | **K-OPR-06 yazıldı** |
| risk limiti aşımı | `Customer.riskLimit` 349 müşterinin **2'sinde** dolu | elendi |
| yanıtsız teklif (K-MUS-03) | tüm veritabanında **1** SENT teklif (geçerliliği 61 gün önce bitmiş) | elendi |
| susan müşteri (K-MUS-01) | 3 firmada 1'er müşteri | ertelendi |

**Risk limiti neden yazılmadı.** Alan var, ekranda da duruyor; ama doldurulmuyor
(%0,6). Katalogun veri giriş kuralının birinci basamağı tam olarak bunu söylüyor:
"ayarlar ekranına konan alan, doldurulmayan alandır". Limit türetilemez de —
"bu müşteriye ne kadar açık hesap veririm" işletmenin kararıdır, geçmişten
çıkarılamaz. Kart, limit girilmeye başlanırsa yeniden ölçülür.

**Susan müşteri neden ertelendi.** Ölçü çalışıyor (kendi ritminin 2 katı sessizlik,
≥3 alım) ve bir gerçek bulgu veriyor: EREN VİNÇ'te ÖZERLER TEKNİK, 3 alım, 10
günlük ritim, **58 gündür sessiz, ₺750.000 ciro**, telefonu kartta. Ama 3 alımla
hesaplanan "ritim" kırılgan: aynı ölçü Reypo'da 8 kez ₺160 alan bir carinin
üstünde de ateşliyor. Kartı yazmadan önce ya alım sayısı eşiği yükseltilmeli ya
da K-MUS-05'in yaptığı gibi cironun büyüklüğü ölçüye girmeli; ikisi de daha çok
veri istiyor.

#### Ters bakiye: dört yanlış-pozitif sınıfı

Süzgeçsiz ilk sürüm 7 müşteri + 6 tedarikçi buluyordu; **üçü yanlıştı** ve üçü de
ayrı sınıftı. Ayrıntı `lib/otomasyon/veri/ters-bakiye.ts` başlığında:

1. **Mahsup** — cari hem müşteri hem tedarikçi. `earsin sinar`ın −₺78.365'i fazla
   tahsilattan değil, aynı cariye kayıtlı ₺194.427'lik açık ALIŞ faturasından
   geliyordu. Ters yönde faturası olan cari elenir.
2. **Yuvarlama artığı** — `BELGİN MADENİ YAĞLAR` −₺2 (₺1.011.901 alışa ₺1.011.903
   ödeme). Taban ₺100.
3. **Açılış bakiyesi** — CREDIT açılış girilmişse ters bakiye hata değil, girilen
   bilginin kendisidir. Canlı veride hiç yok (349 + 56 kaydın tamamı DEBIT), yani
   **ölçüm bu dalı bir kez bile koşturmadı**; işaret yönü bu yüzden testle
   tutuluyor (`ters-bakiye.test.ts`, mutasyonla doğrulandı).
4. **Çift rollü cari** — elenmez, SÖYLENİR. EREN VİNÇ'in "EREN FORKLİFT"i müşteri
   kaydında −₺1.500, tedarikçi kaydında −₺160.000. Uygulama iki kaydı ayrı
   tutuyor (ekstre tek seferde tek kayıt açar); kart mahsup etseydi hiçbir
   ekranda görünmeyen bir rakam üretirdi — K-THS-07'nin "ikinci formül yazma"
   kuralı. Kart bunun yerine ayrımı gerekçede yazıyor.

Kalanların hepsi gerçek: Özkan Karakan ₺100.000 çek alınmış ve **hiç fatura
kesilmemiş**; NURİ KARLİFE'ye ₺690.000 ödeme + ₺200.000 çek çıkmış, **hiç alış
faturası girilmemiş**; PAMUKKALE'de ₺88.716'lık iki faturaya karşı ₺100.000'lik
senet var.

**Kart suçlamıyor, iki ihtimali birden söylüyor:** ya avans (o hâlde bu para gelir
değil borçtur), ya faturası kesilmemiş iş (o hâlde ciro ve KDV eksik). Hangisi
olduğunu ancak kullanıcı bilir. Bu yönüyle kart K-BLG-01/04'ün aynası: onlar
BELGEYİ bulup parayı arıyor, bu ikisi PARAYI bulup belgeyi arıyor.

#### K-OPR-06 · parası küçük, sonucu büyük

Tutar küçük (₺6.832) ama kart iki sebeple yazıldı. Birincisi sonucun kendisi:
adisyon kapanmadan **fiş kesilmez**, yani o masanın satışı ne ciroya girer ne de
malzemesi stoktan düşer — 32 gündür açık bir masa, 32 gündür yanlış rapor
demektir. İkincisi kapsam: restoran modülünü kullanan firmalarda bugüne kadar
**hiç kart çıkmıyordu**; K-OPR grubunun ilk kartı bu.

Boş adisyon (hiç kalem girilmemiş masa) ayrı sayılıyor ve ayrı cümleyle geçiyor:
onda kaybolan ciro yok, yalnız masa planında yer tutuyor. 5 adisyonun 2'si böyle;
tek kart bunları "₺0'lık satış kayıp" diye göstermemeli.

Tutar `ticketTotals` ile hesaplanıyor — adisyon ekranının ve kapanışın kullandığı
fonksiyonun ta kendisi. İkram/zayi kalemleri ile hesap iskontosu tam da orada
ayrışıyor; ikinci bir çarpım, kartın tutarını masanın üstündeki tutardan farklı
gösterirdi.

### A motorunun ileri eğrisi neden hâlâ boş — 2026-09-07

`Invoice.dueDate` "yol üstündeki taş" diye yazılmıştı; ölçüldü ve taşın ALIŞ
tarafında olduğu çıktı. Projeksiyon (`computeCashProjection`) 34 firmada koştu:

| firma | dolu kova | giriş | **çıkış** |
|---|---|---|---|
| EREN FORKLİFT | 5/12 | ₺1,12M | **₺0** |
| EREN F. PNÖMATİK | 3/12 | ₺347K | **₺0** |
| Reypo Medya Ajansı | 5/12 | ₺19K | **₺0** |
| HİDROEREN | 1/12 | ₺100K | **₺0** |

**Eğrinin hiçbir kovasında çıkış yok.** Sebebi ölçüldü: alış faturalarının
**1/79'unda** vade var, tedarikçilerin **3/56'sında** ödeme vadesi girili. Yani
borç tarafı takvime hiç düşmüyor; eğri yalnız girişten oluştuğu için **her firmada
monoton artıyor.** "Nakit eşiğin altına iniyor" (K-NKT-02) böyle bir eğride
tanımı gereği hiç ateşlenmez — eşik 0 seçilse bile.

Ölçüm ayrıca eğrinin DIŞINDA kalan parayı gösterdi: vadesi hiç tanımlanmamış
alacak EREN F. PNÖMATİK'te **₺766.620**, EREN FORKLİFT'te ₺263.800. Bu para
takvimde hiçbir yere düşmüyor.

#### Çıkış vadesi nereden gelebilir: üç yol ölçüldü, biri ayakta kaldı

| yol | ölçüm | karar |
|---|---|---|
| `Supplier.paymentDueDays`'ten türet | 56 tedarikçinin **3'ünde** dolu | kapsam yok |
| Ödeme davranışından türet (B motoru, tedarikçi yönü) | 56 tedarikçinin **2'sinde** profil çıkıyor (medyan 6 gün) | kapsam yok |
| **Gelen e-faturanın KENDİ vadesi** | Mysoft `InvoiceForApiModel.dueDate` = "Vade Tarihi" | **bağlandı** |

İlk ikisi aynı duvara çarpıyor: tüm veritabanında 79 alış faturası var, ödeme
eşleşmesi ancak 2 tedarikçide profil üretiyor. Türetme, olmayan geçmişten bilgi
çıkaramaz.

Üçüncüsü ise tahmin bile değil: **satıcı vadeyi zaten kendi belgesine yazmış.**
Alan Mysoft'un gelen fatura modelinde baştan beri var ve okunmuyordu
(`getIncomingInvoiceModel` haritalamasında yok). Bağlandı:

```
Mysoft dueDate → invoice-editor (gelen faturadan ön dolgu, kaynağı kutunun altında)
              → Invoice.dueDate → cari yaşlandırma (effectiveDueDate)
              → nakit projeksiyonu (ÇIKIŞ kovası)
```

Editördeki vade artık üç kaynaklı: `gelen` (satıcının belgesi) > `elle`
(kullanıcı) > `oneri` (cari kartından türetme). Sıralama önemli — kaynak
ayrılmasaydı, cari kartından türeten efekt gelen belgedeki gerçek vadeyi
tedarikçilerin 53/56'sında SİLERDİ (kartları boş olduğu için türetme "" döner).

**Doğrulanmayı bekleyen tek şey:** alanın şemada olduğu kesin (swagger:
`InvoiceForApiModel.dueDate`, "Vade Tarihi"), ama göndericilerin ne sıklıkta
doldurduğu canlı yanıtta henüz görülmedi. Değer gelmezse kod eskisi gibi
davranıyor (türetme + boş bırakma); tek bir gelen faturayı aktarma ekranında
açmak bunu gösterecek.

Bu doldukça K-NKT-01/02/04'ün önü açılıyor: çıkış kovaları dolan bir eğride
"nakit eşiğin altına iniyor" ölçülebilir bir soru hâline gelir.

**Yan bulgu — açılış bakiyesi eksi.** Projeksiyonun başlangıç bakiyesi üç firmada
eksi: EREN F. PNÖMATİK −₺1.053.843 (bu, K-NKT-08'in saydığı iki kasanın toplamı),
EREN FORKLİFT −₺860.223, HİDROEREN −₺5.500. EREN FORKLİFT'inki BANKA hesabından
geliyor ve K-NKT-08 onu bilerek saymıyor (kredili mevduat eksi çalışır) — kartın
sınırı burada da doğru çizilmiş durumda.

### K-BLG-08 · gerçek son tarihi olan ilk kart

Katalogdaki kartların çoğu geçmişteki bir kayıt boşluğunu gösteriyor. Bu kart
GELECEKTEKİ bir tarihi gösteriyor ve tarihi kaçırmanın sonucu geri alınamaz:
ticari faturaya 8 gün içinde red yanıtı verilmezse fatura KABUL EDİLMİŞ SAYILIR.

Ölçüm: 67 fatura yanıt bekliyor, 6 firmaya dağılmış, tamamı `TICARIFATURA`.

| firma | bulgu |
|---|---|
| ASDOĞUŞ | **₺1.412.400** · 7 günlük → red süresi yarın doluyor |
| EREN FORKLİFT | 6 fatura süre içinde, en yakını 1 gün · toplam ₺130.569 |
| HİDROEREN | 1 fatura 1 gün kalmış, 11 fatura süresi dolmuş |
| Reypo Medya Ajansı | 36 fatura, hepsinin süresi dolmuş · ₺174.626 |

Üç karar ölçümden çıktı:

1. **Yalnız TİCARİ fatura.** Temel fatura sistem üzerinden reddedilemez (itiraz
   noter/KEP/taahhütlü mektupla yapılır); ona "reddet" demek yanlış olurdu.
   Bugünkü veride iki küme çakışıyor (67/67 ticari) ama süzgeç baştan yazılı.
2. **Saat BELGE tarihinden işler.** `docDate` ile `sentDate` bu veride günlerce
   ayrışıyor (bir faturada belge 52, zarf 44 gün). Belge tarihi esas alınınca
   kart her zaman ERKEN uyarıyor; zarf tarihine bakan ölçü kullanıcıya elinde
   olmayan günleri var gösterirdi.
3. **Süresi dolmuş faturalar susturulmuyor**, ama kart dilini değiştiriyor: red
   hakkı bittiği için son tarih yok, kalan iş belgeyi kayda geçirmek. Bu küme
   K-BLG-01'in de dışında (o yalnız `KABUL` sayıyor) — yani bugüne kadar hiçbir
   kartta görünmüyorlardı.

Kart ekranın kümesini kopyalamıyor, `buildIncomingWhereWithoutDate` ile ekranın
SORGUSUNU çağırıyor: "yanıt bekliyor" tanımı ("terminal olmayan her durum")
Mysoft'un `YANIT_BEKLENIYOR` / `KABUL_KUYRUGUNDA` gibi metinleri yüzünden düz
eşitlikle yazılamıyor ve o hata bir kez yapılmış (36 satır → 0).

### K-MUS-06 · eşiği kartın değil FİRMANIN belirlediği ilk kart

"30 gündür almıyor" cümlesi tek başına hiçbir şey söylemiyor: kahveciye 30 gün
uğramayan müşteri kayıptır, forklift satıcısına 30 günde bir gelen müşteri
SADIKTIR. Sabit gün sayısı kartı sektörlerin yarısında haksız çıkarırdı.

Eşik bu yüzden firmanın kendi verisinden türetiliyor: geri dönmüş müşterilerin
ilk→ikinci alış aralıkları alınıyor, %75'lik dilimin iki katı sınır sayılıyor.
Kart bu hesabı gerekçesinde yazıyor ("geri dönen 31 müşterinin dörtte üçü 31 gün
içinde ikinci alışını yapmış, ben 62 günü sınır saydım").

Üç ayar ölçümden çıktı:

| ayar | neden |
|---|---|
| medyan değil **%75'lik dilim** | Medyanla EREN FORKLİFT'in ritmi 3 gün çıkıyor (tekrar edenlerin çoğu aynı hafta ikinci kez alıyor) ve eşik 6 güne düşüp **10 gün önce alışveriş yapmış 28 kişiyi** "kayıp" ilan ediyordu |
| **taban 30 gün** | Ritmi sıkı firmada 2×p75 birkaç güne iniyor; "geçen hafta alan müşteri kayıp" demek kartı ilk gün haksız çıkarır |
| kalibrasyon yoksa **sabit 90 gün** | REYPO BİLİŞİM'de tek bir tekrar eden müşteri var; ondan çıkan "1 günlük ritim" saçmadır |

Canlı sonuç: EREN FORKLİFT PNÖMATİK'te **17 müşteri, ₺171.500** (en büyükleri
DMN OTO ₺29.000 · 65 gün, telefonuyla). Eşik bilinçli olarak CÖMERT: çarpan 2
yerine 1,5 olsaydı EREN VİNÇ de üç müşteriyle (₺73.000) ateşleyecekti. Kartın az
ateşleyip haklı çıkması tercih edildi (anatomi kuralı 5).

### Dördüncü tur: risk ve sessiz hata kartları — 2026-09-07

Dört yeni aday ölçüldü, ikisi kart oldu.

#### K-BLG-09 · panelde "gönderildi", entegratörde hata

Üründeki en pahalı sessiz hata sınıfı: `Invoice.status = 'SENT'` kullanıcı için
"bu iş bitti" demek — belge listede yeşil, cariye işlendi, ciroya girdi. Ama
`integrationStatus` ayrı bir şey söyleyebiliyor ve bunu gösteren HİÇBİR ekran
yok:

| durum | ne demek |
|---|---|
| `ERROR:Bozuk UUID kaydedilmiş` | belge GİB'e hiç ulaşmadı |
| `REJECTED:HATA` | entegratör reddetti |
| `ERROR:Giden fatura kaydı bulunamadı` | belge entegratörde yok |

Ölçüm: 6 belge, hepsi tek firmada; dördü mock modda kalmış bozuk UUID, ikisi
gerçek Mysoft hatası. Sayı düşük — ama bu kartın yazılmama sebebi değil,
yazılma sebebi: ateşlediği gün söylediği şey, satışı yapılmış ve cariye
işlenmiş bir belgenin GİB tarafında hiç var olmadığıdır.

**Kart eşik kullanmıyor**, entegratörün kendi yazdığı durumu gösteriyor; yanlış
pozitif üretmesi için entegratörün yalan söylemesi gerekir. `PROCESSING:*`
durumları (90 belge: GİBE_GONDERILDI, YANIT_BEKLENIYOR) karta GİRMEZ — onlar
yolda olan belgelerdir.

> **Nöbetçi test yine iş gördü.** Kartın "faturayı aç" linki ilk yazımda
> `/faturalar/[id]`ye gidiyordu; öyle bir sayfa yok (yalnız `[id]/onizleme`,
> `[id]/odemeler`, `[id]/etiket` var). Test 404'ü yayına çıkmadan yakaladı —
> aynı tuzağa 2026-09-06'da K-BLG-04 düşmüştü.

#### K-MUS-07 · tek müşteriye ciro bağımlılığı

İşletme sahibi en büyük müşterisinin kim olduğunu bilir, PAYINI bilmez. Ölçüm
(son 12 ay, TRY ciro):

| firma | müşteri | en büyüğün payı |
|---|---|---|
| REYPO BİLİŞİM | 7 | **%72** — ASDOĞUŞ, ₺1.000.000 ciro **+ ₺1.200.000 açık bakiye** |
| EREN VİNÇ | 26 | **%48** — ÖZERLER, ₺750.000, bakiyesi kapalı |
| Reypo Medya | 7 | %35 |
| EREN F. PNÖMATİK | 86 | %19 |
| EREN FORKLİFT | 37 | %18 |

Eşik %40 dağılımdan seçildi: %19 ile %48 arasında boşluk var, "normal" ile
"bağımlı" bu veride kendiliğinden ayrışıyor. **En az 5 müşteri şartı** da
ölçümden: 1–2 müşterisi olan altı firmada pay %67–100 çıkıyor ve onlara "tek
müşteriye bağımlısınız" demek doğru ama beyhude.

Kartın gücü açık bakiyeyi yanına koymasında: REYPO BİLİŞİM'de hem cironun %72'si
hem de tahsil edilmemiş ₺1,2M aynı kapıya bağlı — iki ayrı ekranda duran iki
rakam, tek cümlede risk oluyor.

#### K-BLG-07 · beyan takvimi ile kaçan indirimi birleştiren kart

K-BLG-01 aktarılmamış faturaları SÜRESİZ bir kuyruk olarak sayıyor. Bu kart aynı
belgeleri BEYAN TAKVİMİNE bağlıyor: "sırada duruyor" ile "bu ayın indirimi
kaçıyor" farklı iki cümledir ve ikincisinin son tarihi var.

Kart üç sayıyı sistemdeki belgelerden çıkarıyor: hesaplanan KDV (dönemin satış
faturaları), indirilecek KDV (dönemin ALIŞ FATURASINA DÖNÜŞMÜŞ belgeleri) ve
kaçan indirim (aynı döneme ait, kabul edilmiş ama aktarılmamış gelen faturalar).

**Kart bir beyanname DEĞİL** ve bunu kendi cümlesinde söylüyor: devreden KDV,
tevkifat, istisna, iade ve KDV-2 hesaba girmiyor. Rakamı beyanname yerine koyan
bir cümle, bu kartın yapabileceği en zararlı şey olurdu.

Ağustos 2026 dönemi ölçümü (20 Eylül simüle edilerek koşuldu):

| firma | hesaplanan | indirilecek | aktarılmamış |
|---|---|---|---|
| EREN FORKLİFT | ₺244.316 | ₺168.650 | 62 fatura · **₺24.727** |
| EREN F. PNÖMATİK | ₺244.693 | **₺0** | — |
| HİDROEREN | ₺0 | ₺0 | 63 fatura · **₺246.067** |
| ASDOĞUŞ | ₺391.400 | ₺0 | 5 fatura · ₺72.956 |

İkinci satır kartın gerekçesini tek başına anlatıyor: bir firma ₺244.693
hesaplanan KDV'ye karşı SIFIR indirimle beyan verecek durumda, çünkü hiç alış
faturası girilmemiş.

Üç karar ölçümden çıktı:

1. **Pencere: beyana 12 gün kala.** Ayın 1'inde "28'inde beyan var" demek doğru
   ama aksiyon değil; son iki hafta, aktarılmamış faturaların işlenebileceği
   gerçek penceredir. Kart 28'i geçince susar.
2. **Cümleler ayrı ayrı kuruluyor.** Ölçümde iki uç çıktı: hiç satış faturası
   olmayan dönem ve iadeler yüzünden NET İNDİRİMİ EKSİYE düşen dönem (−₺155).
   Tutara bakarak "alış faturası yok" diyen ilk sürüm, altı belgesi olan firmaya
   "hiç belge yok" diyordu.
3. **En büyük tek fatura da yazılıyor.** Haziran 2026'da tek bir firmada
   aktarılmamış KDV toplamı ₺240 milyon çıkıyor (K-BLG-01'in pencere koymasına
   sebep olan sahte kayıtlar). Toplam tek kayıtla ele geçirildiğinde okuyan kişi
   bunu görsün diye kart "bunun ₺X kadarı TEK faturadan geliyor" diyor.

**Takvim testle korunuyor** (`kdv-donemi.test.ts`, mutasyonla doğrulandı): kart
yalnız ayın 16–28'i arasında göründüğü için tarayıcı denetimi bu dalı HİÇ
görmüyor. Pencerenin iki ucu, dönemin geçen ay olması ve Ocak'ta yıl geçişi
(dönem = geçen yılın Aralık'ı) orada sınanıyor.

> **VARSAYIM — mevzuat.** Aylık KDV beyannamesi izleyen ayın 28'inde verilir ve
> ödenir (`BEYAN_GUNU`). Üç aylık beyan veren mükellef bu üründe ayırt
> edilemiyor; kart aylık varsayıyor ve tarihi cümle içinde açıkça yazıyor.
> Mevzuat değişirse tek sabit değişir.

#### Elenen ikisi

**Tek tedarikçiye bağımlılık (K-TDR-04)** ölçüldü ve ÇÖP KAYIT sorununa çarptı:
gelen faturalarda ₺76 milyar ve ₺78 milyar tutarlı kayıtlar var (K-BLG-01'in
pencere koymasının sebebi de buydu), bu da payı %100 gösteriyor. Doğru sürüm
aykırı değer temizliği gerektiriyor; "ucuz kazanç" değil.

**Satış ritmi durdu** kartı bugün hiçbir firmada ateşlemiyor — en uzun sessizlik
8 gün ve o firmanın kendi p75'i 12 gün. Ölçü çalışıyor, veri henüz "durmuş" bir
işletme içermiyor.

### Tarayıcı denetimi — 2026-09-07 (ikinci kez)

16 kart canlı veriyle Chrome'da koşturuldu (Reypo Medya Ajansı + Kobipo Demo
Merkez). **Üç hata çıktı, üçü de veri katmanında değil, KARTIN EKRANLA
İLİŞKİSİNDEYDİ** — 2026-09-06'daki turun aynısı.

**1. Aksiyon linki yine kartın saydığı kayıtları açmıyordu.** K-BLG-09 "6 fatura
takılmış, en eskisi 117 gün" diyor, linki `?durum=SENT` taşıyordu ama ekranın
varsayılan penceresi 90 gün: listede 55 satır çıkıyor ve **kartın saydığı 6
belgenin dördü orada hiç yoktu**. Link artık `gun=` taşıyor (K-BLG-04'ün
`listePenceresi` yardımcısı); 180 günle altı belgenin altısı da listede.

**2. Kart, kullanıcının GÖRDÜĞÜ numarayı yazmıyordu.** Kart "SAT-2026-0185"
diyordu, liste aynı belgeyi "ADM2026000000012" diye gösteriyor: fatura listesi
`eDocumentNo || invoiceNo` basıyor (`lib/faturalar/list-query.ts`). Kart artık
aynı kuralı kullanıyor, iç numara yalnız günlüğe yazılıyor.

**3. "Ekstredeki rakamın aynısı" cümlesi YANLIŞTI.** Kart ABC Müşteri için
₺47.214 derken ekstre ekranı −₺62.214 gösterdi. Aradaki ₺15.000 o carinin AÇILIŞ
BAKİYESİ: cari listesi ve yaşlandırma açılışı hesaba katıyor,
`lib/cari/ekstre-query.ts` ise açılış için satır ÜRETMİYOR.

> Bu, kartların yol açtığı bir şey değildi — **ürünün iki ekranı arasındaki
> tutarsızlıktı**. Açılış bakiyesi girili tek cari olduğu için (349 müşterinin
> 1'i) bugüne kadar görülmemiş.
>
> **2026-09-08'de kaynağında düzeltildi** (`lib/cari/ekstre-query.ts`): ekstre
> artık açılış bakiyesi için satır üretiyor. Doğrulama sırasında AYNI AİLEDEN
> ikinci ve daha büyük bir hata çıktı — ekstre çek/senedi ters tarafa yazıyordu:
> müşteriden ALINAN çek onun borcunu kapatır, ekstre ise borcu artırıyordu
> (üç caride fark, çek tutarının tam iki katıydı). İkisi de düzeltildi; çeki,
> senedi ya da açılışı olan 13 carinin 13'ünde ekstre ile cari listesi artık
> kuruşu kuruşuna aynı. Kartlar da tekrar "ekstrede de aynı rakam" diyor.

**Doğrulananlar:**

| kart | denetim |
|---|---|
| K-BLG-08 | kart "36 fatura · ₺174.625" → ekran "36 fatura listelendi · ₺174.625,50" **birebir** |
| K-BLG-09 | düzeltmeden sonra 6 belgenin 6'sı listede |
| K-OPR-06 | kartın saydığı 4 adisyon kodunun dördü de varsayılan ekranda |
| K-MUS-06 | iki dal da: ritimden türeyen eşik (Reypo, 30 gün) ve kalibrasyonsuz dal (demo, 90 gün); karşı taraf bloğu telefon + yetkiliyle basıldı |
| K-THS-08 | düzeltilmiş açılış cümlesi ekranda göründü |
| günlük | ekrandaki 3 kart "gösterildi" yazıldı; "Yok say" `DISMISSED` düştü; yerine gelen kart kendi satırını aldı |
| gürültü bütçesi | "+7 konu daha" → yok saydıktan sonra "+6 konu daha" |
| sıralama | önem × tutar sırası ekranda beklendiği gibi (kritik üçlü, tutara göre) |

K-BLG-07 tarayıcıda **görünmedi ve görünmemesi doğru**: ayın 7'sinde beyana 21
gün var. O kartın takvim dalı testle korunuyor (`kdv-donemi.test.ts`).

**NÖBETÇİ TESTE BEŞİNCİ KURAL.** Birinci hata statik olarak yakalanabilirmiş:
hedef ekran `gun` penceresi okuyorsa ve kartın BİRİNCİL linki süzgeç taşıyorsa,
pencereyi de taşımak zorunda. Kural eklendi ve bugünkü hata geri konarak
doğrulandı (mutasyon → test kırılıyor). İki kez daraltıldı: yalnız birincil
aksiyon (ikincil linkler "şuraya da bak" kısayolu) ve yalnız süzgeçli link
(süzgeçsiz link "işte saydıklarım" iddiası taşımaz — K-STK-09'un "alış faturası
gir" düğmesi ürün sayar, fatura değil).

**Test verisi geri alındı.** Doğrulama için Reypo'da ve demo firmada birer
müşteri + fatura oluşturuldu (`TEST-OTO-0001/0002`), denetim bitince ikisi de
silindi; `automation_card_events` tablosu da sıfırlandı — test tıklamalarının
günlükte kalması, günlüğün cevaplamak için tutulduğu soruyu bozardı.

### Test katmanı — 2026-09-07 (üçüncü tur sonu)

Tarayıcı denetimi üç hata buldu ve **yalnız biri** mevcut testlerle
yakalanabilirdi. Bu, kapsamın nerede bittiğini gösterdi: kartların bütün karar
mantığı (süzgeçler, eşikler, ritim hesabı) yalnız BİR KERELİK canlı ölçümle
doğrulanmıştı. Ölçüm regresyon yakalamaz.

Kapsam üç katmana ayrıldı:

| katman | ne korur | nasıl koşar |
|---|---|---|
| **nöbetçi** (`kartlar.test.ts`, 8 kural) | kod şeması, kapılar, linklerin rotaya çıkması, param'ların okunması, **pencere taşıması**, sıralama | `npm test` |
| **saf karar** (6 modülün `*.test.ts`i, 45 test) | mahsup/döviz/taban/açılış süzgeçleri, %75'lik ritim + 30 gün tabanı + 90 gün yedeği, 8 günlük süre aritmetiği, belge numarası kuralı, boş adisyon ayrımı, konsantrasyon eşikleri | `npm test` |
| **kart metni** (`kartlar-metin.test.ts`, 30 test) | başlık/gerekçe DALLARI: boş adisyon, iade sonrası eksi net, sıfır KDV'li belge, süresi dolmuş kuyruk, listedeki belge numarası, Türkçe ek almayan yüzde | `npm test` |
| **canlı sorgu** (`sorgu.canli.test.ts`) | SQL'in kendisi: mahsup sayacı, "ikinci alış" alt sorgusu, `BEKLEMEDE` tanımı | `npm run test:canli` |

**Karar mantığı sorgudan AYRILDI.** Altı veri modülünde artık `…Sec()` biçiminde
saf bir fonksiyon var: sorgu satırları alır, kartın özetini döndürür. Sebep
basit — süzgeçlerin hepsi ölçümle bulundu ve hiçbiri SQL'de değil; biri
kaldırılırsa sorgu hata VERMEZ, kart sessizce yanlış kaydı gösterir.

**Sekiz mutasyonun sekizi de yakalanıyor** (döviz süzgeci, taban, p75→medyan,
30 gün tabanı, belge numarası kuralı, süre aritmetiği, boş adisyon ayrımı, en az
5 müşteri şartı). Canlı takımda da iki mutasyon sınandı: mahsup sayacını SQL'de
sıfırlamak ve `BEKLEMEDE`yi düz eşitliğe döndürmek — ikisi de kırıyor.

**Canlı takım `npm test`in parçası DEĞİL.** `vitest.config.mts`teki "veritabanına
dokunma" kararı yerinde duruyor; canlı takım kendi yapılandırmasıyla koşuyor,
fixture'ları `OTO-TEST` ön ekiyle açıyor ve testler patlasa bile `afterAll`
içinde siliyor. Hedef firma `OTOMASYON_CANLI_FIRMA` ile seçiliyor (varsayılan
`reypo`); koşumdan sonra kalıntı olmadığı ayrıca doğrulandı.

**Kart metinleri de bağlandı.** Üreticiler dışa açıldı ve dallar tek tek
sınanıyor. Test cümlenin tamamını değil, dalın AYIRT EDİCİ parçasını tutuyor:
metin güzelleştirilebilsin, ama "hangi durumda ne söylendiği" değişmesin.
Sınanan dallar, yazım sırasında ya da tarayıcıda ELLE yakalanmış hatalar:

- boş adisyona "satışı rapora girmedi" denmemesi (ortada satış yok)
- iadeler neti eksiye düşürdüğünde "3 fatura -₺2.693" denmemesi
- KDV'si sıfır olan belgelerin "hiç belge yok" sayılmaması (ölçü tutar değil ADET)
- süresi tamamen dolmuş kuyrukta "N gün kaldı" denmemesi
- kartın listedeki belge numarasını yazması (iç numarayı değil)
- "ekstredeki rakamın aynısı" iddiasının geri gelmemesi
- yüzdelerin Türkçe ek almadan yazılması ("%72'si" ile "%48'i" farkı şablondan
  üretilemez — sayının okunuşuna bağlı)

Beş metin mutasyonunun beşi de yakalanıyor.

**Hâlâ testsiz olan:** UÇ davranışı — susturma, gösterim bütçesi, hata yutmama.
İki turdur elle sınanıyor (2026-09-06 ve 09-07 tarayıcı denetimleri).

### Bu turun asıl bulgusu: fikir değil VERİ bitti

Üçüncü turda altı aday daha ölçüldü ve **beşi veri inceliğinden elendi** — hiçbiri
tanım hatasından değil. Elenme sebeplerinin tamamı aynı cümlenin varyasyonu:
ölçü doğru, ölçülecek kayıt yok.

| aday | kapsam |
|---|---|
| marj kartları | EREN FORKLİFT'te satılan 42 üründen 7'sinin maliyeti biliniyor |
| gider sapması | 155 tedarikçi çiftinin 3'ünde 3 aylık geçmiş var |
| KDV oranı tutarsızlığı | 114 üründen 2'si, ikisi de test kaydı |
| e-Arşiv/e-Fatura uyumu | 349 müşterinin 4'ünde pinlenmiş PK var |
| mükerrer hareket | 2 grup, ikisi de tek firmada |

Bu, kart yazmanın bittiği anlamına gelmiyor; **sıradaki kazançların kaynağı kod
değil kullanım** demek. Alış faturaları girildikçe marj ve tedarikçi kartları,
kasa sayımı yapıldıkça K-OPR-04/05, bordro kullanıldıkça K-NKT-03 kendiliğinden
ölçülebilir hâle geliyor. Katalogdaki "ölçüldü, yazılmadı" tablosu bu yüzden
tutuluyor: her biri veri geldiğinde yeniden ölçülecek bir iş emri.

### Sıradaki iş

1. **Vade taşı ALIŞ tarafındaydı; kaynağı bağlandı** (2026-09-07, yukarıya bak).
   Gelen e-faturanın kendi vade tarihi artık aktarımda forma düşüyor. **A
   motorunun kalan kartları (K-NKT-01/02/04) hâlâ beklemede**, ama artık eksik
   olan şey kod değil VERİ: çıkış kovaları dolmaya başlayana kadar "nakit eşiğin
   altına iniyor" kartı sessiz doğar. Ölçüm birkaç hafta sonra tekrarlanmalı —
   ilk aktarılan faturalarda `dueDate` doluluğuna bakılacak.
2. Faz 3 — B motoru: cari ödeme davranışı profili. K-THS-01…03'ü açar;
   K-THS-07 bugünün ölçülebilir çekirdeğini şimdiden veriyor. `dueDate`e
   bağımlılığı A motorundan az.
3. Maaş ve tekrarlayan gider, kendi verileri birikince yeniden ölçülür
   (yukarıdaki A motoru ölçümü). Bordro modülü kullanılmaya başlanırsa K-NKT-03,
   gider kategorisi doldurulmaya başlanırsa tekrarlayan gider açılır.
4. **Kartlar 11'e çıktı, pano hâlâ 3 basıyor.** Gürültü bütçesi (§7) ilk kez
   ısırıyor: EREN VİNÇ'te aynı anda 5, Reypo'da 6 kart üretiliyor ve sıralama
   yalnız `önem`e bakıyor — `önem × parasal etki` henüz kodlanmadı. Bugün ₺1.500
   ile ₺890.000 aynı kademede yarışıyor. Sıradaki iş budur; `automation_card_events`
   günlüğü de ancak doğru sıralanmış bir panoda anlamlı veri biriktirir.
5. Restoran tarafı yeni açıldı (K-OPR-06). K-OPR-05 (gün sonu kapatılmadı) hâlâ
   ölçülemiyor: veritabanında hiç `CashCount` kaydı yok.
6. **K-BLG-08'in 8 günü hukuki bir varsayımdır** ve tek yerde duruyor
   (`YANIT_SURESI_GUN`). Mevzuat değişirse ya da bu ürünün müşterileri için
   farklı bir uygulama benimsenirse tek satır değişir; kartın metni süreyi o
   sabitten okuyor.

### Çalışma yöntemi (bu iş boyunca izlendi)

**Kart yazmadan önce veriye sor.** Yayına girmeden durdurulan yanlış-pozitif
sınıfları: negatif stoklu ürünler (K-STK-01), hizmet kalemleri (K-MUS-04),
kombinatoryal mükerrer eşleşmesi (K-BLG-02), mahsuplu cari · yuvarlama artığı ·
açılış bakiyesi (K-THS-08 / K-TDR-05), boş adisyonu "kayıp ciro" sayma
(K-OPR-06). Bir kez haksız çıkan kart, kartların tamamına olan güveni bitirir —
anatominin 5. kuralı.

**Ölçemediğin dalı testle tut.** Üçüncü turda bir süzgeç canlı veride HİÇ
koşmadı (CREDIT açılış bakiyesi: 405 carinin tamamı DEBIT). Ölçüm orada bir şey
söyleyemez; işaret yönü `ters-bakiye.test.ts` ile korunuyor ve test mutasyonla
doğrulandı. Ölçülemeyen yerde susmak, kartı ilk kullanıcıda patlatmaktır.

---

## 1. Amaç

İşletme sahibinin **fark etmediği** şeyleri, fark etmesi gereken anda, ne yapacağını da
söyleyerek önüne koymak. Ölçü şudur: kartı okuyan kişi ekranı terk etmeden karar
verebilmeli. "Stok 6 paket" bir bilgidir, karar değildir. "4 gün sonra bardaksız
kalacaksın, Ege Ambalaj 4 günde getiriyor, Murat Bey 0532…" karardır.

Kartların hemen tamamı **modelsizdir** — SQL, aritmetik ve eşik. Yapay zekâ bu katmanın
üstüne, bu katman biriktirdiği veriyle çalışacak biçimde sonra gelir (bkz. §6).

## 2. Kart anatomisi — altı kural

Her kart bu altısını taşır. Taşımayan kart katalogda yer almaz.

1. **Durum değil, sonuç.** ~~"Stok kritik seviyede"~~ → "4 gün sonra bardaksız kalacaksın."
2. **Son tarih.** Ne zamana kadar aksiyon alınmalı, alınmazsa ne olur.
3. **Karşı taraf, iletişimiyle.** Kimi arayacağı kartta yazsın (`Supplier.phone`,
   `contactPerson`; `Customer.phone`).
4. **Tek tıkla aksiyon.** Sipariş oluştur / ara / hatırlatma gönder / ilgili ekrana git.
5. **Gerekçe görünür.** "50/gün × 4 gün tedarik". Kart bir kez haksız çıkarsa güven biter;
   hesabı göstermek onu onarır.
6. **Susma kuralı.** Aksiyon alınınca kapanır; "yok say" denince N gün geri gelmez.

### Veri girişi kuralı

Kartlar kullanıcı formu doldurmadığı için ölmemeli. Üç basamak, bu sırayla:

1. **Türet.** Sayı, işletmenin zaten yaptığı işlemden çıkarılabiliyor mu? Tüketim hızı,
   tedarikçi tercihi, ödeme davranışı, alım ritmi, zam geçmişi — hepsi çıkarılabilir.
   Ayarlar ekranına konan alan, doldurulmayan alandır.
2. **Anın içinde ve doldurulmuş sor.** Türetilemiyorsa kartın kendisi sorsun:
   *"Ege Ambalaj bardağı kaç günde getiriyor? `[4]` gün — son 3 alışın arasına göre tahmin
   ettim."* Kullanıcı o an ihtiyaç duyduğu için cevaplar.
3. **Bilmiyorsan sus değil, söyle.** *"Tedarik süresini bilmiyorum; son 3 alışın arası
   ortalama 11 gün. Buna göre 3 gün içinde sipariş verin."* Zayıf öneri, öneri
   yokluğundan iyidir.

Reçete gibi gerçekten girilmesi gereken veride bile türetme çalışır: satış adedi ile
hammadde düşümü arasındaki oran birkaç haftada reçeteyi tahmin eder, kullanıcıya
onaylatılır — boş forma reçete girdirmekten çok daha yüksek tamamlanma verir.

## 3. Kart formatı

Katalogdaki her kart bu alanları doldurur. Alanlar aynı zamanda §5'teki kayıt modelinin
karşılığıdır.

| Alan | Açıklama |
|---|---|
| `kod` | `K-<ALAN>-<NN>` — **asla değişmez**, kayıtta birincil ayrımdır |
| `ad` | İnsan okur adı |
| `motor` | A nakit takvimi · B davranış profili · C akış hızı · D sapma ölçeri |
| `hazırlık` | ◆ bugün yapılabilir · ▲ küçük şema eki · ○ müşteri verisine bağlı |
| `tetik` | Hesaplanabilir koşul, tek cümle |
| `girdi` | Okunan tablo/alanlar |
| `özne` | Kartın hakkında olduğu kayıt (`product`/`customer`/`supplier`/`check`/…) |
| `kart` | Şablon metni, yuvalarıyla |
| `aksiyon` | Butonlar (`actionKey` değerleri) |
| `karşı taraf` | İletişim bilgisi eklenecek kayıt |
| `önem` | KRİTİK / YÜKSEK / ORTA / DÜŞÜK — sıralama ve gürültü bütçesi için |
| `susma` | Aksiyon ve "yok say" sonrası davranış |

### Kod şeması

| Önek | Alan |
|---|---|
| `K-STK` | Stok ve tükenme |
| `K-TDR` | Tedarikçi ve alış |
| `K-NKT` | Nakit takvimi |
| `K-THS` | Tahsilat |
| `K-MUS` | Müşteri ve satış |
| `K-MRJ` | Fiyat ve marj |
| `K-OPR` | Operasyon ve personel |
| `K-BLG` | Belge ve uyum |
| `K-SIS` | Sistem, abonelik, kontör |

Eşik veya metin değişirse kod korunur, `cardVersion` artar. Kodu yeniden kullanmak
geçmiş veriyi bozar; emekliye ayrılan kart kodu boşta bırakılır.

---

## 4. Katalog

### 4.1 Stok ve tükenme — `K-STK`

> **ÖLÇÜM — 2026-09-06, canlı veri.** K-STK-01 kodlandı ve gerçek veride koşuldu.
> Son 28 günde stok çıkışı olan 61 üründen:
>
> | | adet | sonuç |
> |---|---|---|
> | negatif stoklu | **43** | elendi — tedarik sorunu değil, KAYIT HATASI |
> | 28 günde < 3 hareket | 11 | elendi — tek satış eğilim değildir |
> | aday | 7 | en yakını 12 gün, eşik 4 → **kart çıkmadı** |
>
> Kod doğru çalışıyor; sıfır kart bu verinin doğru cevabı. Ama üç şey açığa çıktı:
>
> 1. **Alışlar sisteme girilmiyor.** 43 üründe stok eksi — açılış stoğu ya da alış
>    faturası yok, satış var. Bu düzelmeden K-STK-01 anlamlı çalışamaz.
> 2. **`Order.deliveryDate` yolu ölü.** Tüm veritabanında **1** alış siparişi var ve
>    onun da teslim tarihi boş. Tedarik süresi pratikte hep varsayılana düşer.
> 3. **Tedarikçi türetmesi ancak alış faturası olan üründe çalışır.** EREN FORKLİFT'te
>    15 kalem `productId`+`supplierId` dolu, ama hareket eden 44 ürün onlar değil.
>
> **Sonuç: K-STK-09 (negatif stok), K-STK-01'den ÖNCE gelmeli.** Stok kayıtları
> tutarlı hâle gelmeden tükenme kartının çıkacağı bir zemin yok. Faz sırası (§8)
> buna göre güncellendi.
>
> **K-STK-09 aynı gün kodlandı ve ölçüldü.** 7 firmada ateşliyor; teşhis satırı
> kök sebebi doğruluyor:
>
> | firma | eksi stoklu ürün | hiç alış faturası olmayan |
> |---|---|---|
> | EREN FORKLİFT | 35 | **35** |
> | Reypo Medya Ajansı | 11 | 9 |
> | ASDOĞUŞ PAZ. | 2 | 2 |
> | diğer 4 firma | 1–2 | hepsi |
>
> Yani sorun "alış eksik girilmiş" değil, **alış hiç girilmemiş**. Kart bunu
> ayırt edip söylüyor.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-STK-01 | Tükenme + tedarik süresi | `stok ÷ günlük hız` < `tedarik süresi + pay`; stok ≥ 0 ve pencerede ≥3 hareket | ◆ **kodlandı** |
| K-STK-02 | Sipariş ritmi kaçtı | Alışın gün örüntüsü kırıldı ve stok penceresi daralıyor | ◆ |
| K-STK-03 | Siparişleri birleştir | Aynı tedarikçide ≥2 ürün 7 gün içinde bitiyor | ◆ |
| K-STK-04 | Sipariş gecikti | `Order.deliveryDate` geçti, stok girişi yok | ◆ |
| K-STK-05 | Ölü stok, aksiyonlu | 90 gün hareketsiz + bağlı sermaye tutarı | ◆ |
| K-STK-06 | Yeni ürün hiç satılmadı | Eklendi + 30 gün, satış 0 | ◆ |
| K-STK-07 | Tatil öncesi hazırlık | `CompanyHoliday` + geçen yılki aynı dönem hızı | ◆ |
| K-STK-08 | Mevsimsel yükseliş | Geçen yıl aynı haftada hız ≥ %40 arttı | ◆ |
| K-STK-09 | Negatif stok | `stockQuantity < 0` — kayıt hatası | ◆ **kodlandı** |
| K-STK-10 | Sayım ile kayıt farkı | Fiziksel sayım ≠ sistem | ○ |

**K-STK-01 · Tükenme + tedarik süresi** *(referans kart — format örneği)*

```
motor        C
hazırlık     ◆
tetik        (stok ÷ son 28 günün günlük ortalama OUT hareketi) < (tedarik süresi + 1 gün)
girdi        StockMovement(type=OUT, createdAt, quantity) · Product.stockQuantity
             Order(date → deliveryDate) · InvoiceItem.productId → Invoice.supplierId
             Supplier(name, contactPerson, phone)
türetme      tamamı türetilir. Tedarik süresi yoksa: son 3 alış faturası arası ortalama
             fallback, kart içinde "kaç günde getiriyor?" sorusu doldurulmuş gelir
özne         product
kart         "Bugün {ürün} siparişi vermezsen {n} gün sonra {ürün}sız kalacaksın.
              Günde {hız} {birim} gidiyor, elde {stok} {birim} var, {tedarikçi}
              ortalama {tedarik} günde teslim ediyor. Önerilen miktar {miktar}
              ({kapsam} günlük ihtiyaç).
              {tedarikçi} — {yetkili} · {telefon}"
aksiyon      siparis_olustur · tedarikciyi_ara · miktari_duzenle
karşı taraf  Supplier
önem         stoksuz gün ≤ 1 → KRİTİK · ≤ 3 → YÜKSEK · değilse ORTA
susma        sipariş oluşturulunca kapanır · yok say → 3 gün · miktar düzenlenirse kapanır
```

**K-STK-03 · Siparişleri birleştir**

```
tetik        aynı tedarikçiden ≥2 ürün 7 gün içinde tükeniyor
kart         "{ürün1} {n1} gün, {ürün2} {n2} gün sonra bitiyor. İkisi de {tedarikçi} —
              tek siparişte birleştirirsen ikinci nakliyeyi ödemezsin."
aksiyon      birlesik_siparis_olustur · tedarikciyi_ara
önem         ORTA
```

### 4.2 Tedarikçi ve alış — `K-TDR`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-TDR-01 | Alış fiyatı zamlandı | Son alış birim fiyatı önceki ortalamanın %10+ üstünde | ◆ |
| K-TDR-02 | Başka tedarikçide daha ucuz | Aynı `productId`, başka `supplierId`, son 6 ay, düşük birim fiyat | ◆ |
| K-TDR-03 | Teslim süresi uzuyor | Son 3 teslim ortalaması, önceki 6 teslimin %50+ üstünde | ◆ |
| K-TDR-04 | Tek tedarikçiye bağımlılık | Bir ürünün son 12 ay alımının %100'ü tek tedarikçide, tutar yüksek | ◆ |
| K-TDR-05 | Tedarikçiye fazla ödeme | Tedarikçi bakiyesi lehinize döndü (mahsup/açılış/döviz elenmiş) | ◆ **kodlandı** |

**K-TDR-02 · Başka tedarikçide daha ucuz** — kimsenin elle yapmadığı karşılaştırma
olduğu için değeri yüksek.

```
girdi        InvoiceItem(productId, unitPrice, quantity) → Invoice(type=PURCHASE, supplierId, date)
kart         "{ürün} birim fiyatı son faturada %{artış} arttı ({eski} → {yeni}).
              Aynı ürünü {ay} ay önce {alt tedarikçi}'den {alt fiyat}'a almışsın.
              Aylık {adet} {birim} alıyorsun — fark aylık {tasarruf}.
              {alt tedarikçi} — {yetkili} · {telefon}"
aksiyon      alternatifi_ara · fiyat_gecmisini_gor
önem         aylık fark > eşik → YÜKSEK
```

### 4.3 Nakit takvimi — `K-NKT`

> Bu grubun tamamı **A motoruna** bağlı. A motorunun çek/senet ayağı 2026-09-07'de
> bağlandı (`lib/raporlar/nakit-kiymet.ts`): ileri vadeli portföy evrakı artık kendi
> vadesindeki kovaya düşüyor. Maaş, tekrarlayan gider ve günlük çözünürlük ÖLÇÜMLE
> ertelendi — gerekçeleri §0 "A motoru ölçümü"nde. Kalan K-NKT kartlarının önündeki
> asıl engel A motoru değil, `Invoice.dueDate` doluluğudur.

> **K-NKT-06 kodlandı** — 3 firmada ateşliyor. EREN VİNÇ'te ₺480.000'lik çek 89,
> ₺402.926'lık çek 45 gündür vadesi geçtiği hâlde portföyde.
>
> **Kart TOPLAM TUTAR YAZMAZ, evrakları tek tek listeler.** Bir firmada
> ₺3.213.123.123.123 tutarlı bir çek var; toplansaydı kart "₺3,2 trilyon"
> diyecekti. Tek tek listelenince saçma rakam kendi satırında kalıyor,
> yanındaki ₺123.680 ve ₺1.233.321 okunabilir duruyor.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-NKT-01 | Ödeme günü önerisi | Planlanan çıkış, o günkü projeksiyonu eşiğin altına indiriyor | ▲ |
| K-NKT-02 | Nakit eşiğin altına iniyor | Projeksiyonda ilk eşik altı gün ≤ 30 gün | ▲ |
| K-NKT-03 | Maaş günü açığı | Maaş çıkışı > o günkü beklenen bakiye | ▲ |
| K-NKT-04 | Aynı güne yığılma | Tek günde ≥3 büyük çıkış üst üste | ▲ |
| K-NKT-05 | Atıl nakit | Bakiye − 30 günlük net çıkış > eşik | ▲ |
| K-NKT-06 | Vadesi geçmiş çek/senet portföyde | `dueDate < bugün` ve `status = PORTFÖYDE` | ◆ **kodlandı** |
| K-NKT-07 | Vade tatile denk geliyor | Vade `CompanyHoliday` veya hafta sonunda | ◆ |
| K-NKT-08 | Kasada eksi bakiye | `FinancialAccount.balance < 0` VE `type = CASH` | ◆ **kodlandı** |

**K-NKT-01 · Ödeme günü önerisi** *(çek örneği)*

```
motor        A
tetik        kullanıcı bir çıkış planlıyor (çek/ödeme) ve o gün bakiye < eşik
girdi        projeksiyon (günlük) · Check/PromissoryNote(dueDate, direction, status)
             PayrollRecord(PENDING) · tekrarlayan gider · cari yaşlandırma + davranış profili
özne         check
kart         "{tarih}'e {tutar} çek kesme: o gün bakiye {bakiye} kalıyor, açık {açık}.
              {öneri tarihi}'ni öner — o tarihe kadar {cari}'den {tahsilat} ve
              {n} fatura tahsilatı bekleniyor, bakiye {yeni bakiye}."
aksiyon      onerilen_tarihi_uygula · odeme_takvimini_gor · senaryo_calistir
önem         KRİTİK
susma        tarih değiştirilirse kapanır · yok say → o çek için kalıcı
```

### 4.4 Tahsilat — `K-THS`

> B motoru (cari ödeme davranışı profili) bu grubun tamamının önkoşulu:
> cari başına `AVG(ödeme tarihi − vade)`, hatırlatmaya yanıt süresi, süreklilik.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-THS-01 | Bugünkü arama listesi | Açık alacaklar `tutar × tahsil olasılığı` ile sıralı ilk 3 | ▲ |
| K-THS-02 | Vadesi gelmeden hatırlat | Vadeye ≤3 gün + carinin ortalama gecikmesi > 7 gün | ▲ |
| K-THS-03 | Ödeme davranışı bozuldu | Son 3 faturanın gecikmesi, önceki 12 ayın belirgin üstünde | ▲ |
| K-THS-04 | Hiç hatırlatılmamış alacak | Vade geçti + hiç hatırlatma kaydı yok | ◆ |
| K-THS-05 | Açık bakiye limiti aştı | Cari açık bakiye, geçen yıl aynı dönemin belirgin üstünde | ◆ *(risk limiti ölçüldü: 349 müşterinin 2'sinde dolu)* |
| K-THS-06 | Ödeme linki ödenmedi | `PaymentLink.status = ACTIVE` + oluşturma üstünden N gün | ◆ |
| K-THS-07 | Vadesi geçmiş alacak | Vadesi geçmiş satış faturası VE cari bakiye hâlâ borçlu | ◆ **kodlandı** |
| K-THS-08 | Faturasız tahsilat | Müşteri bakiyesi alacaklıya dönmüş — alınan para kesilen faturayı aşıyor | ◆ **kodlandı** |

> **ÖLÇÜM — 2026-09-06.** K-THS-07 yeni bir koddur; K-THS-04'ün yerine geçmez.
> K-THS-04 "vade geçti VE hiç hatırlatma kaydı yok" diyor, hatırlatma kaydı tutan
> tablo yok. Aynı kodu bugünkü dar tanımla yazmak, tablo geldiğinde kodun farklı
> bir soruyu ölçmesi olurdu (§3, kod asla değişmez).
>
> **İki ölçüm kartın şeklini belirledi:**
>
> *1. Vade alanı ölü, türetme diriltiyor.* 302 SENT satış faturasının yalnız
> **16'sında** (%5) `dueDate` dolu. `Customer.paymentDueDays` ise 348 müşterinin
> **168'inde** dolu; fatura tarihine eklenince kapsam **16 → 53** faturaya
> çıkıyor. Kart hangi vadeyi kullandığını cümle içinde söylüyor.
>
> *2. "Faturası ödenmemiş" ≠ "bize borcu var".* Faturanın kendi ödeme kayıtlarına
> bakan ilk sürüm, gecikmiş görünen 4 müşterinin **ikisinde yanılıyordu** — para
> tahsil edilmiş ama cariye işlenip faturaya bağlanmamıştı:
>
> | müşteri | açık fatura | cari bakiye | karar |
> |---|---|---|---|
> | DENTAŞ KAĞIT | ₺21.600 | ₺60.000 | gerçek alacak (bakiye daha büyük) |
> | Pusula Tekstil | ₺6.462 | ₺98.789 | gerçek alacak |
> | UMUT YAŞAR KÜSMEN | ₺8.000 | **₺0** | ödenmiş — elendi |
> | KADİR ÖZDEMİR | — | **₺0** | ödenmiş — elendi |
> | earsin sinar | ₺16.155 | **−₺78.365** | fazla ödemiş — elendi |
>
> Bu yüzden tutar `lib/cari/list-query.ts`teki bakiyeden okunur — cari ekranının
> ta kendisi. İkinci bir formül, kartın "borcu var" derken ekstrenin "kapalı"
> demesi olurdu. Kart bakiyenin ne olduğunu gerekçede açıkça yazar.

**K-THS-02 · Vadesi gelmeden hatırlat** — tahsilat takibini reaktiften proaktife çeviren
tek kart.

```
kart         "{cari}'nin {tutar} faturası {n} gün sonra vadesinde. Son {m} faturayı
              ortalama {gecikme} gün geç ödedi — şimdi hatırlatırsan vadesinde ödeme
              olasılığı yüksek. {cari} — {yetkili} · {telefon}"
aksiyon      hatirlatma_gonder · odeme_linki_olustur · cari_ekstresi
önem         tutar × gecikme eğilimi
```

### 4.5 Müşteri ve satış — `K-MUS`

> **ÖLÇÜM — K-MUS-04 kodlandı ama bu veride SESSİZ, ve sessiz olması doğru.**
>
> İlk sürüm üç firmada ateşliyordu ve bulguların **tamamı yanlıştı**:
> *"VİNÇ ÇALIŞMA BEDELİ: ALİ ÖNAL ₺2.000 ↔ YİĞİTALP ₺45.000, %2150 fark."*
> Kalemlerin hepsi `isService = true` çıktı — hizmette `unitPrice` işin TOPLAM
> bedelidir, iki saatlik vinç işiyle bir haftalık iş arasında yirmi kat fark
> normaldir. `isService = false` süzgeci eklenince 10 firmanın hiçbirinde kart
> kalmadı.
>
> Kart doğru; veri fiziksel ürün satan bir müşteride ateşleyecek. Süzgeçsiz
> yayına almak, vinç kiralayan bir firmaya "%2150 fiyat farkı" göstermek olurdu.
>
> Net fiyat tanımı `lib/stock/sale-price.ts`teki `LINE_NET`ten gelir — o dosya
> için dışa açıldı. İkinci bir kopya, aynı ürünün kartta ve ürün ekranında farklı
> fiyatla görünmesi demek olurdu.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-MUS-01 | Susan müşteri + sebep | Son alım > 2× kendi ritmi | ◆ *(sinyal var)* |
| K-MUS-02 | Çapraz satış, isim isim | A alan müşterilerin çoğu B de alıyor, bu üçü almıyor | ◆ |
| K-MUS-03 | Yanıtsız teklif | `Quote.status = SENT` + `validUntil` yaklaşıyor | ◆ |
| K-MUS-04 | Aynı ürüne farklı fiyat | Aynı `productId`, ÜRÜN (hizmet değil), müşteri başına EN SON net fiyat, %25+ fark | ◆ **kodlandı** |
| K-MUS-05 | En kârlı müşteride ritim bozulması | Ciro ilk %10 + ritim kırılması | ◆ |
| K-MUS-06 | İkinci sipariş gelmedi | Tek alım + sessizlik > firmanın kendi ritminin 2 katı (taban 30 gün) | ◆ **kodlandı** |
| K-MUS-07 | Tek müşteriye bağımlılık | 12 aylık ciroda en büyük müşterinin payı ≥ %40 (en az 5 müşteri) | ◆ **kodlandı** |

**K-MUS-04 · Aynı ürüne farklı müşteriye farklı fiyat**

```
kart         "{ürün}'ü {müşteri A}'ya {fiyat A}, {müşteri B}'ye {fiyat B} satıyorsun
              (%{fark} fark). {müşteri B} son 12 ayda {ciro} ciro yaptı."
aksiyon      fiyat_listesini_gor · musteriyi_ara
önem         ORTA
```

### 4.6 Fiyat ve marj — `K-MRJ`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-MRJ-01 | Marj hedefin altına indi | Güncel marj < hedef marj | ▲ *(hedef alanı yok)* |
| K-MRJ-02 | Zararına satış | Satış fiyatı < güncel maliyet | ◆ *(sinyal var)* |
| K-MRJ-03 | Fiyat aylardır sabit, maliyet arttı | Fiyat N aydır sabit + maliyet %X arttı | ◆ |
| K-MRJ-04 | Çok satan, düşük marjlı | Adette ilk %20, marjda son %20 | ◆ |
| K-MRJ-05 | İskonto marjı yiyor | İskonto sonrası efektif marj hedefin altında | ◆ |

### 4.7 Operasyon ve personel — `K-OPR`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-OPR-01 | Fire / reçete sapması | Beklenen tüketim ile gerçek arasında %X üstü fark | ○ *(reçeteye bağlı)* |
| K-OPR-02 | İskonto yoğunlaşması | İskonto tutarı normalin N katı + kişi/saat kümelenmesi | ◆ |
| K-OPR-03 | Çalışma saati dışı işlem | Mesai dışı satış/iptal/iskonto | ◆ |
| K-OPR-04 | Kasa sayım farkı | `CashCount.difference` eşiğin üstünde, tekrarlıyor | ◆ |
| K-OPR-05 | Gün sonu kasa kapatılmadı | Gün bitti, sayım kaydı yok | ◆ |
| K-OPR-06 | Açık kalan adisyon | `RestaurantTicket` gün devrederek açık | ◆ **kodlandı** |
| K-OPR-07 | Fazla mesai birikiyor | Dönem mesai toplamı geçen dönemin belirgin üstünde | ◆ |
| K-OPR-08 | Yoğun güne izin çakışması | Talep yüksek gün + onaylı izin | ○ |
| K-OPR-09 | Talep–personel uyumsuzluğu | Beklenen işlem, vardiya kapasitesinin üstünde | ○ |

### 4.8 Belge ve uyum — `K-BLG`

> **ÖLÇÜM — 2026-09-06.** K-BLG-01 kodlandı; **8 firmada** ateşliyor ve şu ana kadarki
> en yüksek parasal karşılığa sahip kart:
>
> | firma | aktarılmamış fatura | KDV indirimi | gider |
> |---|---|---|---|
> | HİDROEREN | 145 | **₺484.442** | ₺3.271.120 |
> | EREN FORKLİFT PNÖMATİK | 117 | ₺453.796 | ₺2.905.927 |
> | Reypo Medya Ajansı | 517 | ₺372.974 | ₺3.816.857 |
> | EREN FORKLİFT | 113 | ₺231.573 | ₺1.856.620 |
> | diğer 4 firma | 4–41 | ₺11K–214K | — |
>
> Üç süzgeç de ölçümden doğdu ve gerekçeleri `lib/otomasyon/veri/islenmemis-fatura.ts`
> başlığında:
>
> 1. **`status = 'KABUL'`** — veride 48 RED, 66 YANIT_BEKLENIYOR var; reddedilmiş
>    faturayı "aktarmadın" diye hatırlatmak yanlış.
> 2. **Tutar yalnız TRY'den** — 62 USD + 1 EUR + 1 CAD fatura var. Döviz faturalar
>    SAYILIR ama toplama girmez ve kart bunu söyler.
> 3. **7–90 gün penceresi** — bugün gelen fatura geç değildir; 1789 gün önceki kuyruk
>    da aksiyon değildir. Penceresiz ilk sürüm "₺78 milyar gider kayıtlarda yok"
>    diyordu (altı adet ₺24,5 milyarlık çöp kayıt yüzünden).

> **K-BLG-04 de kodlandı** — 8 firmada ateşliyor. Reypo Medya Ajansı: **167 satış
> faturası taslakta**, ₺589.436 hiç faturalanmamış, en eskisi 128 gün. K-BLG-01'in
> aynası: o gideni kaçırır, bu GELİRİ.
>
> **K-BLG-05 (banka) yazılmadı:** veritabanında tek bir `bank_statement_items`
> satırı yok. Ateşlemeyecek kart yazmak yerine, ekstre girişi kullanılmaya
> başlayınca eklenecek.

> **K-BLG-02 YAZILMADI — tanım çalışmıyor.** Üç ayrı mükerrer tanımı ölçüldü:
>
> | tanım | sonuç |
> |---|---|
> | aynı gönderen + aynı tutar + ±3 gün | Reypo'da **6.376 çift** — kombinatoryal patlama |
> | aynı gönderen + aynı tutar + aynı gün | 84 grup, ama örnekler FARKLI fatura numaraları |
> | aynı gönderen + **aynı fatura no** | **sıfır** — gerçek mükerrer belge yok |
>
> Aynı tutarlı çok sayıda fatura ikişerli eşleşince sayı patlıyor; aynı gün + aynı
> tutar da yetmiyor, çünkü örneklerin hepsi ayrı belge numarası taşıyor (yani ayrı
> faturalar). Güvenilir tek ölçüt olan "aynı fatura no" hiç eşleşme vermiyor —
> `@@unique([companyId, uuid])` zaten yeniden çekimi eliyor.
>
> **Doğru sürüm KALEM İÇERİĞİNİ karşılaştırmalı** (sunumun kendi örneği de bunu
> diyor: *"Kalem içerikleri birebir aynı"*). Kalemler `IncomingInvoice.raw` içinde;
> ayrıştırma gerektirir, yani bu bir "ucuz kazanç" değil. Faz 4'ten çıkarıldı.
>
> Yanlış sürümü yayına almak, kart anatomisinin 5. kuralını ihlal ederdi: bir kez
> haksız çıkan kart, kartların tamamına olan güveni bitirir. 84 ayrı faturayı
> "mükerrer" diye göstermek tam olarak budur.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-BLG-01 | İşlenmemiş gelen fatura | `isLinkedToPurchase=false` + `status=KABUL` + yaş 7–90 gün | ◆ **kodlandı** |
| K-BLG-02 | Aynı içerikli ikinci fatura | **kalem karşılaştırması gerekiyor** — aşağıya bak | ○ *(ertelendi)* |
| K-BLG-03 | Faturalanmamış irsaliye | `Waybill.invoiceId = null` + tarih yaşı | ◆ *(ertelendi: tüm veritabanında 4 irsaliye)* |
| K-BLG-04 | Bekleyen taslak fatura | SATIŞ + `status IN (DRAFT, GIB_DRAFT)` + ≥3 gün | ◆ **kodlandı** |
| K-BLG-05 | Eşleşmemiş banka hareketi | `BankStatementItem.isMatched = false` | ◆ *(veri yok: hiç ekstre kalemi girilmemiş)* |
| K-BLG-06 | Vergi bilgisi eksik cari | VKN/TCKN yok — e-fatura kesilemez | ◆ |
| K-BLG-07 | Beyan dönemi yaklaşıyor | Ayın 16–28'i + geçen dönemin KDV pozisyonu + aktarılmamış faturalardaki indirim | ◆ **kodlandı** |
| K-BLG-08 | Ticari faturanın yanıt süresi | `BEKLEMEDE` + `TICARIFATURA` + belge tarihi + 8 gün | ◆ **kodlandı** |
| K-BLG-09 | Entegratöre takılmış fatura | `status=SENT` + `integrationStatus` ERROR/REJECTED | ◆ **kodlandı** |

**K-BLG-01 · İşlenmemiş gelen fatura** — doğrudan para kaybı, en ucuz kartlardan biri.

```
kart         "{n} gün önce gelen {adet} fatura hâlâ aktarılmadı: {tutar} gider ve
              {kdv} KDV indirimi kayıtlarda yok."
aksiyon      gelen_kutusunu_ac · toplu_aktar
önem         YÜKSEK
```

### 4.9 Sistem, abonelik, kontör — `K-SIS`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-SIS-01 | Kontör bitiyor | `UsageLimit` tüketim hızı × kalan → N gün | ◆ |
| K-SIS-02 | Abonelik bitiyor | `Subscription` bitişine N gün | ◆ *(var)* |
| K-SIS-03 | e-Dönüşüm bağlantısı koptu | Entegratör yetkilendirmesi geçersiz | ◆ |
| K-SIS-04 | Kilitli modül tanıtımı | Kapalı ücretli modül + kullanım sinyali | ◆ *(banner var)* |

**K-SIS-01 · Kontör bitiyor** — hem müşteri için kritik (fatura kesilemez) hem Kobipo
için gelir kartı.

```
kart         "Kontörün {kalan} belge. Ayda ortalama {hız} belge kesiyorsun —
              yaklaşık {gün} gün sonra biter ve fatura kesemezsin."
aksiyon      kontor_satin_al · kullanim_gecmisi
önem         gün ≤ 5 → KRİTİK
```

---

## 5. Etkileşim günlüğü

Kartlar yayına girdiği andan itibaren her gösterim bir **etiketli veri noktasıdır**.
Bu kayıt tutulmazsa yapay zekâ fazı sıfırdan başlar ve geriye dönük telafisi olmaz.

### Model

```prisma
/// Otomasyon kartlarının gösterim ve karar günlüğü.
///
/// AMACI SADECE ÖLÇÜM DEĞİL: ileride "bu kullanıcı hangi karta yanıt veriyor,
/// hangi eşikte umursuyor" sorusunun eğitim verisi buradan çıkacak. Bu yüzden
/// `cardKey` ASLA değişmez ve `payload` karta basılan rakamları saklar — sonradan
/// "kart haklı çıktı mı" denetimi ancak o rakamlarla yapılabilir.
model AutomationCardEvent {
  id          String    @id @default(cuid())
  companyId   String
  userId      String?   // kartı gören kişi; rol bazlı fark için
  cardKey     String    // K-STK-01 — kod şeması docs/otomasyonlar/KATALOG.md
  cardVersion Int       @default(1) // eşik/metin değişince artar, kod korunur
  severity    String    // KRITIK | YUKSEK | ORTA | DUSUK

  // Kartın HAKKINDA olduğu kayıt — kişiselleştirme bu eksende yapılacak.
  subjectType String?   // product | customer | supplier | check | invoice | ...
  subjectId   String?

  // Karta basılan rakamlar. Eşik değişse bile geçmiş kart yeniden üretilebilsin
  // ve "önerdiği şey doğru muydu" sonradan ölçülebilsin diye saklanır.
  payload     Json

  shownAt     DateTime  @default(now())

  // ACTED | DISMISSED | SNOOZED | EXPIRED · null = henüz karar verilmedi
  decision    String?
  decidedAt   DateTime?
  actionKey   String?   // hangi butona basıldı: siparis_olustur, tedarikciyi_ara ...

  // SONUÇ ÖLÇÜMÜ — asıl değerli alan. Kart "sipariş ver" dedi, sipariş verildi mi?
  // Bu olmadan yalnız ilgi ölçülür, İSABET ölçülemez.
  outcomeAt   DateTime?
  outcomeType String?   // order | payment | price_change | none
  outcomeRef  String?   // ilgili kaydın id'si

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, cardKey, shownAt])
  @@index([companyId, decision])
  @@index([cardKey, shownAt])
  @@index([subjectType, subjectId])
  @@map("automation_card_events")
}
```

Migrasyonun sonuna, proje kuralı gereği:

```sql
ALTER TABLE public.automation_card_events ENABLE ROW LEVEL SECURITY;
```

### Kayıt kuralları

- **Gösterim de yazılır, karar da.** Yalnız tıklananı kaydetmek, "hangi kart görülüp
  umursanmadı" sorusunu ölçülemez kılar — asıl sinyal odur.
- **Aynı kart aynı özne için günde bir kez** yazılır. Sayfa her açılışta yeni satır
  atarsa gösterim sayısı ilgiyle karışır.
- **`payload` kartın gövdesidir, özeti değil.** Hangi rakamla ne dendiği durmalı.
- **`outcomeAt` ayrı bir işle doldurulur** (kart aksiyonundan doğan sipariş/tahsilat
  kaydı bağlanır). Bu alan, ileride "hangi öneri gerçekten sonuç verdi" sorusunun tek
  cevabıdır ve sonradan üretilemez.
- **`cardVersion`** eşik değişiminde artırılır; eski ve yeni eşiğin verisi karışmaz.

### Bir yıl sonra bu veri neyi cevaplar

- Bu kullanıcı hangi kart türüne yanıt veriyor, hangilerini hep kapatıyor?
- Hangi eşikte umursuyor — ₺5.000 açıkta hareket etmiyor, ₺20.000'de ediyor mu?
- Hangi kart hangi işletme tipinde tıklanıyor (sektöre göre kart seçimi)?
- Hangi öneriler sonuç verdi — yani kart **haklı** mıydı?
- Bir kullanıcıya günde kaç kart gösterilirse yanıt oranı düşmeye başlıyor?

Bunlar "kullanıcı davranışını analiz edip kişiselleştirme"nin girdisidir. Kart
kataloğunun bugün stabil kodlarla yazılmasının sebebi budur.

## 6. Yapay zekâ nereye girer

Bu katalogun tamamı modelsizdir. Model, bu katman kurulduktan sonra üç yerde işe yarar:

1. **Sıralama ve kişiselleştirme** — §5'teki günlük yeterince biriktiğinde: "bu firmaya
   bugün hangi 3 kartı göster". Kural değil, öğrenilmiş tercih.
2. **Serbest metin** — gelen fatura kaleminin ilk kez eşleştirilmesi, fiş okuma.
3. **Asistan** — soruyu sorguya çevirme (`lib/asistan/sohbet.ts`, zaten var). Her yeni
   kart, asistana bir araç olarak da eklenir.

Kural değişmez: **rakam modelden geçmez** (`lib/asistan/sinyaller.ts`). Model kartı
sıralayabilir, seslendirebilir; içindeki sayıyı üretemez.

## 7. Gürültü bütçesi

Kartların amacı işletmeyi fark etmediği şeylerle doldurmak; ama günde 20 kart gösteren
ekran birkaç haftada okunmaz olur ve o noktada §5'teki veri de değersizleşir (herkesin
her kartı kapattığı bir günlük hiçbir şey öğretmez).

Çözüm kart sayısını azaltmak değil, **gösterim bütçesi** koymak:

- Panoda **en fazla 3 kart** — **önce `önem`, sonra parasal etki** (`Kart.etki`, TL).
  Katalogun ilk hâli "önem × parasal etki" diyordu; ÇARPIM ÖLÇÜMLE REDDEDİLDİ.
  İki sebep: (1) `onem` her kartın kendi eşiğinden geliyor (K-NKT-08'de ₺100.000,
  K-BLG-01'de 50 belge) — kartlar arasında karşılaştırılabilir bir ölçek değil,
  tutar ise öyle; (2) canlı veride ₺3.213.123.123.123 tutarlı bir çek var,
  çarpımda o tek çöp kayıt panonun en üst sırasını kalıcı işgal ederdi. Sıralama
  eklenmeden önce ilk üçü **kayıt defterindeki yazılma sırası** belirliyordu:
  HİDROEREN'de ₺5.500'lük eksi kasa, "₺100.000 alınmış, hiç fatura kesilmemiş"
  kartının önündeydi. Parası olmayan kart (negatif stok, vadesi geçmiş evrak)
  kendi kademesinin sonuna düşer ama kademe aciliyeti taşıdığı için ekrandan
  düşmüyor — ölçümde negatif stok iki firmada da ilk üçte kaldı.
- Aynı kart peş peşe 3 kez yok sayılırsa **30 gün susar**.
- Bir kart tüm firmalarda %90+ yok sayılıyorsa **kart yanlıştır** — düzeltilir veya
  emekliye ayrılır. Bu ölçüm §5 olmadan yapılamaz.

## 8. Sıra

| Faz | İş | Açtığı kartlar |
|---|---|---|
| 0 | **Etkileşim günlüğü** (§5) + kart bileşeni + gürültü bütçesi | altyapı |
| 1 | **K-STK-01** referans kart *(kodlandı)* | iskeleti ve formatı kurdu |
| 1b | **K-STK-09** negatif stok *(kodlandı)* — K-STK-01'in önkoşulu | 7 firmada ateşliyor |
| 2 | **A motoru**: çek/senet *(bağlandı)*; maaş + tekrarlayan gider + günlük çözünürlük ÖLÇÜMLE ERTELENDİ (§0) | K-NKT-08 *(kodlandı)* |
| 2b | **`Invoice.dueDate` otomatik dolsun** — A motorunun kalanının ön koşulu | K-NKT-01/02/04'ün kapısı |
| 3 | **B motoru**: cari ödeme davranışı profili | K-THS-01…03, K-NKT-01'in gerçekçiliği |
| 4 | Ucuz kazançlar: **K-BLG-01 · K-BLG-04 · K-THS-08 · K-TDR-05 · K-OPR-06 *(kodlandı)***; K-BLG-02/03/05, K-SIS-01, K-TDR-01, K-MUS-03 ÖLÇÜMLE elendi (§0) | tek sorgu + şablon |
| 5 | **C motoru** genişleme: K-STK-02…08, K-TDR-03 | akış hızı |
| 6 | **D motoru** ortak sapma ölçeri: K-MRJ, K-OPR-02…04 | sapma |
| 7 | Reçeteye bağlı: K-OPR-01 (önce reçete doluluğunu ölç) | fire |
| 8 | Talep tahmini: K-OPR-08/09 | gerçek tahmin modeli, en son |

**Faz 0 atlanmamalı.** Kartlar günlük olmadan yayına girerse, geçen her ay geri
kazanılamayan veridir.
