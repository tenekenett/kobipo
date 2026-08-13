# Satış / Adisyon Ekranı — rakip analizi ve yeniden tasarım planı

> Bağlam: [ASAMA2.md](./ASAMA2.md) (masa/adisyon altyapısı) · [SADELESTIRME.md](./SADELESTIRME.md) "İş 9"
> (kontrol azaltma yöntemi) · [PLAN.md](./PLAN.md) "Açık riskler" 2 (modifier)
>
> Bu belge **altı yeni yetenek** (hesap fişi, hesap bölme, ikram/zayi, iskonto, açık adisyon
> listesi, ürün seçenekleri) eklenirken ekranın **daha da kalabalıklaşmamasını** nasıl
> sağlayacağımızın kararını tutar.

## Neden

Altyapı çalışıyor ama ekran bir işletmenin eline verilecek halde değil. Kullanıcı tespiti:
*"teoride işlem aynı, lakin bir işletme için biraz kalabalık ve kullanımı zor."*

Buradaki tehlike somut: eklenmesi kararlaştırılan altı yetenek **naif** biçimde eklenirse
adisyon ekranı bugünkü 3 üst düğmesinden 9 düğmeye çıkar, kalem satırına üç ikon daha biner.
İş 9'da öğrenilen ders aynen geçerli: **her sorun bir kontrol ekleyerek çözülürse UI çöker.**

Bu yüzden plan iki paralel iş olarak yazıldı: *yetenek ekle* **ve** *görünür kontrolü azalt*.
Kabul ölçütü aşağıdaki bütçe tablosudur — altı yetenek eklendikten sonra ekranda **bugünkünden
fazla kontrol olmayacak.**

---

## 1. Rakip analizi

Bakılanlar: Adisyo (TR, hedef rakip), Loyverse (küçük kafe, ücretsiz, dünyada en yaygın),
Square for Restaurants (ABD, referans UX), SambaPOS (TR, seçenek/porsiyon modeli),
robotPOS/vRest (TR pazar yazıları). Kaynaklar en altta.

### 1.1 Ortaklaşan desenler (hepsinde aynı)

| Desen | Nasıl | Bizim için sonucu |
|---|---|---|
| **Kalem üstünde tek "⋮" menüsü** | Adisyo: ürünün solundaki üç noktadan *ikram / zayi / iptal*. Loyverse/Square: satır seçilince aynı menü | İkram, zayi, iptal, not, seçenek, taşı — **hepsi tek menüde**. Satıra ikon eklemiyoruz |
| **Toplu işlemler ayrı bir gruba toplanır** | Adisyo: "Masa İşlemleri" içinde *masa transferi, masa birleştirme, ürün transferi*. Loyverse: sağ üst ⋮ | Hesap fişi, iskonto, bölme, masa taşıma, kişi/not, iptal → tek **"İşlemler"** tepsisi |
| **İkram ≠ zayi ≠ iptal** | Square: *comp* müşteri hesabında 0₺ görünür, *void* hesapta hiç görünmez. Adisyo aynı üçlüyü kullanır | Üçünü ayrı tutuyoruz. Bugün tek "sil" var ve **hiç iz bırakmıyor** |
| **Sebep zorunlu ve önceden tanımlı** | Square: sebepler panelden tanımlanır, POS'ta listeden seçilir; comp/void raporu bu sebeplerle çıkar | Serbest metin değil, kısa sabit liste + isteğe bağlı açıklama |
| **Bölme, ödeme anına yakın durur** | Loyverse: satış ekranı ⋮ → *Split ticket* → sol/sağ iki sütun, "Move here". Adisyo: "Böl ve Öde" | İki sütun + "Buraya taşı" desenini alıyoruz |
| **Açık hesaplar tek listede, aranabilir** | Loyverse: *Open tickets* düğmesi → ad / tutar / son değişiklik / personel sırala + ara | Bizde bu ekran hiç yok |
| **Seçenek zinciri: ürün → porsiyon → etiket** | SambaPOS: ürün seçilince porsiyon, sonra sipariş etiketi grupları; her seçeneğin fiyat farkı var | Aynı zincir, ama **yalnız seçeneği olan üründe** açılır |
| **Yemek kartı ayrı bir ödeme tipi** | TR pazarında standart: Multinet/Sodexo(Pluxee)/Ticket/Edenred/Setcard ödeme tipi olarak seçilir | Bizde `CASH/CREDIT_CARD/BANK_TRANSFER` var; gün sonu mutabakatı bu yüzden tutmuyor |

### 1.2 UX ilkeleri (POS tasarım literatürü)

- **Sipariş girişi sırasında ekran boş kalmalı** — yoğun saatte bilişsel yük en büyük hata
  kaynağı. Yönetim/uyarı bilgisi servis akışının içinde durmamalı.
- **Tutarlı yerleşim** — aynı düğme her ekranda aynı yerde; eğitim süresi buradan düşüyor.
- **Renk/şekil kodlama** — kategoriyi metin okumadan tanıma.
- **Dokunma hedefi büyük**, ödeme düğmesi sabit ve tek.
- Karanlık mod (bizde var), tablet öncelikli yerleşim.

### 1.3 Rakiplerde olup bizde olmayan, bu belgenin dışında kalanlar

Mutfak ekranı/yazıcısı, garson PIN'i, vardiya devri, QR menü/sipariş, kiosk, yemek kartı
**entegrasyonu** (ödeme tipi ≠ entegrasyon). Bunlar ayrı işler; burada yalnız ödeme *tipi*
ele alınıyor.

---

## 2. Bugünkü ekranın durumu (ölçüm)

`components/restoran/ticket-screen.tsx` (adisyon) ve `cafe-sale-screen.tsx` (kahveci):

```
┌────────────────────────────────────────────────────────────────┐
│ ← Masalar                                                      │
│ Masa 5        ADS-2026-0001 · 42 dk · 2 kişi                   │
│                        [Depo ▾] [Kişi/Not] [Adisyonu iptal et] │   ← 3 kontrol
├──────────────────────────────────┬─────────────────────────────┤
│ [ara]  Tümü Kahve Tatlı …        │  Adisyon           6 adet   │
│ ┌────┐┌────┐┌────┐┌────┐         │  ┌───────────────────────┐  │
│ │Latte││Espr││Cola││Kek │        │  │ Latte  ₺102 × 2       │  │
│ └────┘└────┘└────┘└────┘         │  │ [− 2 +]          [🗑] │  │   ← satırda 4 kontrol
│                                  │  └───────────────────────┘  │
│ ⚠ Yetersiz hammadde (2)          │  Ara toplam / KDV / Toplam  │   ← 3 satır
│   servis akışının ortasında      │  [   Hesabı Kapat   ]       │
└──────────────────────────────────┴─────────────────────────────┘
```

