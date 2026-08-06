# Restoran & Kafe — kapanmış adisyonun detay sayfası

> Bağlam: [ASAMA2.md](./ASAMA2.md) (adisyon modeli) ·
> [SATIS-EKRANI.md](./SATIS-EKRANI.md) (K1 kontrol bütçesi · K3/K3.1 iskonto) ·
> [DENETIM-VE-TEMIZLIK.md](./DENETIM-VE-TEMIZLIK.md) (Faz 4 ölçüm, personel kırılımı)
>
> **Tarih:** 2026-08-06 · Bu belge yalnız **tasarım kaydıdır**; kod henüz yazılmadı.
> Uygulama sırası ve doğrulama adımları en altta.

## Neden

Adisyonun kendi sayfası (`/restoran/adisyon/[id]`) teknik olarak var ama **tek bir kip**
tanıyor: `app/(dashboard)/restoran/adisyon/[id]/page.tsx` her durumda POS çalışma ekranını
(`components/restoran/ticket-screen.tsx`) basıyor. Adisyon kapandıktan sonra o ekran anlamını
yitiriyor:

| Belirti | Yer |
|---|---|
| Ekranın ~%60'ı "Bu adisyon kapandı" yazan boş bir kart | `ticket-screen.tsx:831` |
| Süre sayacı `openedAt → şimdi` ölçüyor, sonsuza dek artıyor ("50 sa 40 dk") | `ticket-screen.tsx:781` |
| Fiş numarası düz metin — mali belgeye geçiş yok | `ticket-screen.tsx:809` |
| Ödeme dökümü, personel izi, birleştirme zinciri hiç görünmüyor | — |
| Menü, reçete, ürün seçenekleri, depo, finans hesabı, fiş şablonu SWR'ları boşuna kuruluyor | `ticket-screen.tsx:130-140` |

Sorulan soru kapanıştan sonra değişiyor. Açık adisyonda soru "ne ekleyeyim, nasıl tahsil
edeyim"; kapandıktan sonra **"bu hesapta ne oldu"**: kim açtı, ne zaman kapandı, kim indirim
verdi, nasıl tahsil edildi, eksik kalan var mı. Bugünkü ekran bu soruların hiçbirini
cevaplamıyor — üstelik `openedBy`/`closedBy` gibi alanlar yıllardır yazılıyor
(bkz. DENETIM-VE-TEMIZLIK.md "yazılıp hiç okunmayan veri").

İkinci kusur erişimde: Adisyonlar listesindeki kartlar `<button onClick={router.push}>`
(`components/restoran/tickets-screen.tsx:381`). Gerçek `<a href>` olmadığı için **sağ tık →
yeni sekmede aç**, orta tık ve link önizleme çalışmıyor — birden çok adisyonu yan yana
karşılaştırmak imkânsız.

Örnek desen projede hazır: `app/(dashboard)/fisler/[id]/page.tsx` — rozetli başlık, kalem
tablosu, tahsilat tablosu. Yeni sayfa onun görsel dilini izler.

---

## Kararlar

### K1 — Tek URL, iki kip; kip ilk yüklemede dondurulur

URL adisyonun kimliğidir ve kapanınca **değişmemelidir**: hesap açıkken paylaşılmış ya da yer
imlenmiş bir link kapandıktan sonra da çalışmalı. Bu yüzden ayrı bir `/detay` yolu açılmıyor.

`page.tsx` ince server component olarak kalır. Yeni bir istemci bileşeni `useTicket` ile
durumu okur ve kipi seçer:

```
OPEN                  → <TicketScreen>          (bugünkü POS ekranı, değişmiyor)
CLOSED | CANCELLED    → <TicketDetailScreen>    (yeni, salt okunur)
```

Ağır SWR'lar `TicketScreen`'in içinde yaşadığı için kapalı adisyonda hiç kurulmaz. Her iki
bileşen de aynı SWR anahtarını kullandığından çift istek çıkmaz.

**Kip ilk BAŞARILI yüklemede dondurulur, `status` değiştikçe değil.** Aksi halde kasiyer
hesabı kapatır kapatmaz ekran detay kipine atlar ve "Hesap kapatıldı" penceresi
(Fişi göster / Yazdır / Masalara dön) daha görünmeden unmount olur.

### K2 — Detay verisi `?detail=1` ile gelir; `serializeTicket` genişletilmez

Liste ucu (`/api/restoran/adisyonlar`, `limit=200`) ile tek-kayıt ucu **aynı** serializer'ı
kullanıyor (`lib/restoran/tickets.ts` → `serializeTicket`). Ödeme satırlarını ve kullanıcı
adlarını oraya eklemek 200 kayıtlık listeyi şişirir ve her liste isteğine ek sorgular getirir.

Bunun yerine `GET /api/restoran/adisyonlar/[id]` yalnız `?detail=1` geldiğinde çıktının üstüne
ek alanlar koyar. Param'sız çağrı — canlı POS ekranı bunu **her kalem eklemede** yeniden
çekiyor — bugünkü maliyetinde kalır.

| Alan | Kaynak |
|---|---|
| `staff.{openedBy, closedBy, billRequestedBy, discountBy}` → `{id, name}` | `User` |
| `items[].createdByName` | `User` |
| `durationMin` (oturma süresi) | `openedAt → closedAt` |
| `invoice.{id, slug, invoiceNo, status, netAmount, vatAmount, totalAmount, globalDiscountAmount}` | `Invoice` |
| `invoice.payments[]` → `{amount, method, methodLabel, paymentDate, accountName, notes}` | `InvoicePayment` + `account` |
| `invoice.{paidTotal, paymentStatus}` — `PAID` / `PARTIAL` / `OPEN` | hesaplanır |
| `merge.into` → `{id, code}` · `merge.from[]` → `{id, code, total}` | `mergedInto` / `mergedFrom` |
| `reservation` → `{id, guestName, reservedAt}` | `RestaurantReservation` |

Yeniden kullanılacaklar:

- **Kullanıcı adı çözümü:** `app/api/restoran/raporlar/denetim/route.ts:317-327` deseni — tüm
  id'ler toplanır, **tek** `prisma.user.findMany`, ad `name || email || id`.
- **`merge.from[].total`:** `ticketTotals(items, ticketDiscountOf(t))`
  (`lib/restoran/ticket-constants.ts`).
- **`paidTotal` DECIMAL ile toplanmalı.** `Number` ile toplamak, `faturalar/odemeler/route.ts`
  ucunda 2026-08-06'da düzeltilen hatanın aynısını üretir: kuruşlar ikilik tabanda tam
  gösterilemediği için hesabı tam kapatan tutar eksik/fazla görünür.
- **Yemek kartı sağlayıcısı `InvoicePayment.notes` alanındadır** (bkz. `lib/satis/payment.ts`
  dosya başlığı); etiket `PAYMENT_METHOD_LABELS`'tan gelir, sağlayıcı notu ayrı basılır.

### K3 — `TicketPanel` yeniden KULLANILMAZ

`components/restoran/ticket-panel.tsx` bilinçli olarak dar bir POS sütunudur: yüksekliği
`max-h-[52vh]` ile sınırlı ve ara toplam/KDV dökümü **kaldırılmıştır** — gerekçe dosyanın
kendi yorumunda (satır ~286): *"kasiyerin kararını değiştirmiyordu"*. Denetim sayfasının
ihtiyacı bunun tam tersidir. `fisler/[id]` tablo düzeni izlenir.

Ekran bölümleri:

```
Masa M3 · ADS-2026-0008                    [Kapandı] [Tahsil edildi]
18:14 – 18:33 · 19 dk · 2 kişi · müşteri        → Fiş FS-SAT-2026-0026
                                             [Fişi göster] [Yazdır]

KALEMLER      Saat · Ürün (+seçenek/not) · Adet · Birim · KDV · Tutar · Ekleyen
              İkram / Zayi / İptal rozeti ve sebebi
TUTARLAR      Ara toplam · KDV · İskonto (%oran · sebep · veren personel) · TOPLAM
TAHSİLAT      Yöntem · Kasa/Banka · Saat · Tutar        (eksik kalmışsa uyarı satırı)
PERSONEL İZİ  Açan · Kapatan · Hesap isteyen · İskontoyu uygulayan  (+saat)
BİRLEŞTİRME   "Şu adisyona birleştirildi →" ya da "Buraya birleştirilenler"  (linkli)
İPTAL         Sebep kodu + serbest metin        (yalnız CANCELLED)
```

Tahsilat bölümünün eksiği göstermesi süs değil: kapanış sırasında fiş kesilip tahsilatın bir
parçası yazılamayabiliyor (`ticket-screen.tsx:593` "Fiş oluştu, tahsilat kaydedilemedi"). O
durumda adisyon kapanır, fiş durur, para eksik kalır — ve bugün bu **hiçbir ekranda**
görünmez.

### K4 — Yazdırma ortak bir yardımcıya çıkar

`window.open("", "_blank", "width=420,height=720")` + `buildReceiptHtml` + `document.write`
üçlüsü kod tabanında **altı yerde** kopyalanmış: `ticket-screen.tsx:529` ·
`cafe-sale-screen.tsx:676` · `quick-sale-screen.tsx:595` · `quick-purchase-screen.tsx:596` ·
`fisler/[id]/page.tsx:159` · `e-donusum/sablon/page.tsx:277`.

Yeni ekran yedincisi olmasın: `lib/fis/print-receipt.ts` →
`printReceipt(data, autoPrint, template)`; açılır pencere engellenirse `null` döner, çağıran
toast basar. Bu turda yalnız **iki** çağıran taşınır — yeni ekran ve zaten dokunulan
`ticket-screen.tsx`. Kalan dört kopya ayrı iştir.

Kapanmış adisyonun çıktısı **gerçek fiştir**, hesap fişi değil: `prebill` verilmez,
`reference = "ADS-2026-0008 · Masa M3"`, parçalı tahsilatta `parts` doldurulur, `discount`
satırı iskonto etiketiyle (oran · sebep · personel) basılır.

### K5 — Listede ve raporda gerçek link

`tickets-screen.tsx` içindeki `TicketCard`'ın `<button>` sarmalayıcısı `CompanyLink`
(`components/dashboard/company-link.tsx`) olur, `className="block …"`. Bu ekran **aktif
firmanın** adisyonlarını listelediği için `CompanyLink` doğru araçtır; CLAUDE.md'deki "sayfa
farklı bir firmanın verisini gösteriyorsa `withCompanyHref` kullan" istisnası burada geçerli
değildir. Kart içinde iç içe interaktif öğe yok, `<a>` sarmalaması geçerli kalır.

Denetim raporundaki (`components/restoran/reports/denetim.tsx`) **"İptal edilen adisyonlar"**
ve **"İskontolu adisyonlar"** tablolarındaki `ADS-2026-xxxx` kodları da linklenir — her iki
veri kümesi de `id` döndürüyor. Rapor bulgusundan kaynağa tek tıkla inilir.

---

## Uygulama sırası ve DURUM

> Son güncelleme: 2026-08-06. Başka bir makinede devam ederken önce
> `npm install && npx prisma generate` — şema bu daldan önce değişti ve
> `prisma db push` paylaşılan Supabase veritabanına ZATEN uygulandı, tekrar
> gerekmez (bkz. `RestaurantTicket.discount*` alanları).