| | Adisyon ekranı | Kahveci Satış |
|---|---|---|
| Üst bar kontrolü | 3 | 2 |
| Kalem satırı kontrolü | 4 (−, sayı, +, çöp) | 4 |
| Toplam bloğu satırı | 3 (ara toplam, KDV, toplam) | 3 |
| Ekranda toplam etkileşimli öğe | ~13 `Button` + 2 `Input` + 1 `Select` | ~6 + 1 + 1 |

**Sorunlar (yetenek eksiğinden bağımsız, bugün de var):**

1. **Depo seçici garsonun ekranında** — servis sırasında hiç değişmeyen bir ayar.
2. **Ara toplam / KDV satırları** — kasiyerin kararını değiştirmeyen üç satır. Müşterinin
   sorduğu tek şey toplam; KDV dökümü fişte zaten var.
3. **Yetersiz hammadde kartı sipariş akışının ortasında** — yönetim bilgisi, servis bilgisi değil.
4. **Kalem silme iz bırakmıyor** ve — kritik — stok kapanışta düştüğü için **ikram edilen ürün
   stoktan hiç düşmüyor**. Bu bir UI eksiği değil, veri kaybı.
5. **İki ayrı ekran, iki ayrı davranış** — aynı işin (kalem ekle/çıkar/öde) iki kopyası;
   eklenecek altı yetenek iki kez yazılmak zorunda kalır.

---

## 3. Kararlar

### K1 — Yeni yetenekler ekrana düğme olarak EKLENMEZ; iki toplayıcıya girer

- **Kalem ⋮ menüsü** (satırda): Adet · Seçenek/Not · **İkram** · **Zayi** · **İptal** · Taşı
- **İşlemler tepsisi** (üstte tek düğme): Hesap fişi · **İskonto** · **Hesap böl** ·
  Masa taşı · Kişi/Not · Adisyonu iptal et

Gerekçe: Adisyo ve Loyverse ikisi de bunu yapıyor; alternatif (her yetenek bir düğme) altı
düğme demek ve tablet genişliğinde ikinci satıra taşıyor.