| # | İş | Durum | Dosya |
|---|---|---|---|
| 1 | API `?detail=1` + ek alanlar | **bitti** | `lib/restoran/ticket-detail.ts` (yeni) · `app/api/restoran/adisyonlar/[id]/route.ts` |
| 2 | `useTicketDetail` + `TicketDetail` tipi | **bitti** | `lib/swr/use-restoran.ts` |
| 3 | `printReceipt` çıkarıldı, `ticket-screen` taşındı | **bitti** | `lib/fis/print-receipt.ts` (yeni) |
| 4 | Detay ekranı | **bitti** (tarayıcıda HENÜZ görülmedi — 5 olmadan erişilemiyor) | `components/restoran/ticket-detail-screen.tsx` (yeni) |
| 5 | Kip seçici + `page.tsx` | **sırada** | `app/(dashboard)/restoran/adisyon/[id]/page.tsx` |
| 6 | Liste ve rapor linkleri | bekliyor | `components/restoran/tickets-screen.tsx` · `components/restoran/reports/denetim.tsx` |

Adım 4'e ek olarak, iskonto etiketi üç ekranın (POS, detay, fiş) ayrışmaması için
`lib/restoran/ticket-constants.ts` içindeki `ticketDiscountLabel`'a taşındı.

**Adım 5 nasıl yapılacak:** `page.tsx` ince server component olarak kalır; yeni bir istemci
bileşeni `useTicket` ile durumu okuyup `OPEN → <TicketScreen>`, aksi halde
`<TicketDetailScreen>` render eder. K1'deki **kip dondurma** şart: kip ilk başarılı
yüklemede sabitlenir, sonra `status` değişse de değişmez.

**Doğrulanmamış olan:** detay ekranı henüz tarayıcıda açılmadı (adım 5 bitmeden yol yok).
Adım 5 biter bitmez aşağıdaki "Doğrulama" listesi koşulmalı.

## Doğrulama

- `npx tsc --noEmit` · `npx eslint <değişen dosyalar>` · `npm run build`
- `node scripts/test-restoran-adisyon.mjs` (dev sunucusu açıkken) — tek adisyon GET'i
  değiştiği için bu paket regresyon kapısıdır. Temizlik adımındaki fiş silme hatası (`P2028`,
  Supabase havuz bağlantısının bilinen kırılganlığı) rastgele düşebilir; tekrar koşulur.
- Tarayıcıda:
  - **Kapalı + iskontolu bir adisyon** → süre sabit ("19 dk", artmıyor), iskonto satırında
    sebep ve veren personel, tahsilat tablosunda yöntem ve kasa
  - **Parçalı ödenmiş, tahsilatı eksik kalmış bir adisyon** → "Kısmî" rozeti ve eksik tutar
    görünmeli (bu senaryonun canlı örneği mevcut: FS-SAT-2026-0027)
  - **Açık bir adisyon** → hâlâ POS ekranı açılmalı
  - Listede bir karta **sağ tık → yeni sekmede aç** ve **orta tık** çalışmalı, adres çubuğunda
    `?company=` korunmalı
  - Denetim raporundaki adisyon kodundan detaya inilmeli
- **Kapanış regresyonu:** açık bir adisyonu kapat → "Hesap kapatıldı" penceresi görünmeli.
  K1'deki kip dondurma uygulanmadıysa bu adım patlar.

## Kapsam dışı (bilinçli)

- **Salon planındaki masaya dokunma** (`floor-plan-screen.tsx:502`) `router.push` olarak kalır:
  orası tuval üzerinde bir POS hareketi, gezinme linki değil.
- **Adisyona SEF slug** eklenmiyor. `RestaurantTicket` `lib/slug-resolve.ts`'teki `SlugModel`
  listesinde yok; `code` (`ADS-2026-0008`) firma içinde benzersiz olduğundan ileride okunabilir
  URL'e temel olabilir — ayrı iş.
- Kalan dört `window.open` kopyasının `printReceipt`'e taşınması.
- Kapanmış adisyonun **düzenlenmesi** — sayfa salt okunurdur; düzeltme yolu fişin kendisidir.