> **2026-08-06 — hesap tarafı için geri alındı.** Adisyon ekranında İşlemler tepsisi
> kaldırıldı; iskonto · hesabı böl · masayı değiştir · kişi/not · iptal
> artık **sağ sütunda, hesap panelinin içinde** açık düğme (`ticket-screen.tsx`, panelin
> `footer` prop'u). Serviste bu altısı sık kullanılıyordu ve tepsi hepsini iki dokunuş
> arkasına saklıyordu. Yer sol üstteki başlık değil hesap paneli: karar zaten toplama
> bakarken veriliyor, üstelik `xl:sticky` panel kaydırınca da ekranda kalıyor. 2 sütunlu
> ızgara "altı düğme ikinci satıra taşar" endişesini çözer — taşması tasarımın kendisi.
> Hesap fişi listeye eklenmedi, aynı blokta zaten kendi düğmesi var.
> **Kalem ⋮ menüsü aynen duruyor.**

### K2 — İkram / Zayi / İptal üç ayrı şey; stok davranışları farklı

| İşlem | Ne zaman | Hesapta | Stok | Rapor |
|---|---|---|---|---|
| **İptal** (void) | Ürün **hazırlanmadan** yanlış girildi | Görünmez | Düşmez | Hata sayacı |
| **İkram** (comp) | Müşteriye verildi, para alınmıyor | `0,00` satır olarak görünür | **Düşer** | İkram maliyeti |
| **Zayi** (waste) | Hazırlandı, döküldü/bozuldu | Görünmez | **Düşer** | Zayi maliyeti |

Bugün üçü de "çöp kutusu" ve üçünde de stok düşmüyor. **İkram/zayi stoğu düşmediği sürece
maliyet raporları yalan söylüyor** — kafede ikram günlük bir olaydır.

Uygulama: `RestaurantTicketItem`'a `status` (`NORMAL|COMP|WASTE|VOID`) + `reasonCode` +
`reason`. Kapanışta fişe **yalnız `NORMAL`** kalemler girer (fatura temiz kalır); `COMP` ve
`WASTE` kalemleri için reçetesi genişletilmiş ayrı bir `ADJUSTMENT` stok hareketi yazılır,
referansı adisyon kodudur. Böylece fiş/KDV tarafı hiç değişmez, stok doğrulanır.

Sebep listesi sabit ve kısa (Square deseni; panelden düzenlenebilir hale getirmek ayrı iş):
*Müşteri şikâyeti · Personel/aile · Tanıtım-ikram · Yanlış hazırlandı · Döküldü/bozuldu ·
Yanlış girildi.*

### K3 — İskonto adisyon seviyesinde, sebepli; kalem iskontosu yok

Yüzde veya tutar + sebep. Fişe fatura altı (genel) iskonto olarak gider — bu yol raporlarda
zaten `globalFactor` ile doğru işleniyor (bkz. `[[giden-otv-diger-vergi]]` deseni: display
katmanı faktörü uygular). Kalem bazlı iskonto kafede nadir; eklemek üç ekranda daha hesap
düzeltmesi demek. **Gerekirse sonra.**

#### K3.1 — İskontoyu uygulayan personel sorulur (2026-08-06)

İskontonun **tutarı** kaydediliyordu, **sorumlusu** kaydedilmiyordu: ekranda write yetkisi
olan herkes sınırsız indirim verebiliyor ve hiçbir raporda kimin verdiği görünmüyordu.
Sebep de serbest metindi — `"Personel"` / `"personel"` / `"personele"` raporda üç ayrı satır.

Eklenen alanlar (`RestaurantTicket`):

| Alan | Ne cevaplar |
|---|---|
| `discountReasonCode` | **Niye** — sabit liste (`TICKET_DISCOUNT_REASONS`), rapor bunu gruplar |
| `discountReason` | Serbest açıklama; kodun yerine geçmez, yanında durur. **2026-08-07'den beri ZORUNLU** — "%20 · Sadık müşteri" denetimde tek başına bir şey anlatmıyor (hangi müşteri, hangi söz). Kod gruplama ekseni, açıklama tek tek kayda bakanın okuyacağı yer. Kural hem `discount-dialog.tsx`'te (iki ekran ortak) hem `adisyonlar/[id]` PATCH'te; iskonto KALDIRIRKEN istenmiyor |
| `discountEmployeeId` | **Kim verdi** — İK kartı (`Employee`) |
| `discountBy` / `discountAt` | Oturum izi: kaydı fiilen yazan kullanıcı ve anı |

**Neden `Employee`, `User` değil:** kafede kasa çoğu zaman ortak hesapla açıktır; "indirimi
kim verdi" sorusunun cevabı oturumu açan kişi değil, o an masaya bakan garsondur. Oturum izi
(`discountBy`) yine de yazılır — ikisi farklı soruyu cevaplar ve denetim raporunda **ayrı
tablolarda** durur (`discountStaff` ↔ `staff`); aynı sütuna konsalardı iki farklı kimlik
kümesi tek isimmiş gibi okunurdu.

**Zorunluluk koşulludur:** firmada aktif personel kartı varsa seçim zorunlu, yoksa akış
bugünkü gibi sürer. `hr` modülünü kullanmayan bir kafede iskontonun tek alan yüzünden
kilitlenmesi kabul edilemezdi (kural hem istemcide hem `adisyonlar/[id]/route.ts`'te).

**Ölçüm:** denetim raporunda "Verilen iskonto" kutusu + personel ve adisyon kırılımı; personel
kartında (`/personel/[id]` → Restoran sekmesi) o personelin verdiği iskontolar. Ayrı bir
"defter" tablosu YOK — para iki yerde yaşasaydı iskonto düzeltildiğinde ikisi ayrışırdı.
Ölçüm ekseni `closedAt`: açık adisyondaki iskonto hâlâ kaldırılabilir.

**Kapsam dışı (bilinçli):** *(a)* Tezgâh (Kahveci Satış) iskontosu hâlâ kaydedilmiyor —
sepetin adisyonu yok ve `Invoice`'ta sebep alanı yok (`globalDiscountAmount` yalnız tutar);
personel/sebep orada sadece ekranda ve yazdırılan fişte yaşar. *(b)* ~~İkramda personel
sorulmuyor~~ → **K3.2'de kapatıldı.** *(c)* ~~Yetki kademesi: bu iş kimin yaptığını
**kaydeder**, kimin yapabileceğini **kısıtlamaz**~~ → iskontonun **büyüklüğü** K3.3'te
sınırlandı; *kimin* verebileceği hâlâ açık (bkz. DENETIM-VE-TEMIZLIK.md Faz 5).

#### K3.2 — İkramı veren personel de sorulur (2026-08-06)

K3.1'in ikram tarafındaki eşi: ikramın **tutarı ve malzemesi** ölçülüyordu, **sorumlusu**
ölçülmüyordu. Kafede ikram günlük bir olaydır; kim verdiği yazılmazsa ikram ile kaçak
ayırt edilemez.

Personel **yalnız `COMP`'ta** sorulur. Zayi bir kayıp kaydıdır (döküldü/bozuldu), iptal
yanlış girişin izidir — ikisinde de birine atfedilen bir karar yok.

**İki tabloya yazılır, çünkü iki ekranın kalıcı izi farklı:**

| Ekran | Nereye | Neden |
|---|---|---|
| Adisyon | `RestaurantTicketItem.compEmployeeId` | İkram, kapanıştan saatler önce işaretlenir; seçim o ana ait ve kapanışa kadar yaşamalı |
| Kahveci Satış | `StockMovement.employeeId` | Sepetin adisyonu YOK; ikramın tek kalıcı izi stok düzeltmesidir |

Kapanışta kalemdeki personel **harekete taşınır** (`kapat` GET → `writeCompWasteStock`),
böylece "bu ay kim ne kadar ikram etti" sorusu iki ekran için de TEK yerden
(`stock_movements`) cevaplanır. `writeCompWasteStock` ikramı artık personele göre de
ayrı hareketlere böler: aynı hesapta iki garson ikram verdiyse tek hareketin `employeeId`'si
yanıltıcı olurdu (İkram/Zayi ayrımının konuluş gerekçesiyle aynı).

**Zorunluluk koşulludur** — firmada aktif personel kartı varsa şart, yoksa akış eskisi gibi
sürer (K3.1'deki kural). Kural üç yerde: istemci (`ticket-panel.tsx`, "Uygula" kilidi),
`kalemler/[itemId]` PATCH ve `api/restoran/ikram` POST.

**Arayüz tek yerde:** ikram iki ekranda da ortak `TicketPanel`'in ⋮ menüsünden geçiyor,
seçici oraya kondu. Tek personel varsa otomatik seçilir.

**Kapsam dışı:** denetim raporu ikramı henüz personele göre GRUPLAMIYOR — veri artık var,
rapor sorgusu (`raporlar/denetim/route.ts`, stok hareketlerini `description LIKE` ile
ayırıyor) eski. İskontodaki "İskonto veren personel" kutusunun ikram karşılığı ayrı iş.

#### K3.3 — İskonto TAVANI: işletme en fazla ne kadar indirime izin veriyor (2026-08-13)

K3.1 "kim verdi"yi kaydetti ama **ne kadar verilebileceğini** kimse söylemiyordu: write
yetkisi olan herkes %90 indirim yazabiliyordu ve bunu ancak gün sonunda denetim raporu
gösteriyordu. Rapor kaçağı **görünür** kılar; tavan **oluşmasını** engeller.

Tek alan: `Company.restaurantMaxDiscountPercent` (`numeric(5,2)`).
`NULL` = sınır yok (bugüne kadarki davranış, mevcut firmalar etkilenmez) ·
`0` = iskonto tamamen kapalı. İkisi **farklı** durumlardır; `0 || null` kısayolu tavanı
sessizce kaldırırdı, kolon bu yüzden nullable.

**Tavan yüzdedir ama tutar iskontosunu da bağlar.** 600 ₺'lik hesaba 500 ₺ indirim %83'tür;
ölçü her iki türde de iskontonun hesaba oranıdır. Yalnız "yüzde" düğmesini bağlasaydı tavan,
"tutar" düğmesine basan kasiyer için hiç yoktu.

**Herkesi bağlar — patron dahil.** Muafiyet listesi yok: tavanı, bağladığı kişinin kendisi
aşabilseydi kural olmazdı. Daha yüksek bir indirim gerekiyorsa ADMIN önce tavanı değiştirir
(o değişiklik bir karardır ve ayar ekranından görünür), sonra iskontoyu verir.

**Kural DÖRT yerde, çünkü iskonto dört kapıdan geçiyor:**

| Yer | Ne yakalar |
|---|---|
| `discount-dialog.tsx` (iki ekran ortak) | "Uygula" kilidi + hesaba düşen tutar; sınır girişin üstünde yazar, hızlı yüzdeler tavana göre kırpılır |
| `adisyonlar/[id]` PATCH | Uç doğrudan çağrılırsa; tutar iskontosu için kalemler okunup oran hesaplanır |
| `adisyonlar/[id]/kapat` GET | **Kapanışta yeniden** ölçülür: iskonto girildikten sonra kalem silindiyse (ya da tavan indirildiyse) aynı tutar artık daha büyük bir yüzdeye denk gelir |
| `e-donusum/invoices` POST (`isReceipt`) | Tezgâh (Kahveci Satış) iskontosu hiçbir yerde saklanmadan doğrudan fişe gider — kural yalnız adisyonda olsaydı tezgâhtan sınırsız indirim verilirdi |

Fiş ucundaki ölçüm **matrah** üzerindendir (`globalDiscountAmount` net bekler); iskonto brüte
de matraha da aynı oranda düştüğü için sonuç KDV dahil bakışla aynıdır — testi
`lib/restoran/discount-limit.test.ts` içinde.

**Ayar nerede:** Raporlar → **İkram & Denetim**, "Verilen iskonto" kutusunun hemen altında.
Ayrı bir "Restoran Ayarları" sayfası açılmadı: tavanın tek anlamı bu raporda görülen
rakamlardır (açılış saatinin vardiya takviminde durmasıyla aynı gerekçe). Yazma **yalnız
ADMIN**'de ve bunu `canEdit` ile **sunucu** söyler; şubelerde ana firmanın sahibi zaten
sanal ADMIN'dir. Okuma herkese açık — kasiyer sınırı diyalogda görebilmeli.

**Kapsam dışı (bilinçli):** ikram (`COMP`) tavana **girmiyor**. Kalemleri ikram işaretleyerek
tavanı dolaylı aşmak hâlâ mümkün; ikramın kendi sınırı ayrı bir iştir (denetim raporu onu
ölçmeye devam ediyor). Rol bazlı iki ayrı tavan (personel %20 / müdür %50) da yok — tek
sayı, tek kural.

### K4 — Hesap fişi = fiş şablonunun mali olmayan kopyası

`lib/fis/receipt-html.ts` yeniden kullanılır; başlığı **"HESAP FİŞİ"**, altında *"Mali değeri
yoktur"* ve adisyon kodu. Ödeme öncesi, adisyon açıkken basılır, adisyonu KAPATMAZ.
Tek düğme, tek pencere — en ucuz, en çok kullanılacak yetenek.

### K5 — Hesap bölme iki adımda büyür: önce ödemede böl, sonra adisyon böl

- **Faz 2 (şimdi): ödemede bölme.** Kalemleri seçerek veya "eşit N'e böl" ile ödeme parçalara
  ayrılır; **fiş tek kalır**, tahsilat çok parçalı yazılır (`payment.splitMode` altyapısı var).
  Küçük kafenin %90 durumu budur ve fatura/KDV tarafında hiçbir şey değişmez.
- **Faz 4 (sonra): gerçek adisyon bölme.** Ayrı fiş isteyen müşteri için adisyonu ikiye ayırmak
  gerekir — bu, "bir masada tek açık adisyon" kuralını gevşetmeyi gerektirir (bugün API 409
  veriyor) ve salon planında "2 hesap" rozeti ister. Ayrı karar.

Ekran deseni Loyverse'ten: iki sütun, ortada **"Buraya taşı"**.

### K6 — Seçenek (modifier) yalnız tanımlı üründe açılır

Zincir SambaPOS'taki gibi: **ürün → (varsa) porsiyon → (varsa) seçenek grupları**. Seçeneği
olmayan ürün **tek dokunuşta** sepete girer — bu kural pazarlık konusu değil, kahveciyi
yavaşlatacak tek şey budur.

Model: `ProductOptionGroup` (ad, zorunlu mu, çoklu seçim mi, min/max) + `ProductOption`
(ad, fiyat farkı, isteğe bağlı hammadde bağı). Adisyon kalemi seçilenleri `description`'a
kopyalar (ürün adı kopyalama kuralıyla aynı) ve fiyat farkını `unitPrice`'a yansıtır.

**Reçete etkisi Faz 3'ün ikinci yarısı** — *2026-07-31'de yapıldı, aşağıya bak.* Seçenek
yalnız fiyatı değil MALZEMEYİ de değiştirir; üç mod:

| Mod | Ne yapar | Örnek |
|---|---|---|
| **Değişim** (`SWAP`) | Reçetedeki bileşenin yerine başkası düşer; **miktar reçeteden gelir** | süt → soya sütü |
| — hedefsiz | Bileşen hiç düşmez | "şekersiz" |
| **Ekleme** (`ADD`) | Reçeteye ek malzeme düşer (kendi reçetesi de açılır) | +1 ekstra shot |
| **Çarpan** (`recipeFactor`) | Reçetenin TAMAMI ölçeklenir; moddan bağımsız | büyük boy = 1,5× |

Değişimde miktarın ayrıca sorulmaması bilinçli: sorulsaydı aynı sayı iki yerde yaşar ve
reçete güncellenince sessizce yanlışa dönerdi. Çarpan **reçetesi olmayan üründe yok
sayılır** ("1,5 şişe su" diye bir şey yok) ve **ek malzemeyi ölçeklemez** (büyük boy latte
yine tek ekstra shot).

### K7 — İki ekran kalır, panel ortaklaşır

Kahveci Satış (self-servis/tezgâh: sipariş al, hemen öde) ile Adisyon (masa: saatlerce açık)
**farklı işler**; tek ekrana zorlamak ikisini de bozar. Ama kalem paneli, ⋮ menüsü, İşlemler
tepsisi, ödeme diyaloğu ve seçenek diyaloğu **ortak bileşen** olacak — altı yeteneği iki kez
yazmamak için. Bu, `menu-grid.tsx` ve `submit-receipt-sale.ts` ile kurulan mevcut
ortaklaştırma çizgisinin devamı.

### K8 — Çıkarılacaklar (yetenek eklerken yer açan taraf)

| Çıkan | Nereye |
|---|---|
| Depo seçici (adisyon üst barı) | Ayarlar → varsayılan depo. Çok depolu firmada hesap panelinde |
| "Ara toplam" ve "KDV" satırları | Yalnız **Toplam** kalır; döküm hesap fişinde ve fişte |
| Yetersiz hammadde kartı | Ürün kartında küçük rozet + Menü ekranında panel |
| Kritik hammadde paneli (kahveci) | Aynı şekilde — servis ekranından çıkar |
| "Adisyonu iptal et" üst düğmesi | 2026-08-06'dan beri hesap panelinin en altında (bkz. K1 notu) |
| Kalem satırındaki çöp ikonu | ⋮ menüsüne (İptal/İkram/Zayi ayrımıyla birlikte) |

---

## 4. Hedef ekran

### 4.1 Adisyon

```
┌────────────────────────────────────────────────────────────────┐
│ ← Masalar    Masa 5 · 42 dk · 2 kişi                           │
├──────────────────────────────────┬─────────────────────────────┤
│ [ara]  Tümü  Kahve  Tatlı  …     │  Adisyon            6 adet  │
│ ┌──────┐┌──────┐┌──────┐┌──────┐ │  ┌───────────────────────┐  │
│ │Latte ││Espr. ││Cola  ││Kek   │ │  │ 2 × Latte      ₺204 ⋮ │  │   ← satırda 1 kontrol
│ │₺102 ²││ ₺85  ││ ₺60  ││ ₺75  │ │  │   soya sütü +₺15      │  │
│ └──────┘└──────┘└──────┘└──────┘ │  ├───────────────────────┤  │
│ ┌──────┐┌──────┐                 │  │ 1 × Kek     İKRAM  ⋮  │  │
│ │Çay   ││Su    │                 │  │   müşteri şikâyeti    │  │
│ └──────┘└──────┘                 │  └───────────────────────┘  │
│                                  │  İskonto %10        −₺27    │
│                                  │  ───────────────────────    │
│                                  │  TOPLAM            ₺243,00  │
│                                  │  [ % İskonto ][ ⑂ Böl   ]  │   ← işlemler (§4.3)
│                                  │  [ ↔ Masa    ][ 👥 Kişi ]  │
│                                  │  [ Hesap Fişi ] [ ÖDEME ]   │
│                                  │      🗑 Adisyonu iptal et   │
└──────────────────────────────────┴─────────────────────────────┘
```

- Adet artık satırda `2 ×` olarak yazı; azalt/artır ⋮ menüsünde **ve** ürüne tekrar dokunarak
  (menüden basmak zaten +1 ekliyor — stepper'ın asıl işi azaltmak).
- İkram/zayi satırı **renkli rozetle** görünür; müşteriye ne verildiği kaybolmaz.
- Panelin altı: işlem düğmeleri → **Hesap Fişi** + **ÖDEME** → en altta iptal.

### 4.2 Kalem ⋮ menüsü

> **2026-08-07 — menü boşaltıldı.** Adet ve İkram/Zayi/İptal ⋮'dan ÇIKTI; artık hesap
> panelinde, kalem listesinin hemen altında açık düğmeler. Satır dokunuşla SEÇİLİYOR,
> düğmeler seçili kaleme uygulanıyor. Gerekçe İşlemler tepsisininkiyle aynı (K1 notu):
> serviste sık kullanılan iş iki dokunuş arkasında duruyordu. Kontrol bütçesi (§4.8)
> korunuyor — satırda hâlâ tek kontrol var, düğmeler satıra değil panele kondu ve aynı
> anda yalnız bir kalem için çiziliyor. ⋮'da yalnız *Not düzenle* (ve tezgâhta *Satırı
> sil*) kaldı; ikisi de yoksa menü hiç çizilmiyor. Aşağıdaki şema ESKİ hali gösteriyor.

```
  Adet: [ − ] 2 [ + ]
  ────────────────────
  ✎  Seçenek / not
  ↗  Başka hesaba taşı
  ────────────────────
  ⊘  İptal   (hazırlanmadı)
  ♥  İkram   (para alınmaz, stok düşer)
  ✖  Zayi    (döküldü, stok düşer)
```
İkram/zayi/iptal seçilince: sebep listesi (6 kısa seçenek) + isteğe bağlı not. Tek adım.

### 4.3 Hesap işlemleri (2026-08-06'ya kadar "İşlemler tepsisi")

Sağ sütunda, TOPLAM ile ÖDEME'nin arasında — tek dokunuş:

```
  TOPLAM                  ₺243,00
  ────────────────────────────────
  [ % İskonto  ][ ⑂ Hesabı böl ]
  [ ↔ Masa değ.][ 👥 Kişi / not]
  [ Hesap Fişi ][    ÖDEME     ]
        🗑 Adisyonu iptal et
```

- **Adisyonu iptal et** ÖDEME'nin de ALTINDA, ghost + kırmızı: yıkıcı olan tek işlem
  diğerlerinin arasında durursa yanlışlıkla değiliyor.
- **Hesap fişi** listeye ayrıca eklenmedi; aynı blokta zaten kendi düğmesi var.

> **"Hesap istendi" 2026-08-06'da ekrandan kaldırıldı.** Sunucu tarafı duruyor
> (`PATCH /adisyonlar/[id]` → `billRequested`), yalnız düğmesi yok. Bayrağı kuran
> BAŞKA ekran olmadığı için salon planındaki turuncu **BILL** durumu ve adisyon
> başlığındaki rozet pratikte tetiklenmiyor — yeniden istenirse düğme buraya ya da
> masalar ekranına geri konmalı, aksi halde o iki gösterge ölü kod.

> **Masayı değiştir** ve **veresiye carisi** 2026-07-31'de eklendi. İkisinin de
> sunucu tarafı baştan hazırdı (`PATCH /adisyonlar/[id]` → `tableId` / `customerId`),
> yalnız ekranda girişi yoktu: masa değişince tek çare adisyonu iptal etmek,
> veresiyede ise borç kimseye yazılmıyordu. Cari, ödeme diyaloğunda **yalnız
> "Veresiye" seçilince** sorulur (kahveci ekranıyla aynı desen) ve adisyona
> yazılır — kapanış gövdesini sunucu üretiyor, seçim sayfa yenilenince kaybolmamalı.

### 4.4 Ödeme diyaloğu (tek adım)

```
  Toplam ₺243,00                      [ Böl ]
  ┌───────────────────────────────────────────┐
  │  Nakit   Kredi K.   Yemek K. ▾   Havale   │   ← Yemek K. içinde Multinet/Sodexo/…
  └───────────────────────────────────────────┘
  Alınan [        ]   Para üstü ₺7,00
  [ Veresiye ]                 [ TAHSİL ET ]
```

### 4.5 Bölme ekranı (Loyverse deseni)

```
  Hesap 1 (₺168)          [ Buraya taşı → ]        Hesap 2 (₺75)
  ┌────────────────┐                              ┌────────────────┐
  │ ☑ 2 × Latte    │                              │ 1 × Kek        │
  │ ☐ 1 × Çay      │      [ ← Buraya taşı ]       │                │
  └────────────────┘                              └────────────────┘
                    [ Eşit böl: 2 3 4 ]   [ Tamam ]
```

### 4.6 Seçenek diyaloğu (yalnız tanımlı üründe)

```
  Latte
  Boy      ( Küçük )  [ Orta ]  ( Büyük +₺15 )      ← zorunlu, tek seçim
  Süt      [ Normal ] ( Soya +₺15 ) ( Laktozsuz +₺15 )
  Ekstra   ☐ Ekstra shot +₺20   ☐ Şurup +₺10
  Not      [ az şekerli            ]
                                  [ Ekle — ₺117,00 ]
```

### 4.7 Adisyonlar `/restoran/adisyonlar`

Kart: masa/ad · kod · süre (açıksa) veya açılış–kapanış saati · kalem · **tutar** · durum.
Arama (masa, kod, müşteri, fiş no) + sıralama (tutar / süre) + durum filtresi.
Sağ üstte **`+ Yeni adisyon`** — masa OPSİYONEL, seçilmezse paket/gel-al açılır.

Ekran **bir GÜNE** bakar (ileri/geri gün gezinme + tarih seçici). Gün ekseni AÇILIŞ
tarihidir: kapanışı gece yarısını geçen masa kendi gününde kalır, adisyon numarası da
(`ADS-YYYY-NNNN`) o eksende ilerler.

İki liste birleşir: o gün kesilen adisyonlar (açık + kapanan + iptal) **ve** —yalnız bugüne
bakarken— hâlâ açık duran tüm hesaplar. Gerekçesi: dünden sarkan masa bugünün gün
listesinde yoktur (açılışı düne düşer) ama hâlâ tahsil edilmeyi bekler. Bu kartlar
"önceki günden" damgası taşır ve gün sayacına değil, ayrı bir satıra (`+ N önceki günden
açık`) yazılır — aksi halde "bugün 1 adisyon kesildi" yanlışı doğardı.

Kapanmış adisyonun gün bazında görülebildiği tek yer burasıdır: gün sonu raporu FİŞLERİ
sayar, adisyonları değil.

### 4.8 Kontrol bütçesi (kabul ölçütü)

| | Bugün | Hedef |
|---|---|---|
| Üst bar kontrolü | 3 | **1** |
| Kalem satırı kontrolü | 4 | **1** (⋮) |
| Toplam bloğu satırı | 3 | **1** (+ iskonto varsa 1) |
| Alt aksiyon | 1 | 2 |
| **Eklenen yetenek** | — | **6** |

Yani: altı yetenek eklenirken görünür kontrol sayısı **düşüyor**. İş 9'daki ölçüm bu tabloyla
tekrarlanacak.

---

## 5. Fazlar

| Faz | Kapsam | Neden bu sırada |
|---|---|---|
| **F0** | Ortak bileşenler: `TicketPanel` (kalem listesi + ⋮), `ActionTray`, sebep diyaloğu. Kahveci + Adisyon ikisi de buna bağlanır. K8'deki çıkarmalar | Sonraki her faz iki kez yazılmasın |
| **F1** | **Hesap fişi** · **İskonto** · **İkram/Zayi/İptal + sebep + stok düzeltmesi** | Günlük acıyı kesen üçlü; F1 tek başına işletmeye verilebilir hale getiriyor |
| **F2** | **Açık adisyon listesi** + **paket/gel-al adisyonu** · **ödemede hesap bölme** · **yemek kartı ödeme tipleri** | Hepsi küçük; birlikte gün sonu mutabakatını da düzeltiyor |
| **F3** | **Seçenek/porsiyon sistemi**: model + menü kurulumu + seçim diyaloğu → sonra reçete etkisi | En büyük iş; F0'ın panelini hazır bulmalı |
| **F4** | Gerçek adisyon bölme (ayrı fiş), masa birleştirme, kalem transferi | "Bir masada tek adisyon" kuralını gevşetme kararı gerekiyor |

**Öneri:** F0+F1 tek oturumda, F2 ikinci oturumda, F3 ayrı planla (kendi belgesi olmalı).

---

## 6. Şema etkisi (özet)

```
RestaurantTicketItem  + status      NORMAL | COMP | WASTE | VOID
                      + reasonCode  kısa kod
                      + reason      serbest not
                      + optionsJson seçilen seçenekler (ad + fiyat farkı)  ← F3
RestaurantTicket      + discountType/discountValue/discountReason          ← F1
ProductOptionGroup / ProductOption                                         ← F3
ProductOption         + effectMode/from/to/quantity/unit/recipeFactor      ← F3.5 (reçete etkisi)
PaymentMethod         + MEAL_CARD (+ sağlayıcı adı)                        ← F2
```

Hepsi ekleme; mevcut alanlar değişmiyor. `db push` + `prisma generate` şart
(bkz. `[[prisma-stale-client]]`).

---

## 7. Doğrulama planı

- `scripts/test-restoran-adisyon.mjs` genişletilir: ikram edilen kalem fişe **girmiyor** ama
  hammaddesi stoktan **düşüyor**; zayi hesapta görünmüyor; iptal iz bırakıyor; iskonto fiş
  toplamına yansıyor; bölünmüş ödemenin parçaları toplamı tutuyor; paket adisyon masasız açılıyor.
- Ölçüm tekrarı: kontrol sayısı tablosu (§4.8) ve "bir kahve siparişi kaç dokunuş" (hedef:
  seçeneksiz üründe **1**, seçenekli üründe **3**).
- Tarayıcıda gözle: tablet genişliğinde (1024px) iki sütun bozulmuyor, karanlık modda rozetler
  okunuyor.

---

## Uygulandı — 2026-07-30 ✅

F0–F3 tek oturumda yapıldı (F4 — gerçek adisyon bölme/masa birleştirme — açık).

### Şema (ekleme; mevcut alanlar değişmedi)

`supabase/migrations/20260730000002_ticket_status_options.sql` (idempotent, DB'ye uygulandı):
`RestaurantTicketItem.status/reasonCode/reason/options`, `RestaurantTicket.discountType/
discountValue/discountReason`, yeni `ProductOptionGroup` + `ProductOption`.

### Sunucu

| Ne | Nerede |
|---|---|
| Saf sabitler/hesaplar istemciye açıldı | **yeni** `lib/restoran/ticket-constants.ts` — `tickets.ts` prisma import ettiği için oradan içe aktarım Prisma'yı tarayıcı paketine sokardı; sunucu hepsini `tickets.ts` üzerinden görmeye devam ediyor |
| `ticketTotals` yeniden yazıldı | Yalnız `NORMAL` kalem sayılır; iskonto KDV dahil uygulanır, `netDiscount` ile matrah karşılığı verilir |
| İkram/zayi/iptal | `kalemler/[itemId]` PATCH — sebep ZORUNLU, liste sabit |
| İskonto | `adisyonlar/[id]` PATCH (`discountType/Value/Reason`) |
| Kapanış | `kapat` GET yalnız `NORMAL` kalemleri fişe koyar + `globalDiscountAmount` geçer; seçenek/not kalem adına yazılır |
| **İkram/zayi stok düzeltmesi** | **yeni** `lib/restoran/comp-waste-stock.ts` — reçete genişletilir, `ADJUSTMENT` hareketi yazılır, referans **fişin id'si** (fiş iptalinde `revertStockByReference` kendiliğinden geri alır) |
| Ürün seçenekleri | **yeni** `api/restoran/urun-secenekleri` (+`[id]`) · `lib/restoran/product-options.ts`; fiyat farkını SUNUCU hesaplar |
| Ödeme | `lib/satis/payment.ts`: `split` (yönteme anahtarlı) → **`portions` listesi**; `MEAL_CARD` + sağlayıcı; `splitEqually` |

### Ekran

Yeni ortak parçalar: `ticket-panel.tsx` (kalem satırı + ⋮ + tek satır toplam),
`option-dialog.tsx`, `discount-dialog.tsx`, `split-dialog.tsx`,
`product-options-dialog.tsx`, `open-tickets-screen.tsx`.
Adisyon ve Kahveci Satış ikisi de panele bağlandı. Yeni sayfa: `/restoran/adisyonlar`
(nav + modül kapısı + sayfa başlığı eklendi).

Çıkarılanlar (K8): adisyondaki depo seçici, ara toplam/KDV satırları, büyük hammadde
kartı (tek satırlık açılır şeride indi), satırdaki çöp ikonu.

### Doğrulama

| Betik | Sonuç |
|---|---|
| **`node scripts/test-ticket-totals.mjs`** (yeni, saf) | **26/26** — ikram/zayi/iptal hesaba girmiyor, iskonto matrah çevrimi, sınır durumları |
| **`npx tsx scripts/test-comp-waste-stock.ts`** (yeni, gerçek DB) | **11/11** — ikram+zayi malzemesi düştü (3 × birim), mamülün kendisi düşmedi, `ADJUSTMENT` tipi, **VOID hiç hareket yazmadı**, stok test sonrası geri döndü |
| `node scripts/test-payment.mjs` (güncellendi) | **32/32** — **iki kredi kartı AYRI satır**, iki yemek kartı sağlayıcısı ayrı, eşit bölmede kuruş ilk parçaya |
| `node scripts/test-receipt-sale.mjs` (güncellendi) | 19/19 |
| `node scripts/test-restoran-adisyon.mjs` (gerçek uçlar) | **68/68** |
| `test-recipe-expand` · `test-avco-revert` | 45/45 · 15/15 |

`tsc --noEmit` ve `eslint` temiz.

> Not: ilk e2e koşusunda 2 kontrol düşmüştü — sebebi kod değil, Supabase havuz
> bağlantısının düşmesiydi (`P1017 Server has closed the connection`; fatura silme
> işleminin uzun `$transaction`'ı yavaş bağlantıda zaman aşımına uğruyor). Tekrar
> koşuda 68/68 geçti. Bu, bu ortamda ARA SIRA görülecek bir kırılganlık.

### Yapılmayan / sonraki

- **F4:** gerçek adisyon bölme (ayrı fiş), masa birleştirme, kalem transferi.
- Kalem bazlı iskonto (bilinçli: K3).
- Ekranların tarayıcıda gözle doğrulaması.

---

## Seçeneğin reçeteye etkisi — 2026-07-31 ✅

K6'nın "Faz 3'ün ikinci yarısı" olarak bırakılan kısmı. Bundan önce soya sütlü latte
satılınca stoktan **inek sütü** düşüyordu: menü doğru, maliyet yalandı.

### Nereden geçiyor

Zincirin can alıcı yeri şuydu: stok düşümü `/api/e-donusum/invoices` içinde satırın
`productId`'sine göre yapılıyor, seçenekler ise faturaya yalnız **metin** olarak gidiyor
("Latte — Soya sütü"). Bu yüzden etki, faturaya YAZILMAYAN ayrı bir alanla taşınıyor:

```
Seçenek tanımı (ProductOption)
   └─ seçim anında KOPYALANIR → adisyon kalemi options JSON  (fiyat gibi)
        └─ kapanış: kapat GET → invoicePayload.items[].recipeEffects / recipeFactor
             └─ fatura ucu: yalnız expandRecipeLines'a girer, InvoiceItem'a YAZILMAZ
```

Faturanın kaleminde yalnız seçeneğin **adı** durur — müşterinin belgesinde "0,2 LT soya
sütü" satırının işi yok. Kopyalama kuralı fiyatınkiyle aynı: menü sonradan düzenlense
açık adisyonun stok karşılığı değişmez.

| Ne | Nerede |
|---|---|
| Etki tipi + güvenli okuyucu | `lib/stock/recipe-expand.ts` — `RecipeEffect`, `parseRecipeEffects`, `hasActiveRecipe` |
| Genişletme | Aynı dosya: SWAP **her derinlikte** uygulanır (kahve, Espresso'nun içinden gelse de), ADD kök mamüle atfedilir, çarpan yalnız reçeteli üründe |
| Tanım → etki çevrimi | `lib/restoran/ticket-constants.ts` — `optionEffect`, `optionRecipeEffects` (çarpanlar ÇARPILARAK birleşir) |
| Kaleme kopyalama | `adisyonlar/[id]/kalemler` POST |
| Kapanış | `kapat` GET (fiş gövdesi) + `writeCompWasteStock` (ikram/zayi de aynı etkiyi uygular) |
| Kahveci | `cafe-sale-screen` → `submitReceiptSale` (`recipeEffects`/`recipeFactor` alanları) |
| Kurulum | `product-options-dialog` — şık satırındaki 🧪 düğmesinin arkasında (K8 mantığı: dört alan her şıkta açık durmaz) |
| Uyarı | İki satış ekranının "yetersiz stok" şeridi de etkileri hesaba katar — uyarı ile fiilen düşen miktar ayrışmaz |

`expandBase: false` bayrağı: reçetesiz bir ürünün seçeneğinde ek malzeme varsa
(kutu kola + pipet) ürünün kendi hareketi satır satır korunur, yalnız ek malzeme
genişletilir. Genişletici aynı ürünün iki satırını tek satırda toplardı.

### Doğrulama

| Betik | Sonuç |
|---|---|
| `node scripts/test-recipe-expand.mjs` | **84/84** (+39): değişim, alt reçetede değişim, çıkarma, ekleme (iç içe reçeteyle), çarpan, çarpanın ek malzemeyi ölçeklememesi, satır bazlılık, birim uyuşmazlığı, silinmiş hedef |
| `node scripts/test-ticket-totals.mjs` | **38/38** (+13): etkinin kaleme kopyalanıp geri okunması, bozuk etkinin elenmesi, çarpanların çarpılması |
| `npx tsx scripts/test-comp-waste-stock.ts` | **13/13** (+2): ikramda da çıkarma ve çarpan uygulanıyor |
| `node scripts/test-receipt-sale.mjs` | **23/23** (+4): etki fiş ucuna gidiyor, etkisiz satıra alan eklenmiyor |
| `node scripts/test-restoran-adisyon.mjs` (gerçek uçlar) | **80/80** (+12): **"sütsüz" seçilince süt 0 düştü**, **"büyük boy" tam 2 kat düştü**, başka firmanın ürünü etkiye bağlanamıyor, fatura kalemi yalnız seçenek adını taşıyor |
| `test-payment` · `test-avco-revert` | 32/32 · 15/15 |

`tsc --noEmit` ve `eslint` temiz.

### Bilinçli sınırlar

- **Menü performansı raporu** maliyeti fatura kaleminden + reçeteden türetiyor; etkiler
  faturada durmadığı için o rapor soya sütlü latte'yi **temel reçeteyle** maliyetlendirir.
  Stok bakiyesi ve karlılık raporu doğru (hareketler gerçek malzemeyi taşıyor). Kesin
  çözüm `stock_movements.sourceProductId` — ilerleme.md'de zaten açık duran iş.
- Değişimde miktar reçeteden gelir; "yarım porsiyon soya sütü" gibi bir ayar yok
  (gerekirse ekleme + hedefsiz değişim ile kurulur).
- Etkiyi olmayan bir bileşene bağlamak (reçetede geçmeyen ürün) sessizce etkisizdir —
  hata değil: reçete sonradan değişebilir.

## Kaynaklar

- Adisyo — [ürün sayfası](https://adisyo.com/restoran-otomasyon-sistemi) ·
  [kullanım kılavuzu](https://destek.adisyo.com/adisyo-kullanim-kilavuzu) ·
  [sipariş oluşturma](https://adisyodestek.zendesk.com/hc/tr/articles/26054719761426-Sipari%C5%9F-Olu%C5%9Fturma)
- Loyverse — [açık adisyonlar](https://help.loyverse.com/help/open-tickets) ·
  [adisyon bölme](https://help.loyverse.com/help/how-split-open-ticket-loyverse-pos) ·
  [parçalı ödeme](https://help.loyverse.com/help/payment-loyvers) ·
  [adisyon birleştirme](https://help.loyverse.com/help/how-merge-open-tickets-loyverse-pos)
- Square for Restaurants — [comp & void](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void) ·
  [çek yönetimi](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants) ·
  [iskonto/comp/void raporları](https://squareup.com/help/us/en/article/8359-view-discounts-comp-and-void-reports)
- SambaPOS — [porsiyon ve sipariş etiketi seçimi](https://destek.sambapos.com/t/siparis-ekraninda-urun-porsiyon-ve-siparis-etiketi-secimi/730)
- POS UX — [dev.pro: 10 UX tactics](https://dev.pro/insights/designing-a-pos-system-ten-user-experience-tactics-that-improve-usability/) ·
  [hashmato: POS design principles](https://hashmato.com/point-of-sale-system-design-principles-tactics/) ·
  [BLogic: split checks](https://www.blogicsystems.com/blog/restaurant-pos-systems-handling-split-checks)
- TR pazar / yemek kartı — [vRest: yemek kartı POS entegrasyonu](https://vrest.com.tr/blog/yemek-karti-pos-entegrasyonu-2026) ·
  [robotPOS: adisyon programı rehberi](https://www.robotpos.com/blog_new/adisyon-programi-nedir-restoran-cafe-2026-rehberi)
