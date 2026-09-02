# Fiş tarama → alış fişi

Fotoğraftan çıkarım (2026-09-02, `0055f1f`) kayıt üretmiyordu; bu belge kaydın
nasıl açıldığını ve hangi kararların bilerek alındığını anlatır.

## Akış

```
fotoğraf ──POST /api/alis/fis-tarama──► model okur (Gemini 3.7 Flash)
                                          │
                                          ▼
                              her fiş için ONAY KARTI (düzenlenebilir)
                                          │  tedarikçi + ödeme + kalemler
                                          ▼
                     GET /api/alis/fis-tarama  (mükerrer denetimi)
                                          │
                                          ▼
              POST /api/e-donusum/invoices  →  FS-ALI-YYYY-XXXX (alış fişi)
              POST /api/faturalar/odemeler  →  tahsilat
```

Kayıt **yeni bir kapıdan geçmiyor**: Hızlı Alış'ın kullandığı uçların aynısı.
Fiş kesme mantığının (numara serisi, stok, cari, kota, muhasebe) ikinci bir
kopyası yok. Fiş tarama, o tezgâhın sepetini klavye yerine fotoğraftan dolduran
bir ön yüzdür.

## Dosyalar

| Dosya | Rol |
|---|---|
| `lib/fis-ocr/schema.ts` | Şema + prompt. `scripts/ai-fis-test.mjs` ile **İKİZ** — biri değişirse öteki de. |
| `lib/fis-ocr/extract.ts` | Sağlayıcı çağrısı, görsel küçültme, `normalizeOdeme` |
| `lib/fis-ocr/validate.ts` | 5 deterministik denetim (saf — istemci de çağırır) |
| `lib/fis-ocr/to-invoice.ts` | **Fiş → fatura gövdesi.** Saf; ekran da sunucu da aynı sonucu görsün diye |
| `lib/fis-ocr/access.ts` | `FIS_TARAMA_COMPANIES` beyaz listesi (fail-closed) |
| `app/api/alis/fis-tarama/route.ts` | POST tarama (para harcar) · GET mükerrer denetimi |
| `components/alis/fis-onay-karti.tsx` | Tek fişin onay + kayıt kartı |
| `components/alis/fis-tarama-screen.tsx` | Kabuk: fotoğraf, tarama, ölçüm paneli (gizli) |

## Kararlar ve gerekçeleri

**Kayıt hedefi alış fişidir** (`Invoice type=PURCHASE, isReceipt=true`). Gider
(`Transaction EXPENSE`) daha sade olurdu ama kalem detayını, KDV kırılımını ve
tedarikçi cari hareketini kaybederdi. Alış fişi ayrıca Alış Fişleri listesinde
görünüyor ve toplu faturaya dönüştürülebiliyor.

**Fotoğraf saklanmıyor.** Okuma bitince atılıyor. Bedeli açık: "bu rakam fişte
böyle miydi" sorusu sonradan yanıtlanamaz. Karşılığında depolama sağlayıcısına
bağımlılık, mali veri saklama ve maliyet yok. Kullanıcı zaten kaydetmeden önce
ekranda her rakamı görüyor.

**Nota yalnız fişin kendi bilgisi yazılır:** `Fiş No`, `Satıcı` ve kayıt tarihi.
Bir ara `Fotoğraftan tarandı (<model adı>)` da yazıyordu; kaldırıldı — hangi
modelin okuduğu bir üretim ayrıntısıdır, kullanıcının belgesinde işi yok. Sonuç
olarak kaydın fiş taramadan geldiğine dair **hiçbir iz kalmıyor** (fotoğraf da
saklanmadığına göre); bilinçli tercih. `to-invoice.test.ts` model adının nota
geri sızmasını bekçilik ediyor.

**Kuyruk yok, akış anında.** Tarama sonucu kaydedilmezse kaybolur. Bu yüzden
kalıcı bir `ReceiptScan` tablosu, migrasyon ve RLS işi de yok.

**Ödeme şekli fişten okunuyor.** Prompt'a `odeme` alanı eklendi
(`NAKIT · KREDI_KARTI · YEMEK_KARTI · HAVALE`). Bunun için POS slipi kuralı
gevşetildi — slip hâlâ ayrı fiş değil ve kalemleri kalem değil, ama ödeme şekli
oradan da okunabiliyor. Küme şemaya `enum` olarak YAZILAMIYOR (strict
`json_schema`'da enum + null bazı sağlayıcılarda reddediliyor); denetim kodda,
`normalizeOdeme` içinde.

**Fatura numarası FS- serisinde kalır.** Fişin kendi numarası `invoiceNo`'ya
YAZILMAZ: `@@unique([companyId, invoiceNo])` yüzünden iki farklı marketin aynı
fiş numarası çakışır ve fiş serisini bozar. Fiş no notlara düşer.

## Aritmetiğin çapası: `tutar`

Yazarkasa fişi **KDV dahil** basar, fatura ucu **KDV hariç** birim fiyat bekler.
Modelin en güvenilir okuduğu alan satırın KDV dahil toplamıdır (birim fiyat çoğu
fişte hiç basılmaz). Bu yüzden net, birim fiyattan ileri doğru değil **tutardan
geri** çözülür — `solveNetFromTotal` (`lib/invoice/line-tax.ts`), yani editörün
"Tutar yazınca birim fiyatı çöz" davranışının aynısı.

Geri çözümün artığı `Invoice.payableRoundingAmount`a yazılır (KDV'ye girmez,
yalnız ödenecek tutara eklenir). Böylece **kaydedilen toplam fişin genel
toplamına birebir eşit** olur.

Artık **0,50 TL'yi aşarsa** bu kuruş farkı değil gerçek sapmadır (eksik ya da
fazla okunmuş satır) → ağır uyarı, kayıt kilitlenir. Ölçüm fişlerinde artık
sıfırdı: 319,06 → 319,06 ve 650,00 → 650,00.

Miktar `Decimal(10,2)` olduğu için 2 haneye yuvarlanır; hassasiyet
`Decimal(15,6)` olan birim fiyata taşınır, satırın toplamı korunur.

## Kaydı tutan kapılar

1. **Patlayan denetim / ağır dönüşüm uyarısı** → onay kutusuyla aşılır.
2. **Mükerrer** (aynı tedarikçi + gün + tutar) → onay kutusuyla aşılır.

Onay kutusu ikisini birden aşıyor ama mükerrer denetimi **kutuya bakmaz**: koşul
mükerrerin ekranda GÖRÜLMÜŞ olmasıdır. Aksi hâlde patlayan bir denetim için
işaretlenen kutu, mükerrer korumasını da sessizce kapatırdı.

**Tedarikçi zorunlu DEĞİL.** Bir süre öyleydi; gerekçe "VKN checksum'ı bir elek
(yanlış numara ~1/10 geçer, ölçümde geçti de), gerçek emniyet cari eşleşmesidir"
idi. Ama bu argüman doğrulama GÜVENİNE dair, kaydın geçerliliğine dair değil:
`Invoice.supplierId` nullable ve Hızlı Alış da tedarikçisiz fiş kesiyor — fiş
taramayı tek istisna yapmak tutarsızdı. Uyarı duruyor, kilit kalktı; ekran
tedarikçisiz kaydın **hiçbir cari ekstresinde görünmeyeceğini** açıkça söylüyor.

Tedarikçi seçilmediğinde mükerrer koruması kapanmaz, **daralır**: bu kez
tedarikçisiz alış fişleri arasında gün + tutar aranır. Yanlış eşleşme olasılığı
artar ama sonuç zaten bir uyarı — bedeli fazladan bir soru, korumayı kapatmanın
bedeli ise sessiz mükerrer kayıt.

Denetimler her düzeltmede istemcide yeniden koşar (`validate.ts` saf) — kullanıcı
VKN'yi düzeltince rozet de düzelir.

## Yetki yüzeyi kendi ucundan geniştir

Ekran kendi yazma kapısını açmadığı için `PAGE_API_RULES`'ta **altı ucun**
`/alis/fis-tarama`'yı tanıması gerekiyor:

| uç | neden |
|---|---|
| `/api/cari/suppliers` | okuma — VKN eşleşmesi (`PURCHASE_DOC_PAGES` üzerinden) |
| `/api/stok` | okuma — kalem eşleşmesi (aynı liste) |
| `/api/finans/accounts` | okuma — tahsilat kanalı |
| `/api/depolar` | okuma — stoğa işleme açıkken varsayılan depo |
| `/api/e-donusum/invoices` | **yazma** — fişi kesen uç |
| `/api/faturalar/odemeler` | **yazma** — tahsilat |

Kısıtsız rollerde eksik bir satır fark edilmez (kullanıcı başka alış ekranlarını
da görüyordur); yalnızca bu sayfaya izinli bir çalışanda akış sessizce 403'e
düşer. `lib/page-access.test.ts` içindeki *"fiş tarama ekranı, kaydın gerektirdiği
HER uca erişebilir"* testi tam bu senaryoyu ölçüyor.

**Cari kartı açma bilerek DIŞARIDA:** `/api/cari/suppliers` yazma sahibi
`/cari/tedarikci`'dir. Ekran "tedarikçi oluştur" düğmesini `useCanCreateCari()`
ile gizler ve kartı ortak `QuickCariDialog` açar (VKN ön dolgulu). Elden bir POST
yazmak, sunucunun reddedeceği bir düğme göstermek olurdu.

## Stok bilerek KAPALI doğar

"Kalemleri ürünlerle eşleştir ve stoğa işle" anahtarı varsayılan olarak kapalı.
Fişte birim yazmaz (`ADET` varsayılıyor) ve çoğu satırda miktar da basılmaz
(1 kabul ediliyor). Eşleşen bir ürüne "1 ADET" girmek stok bakiyesini sessizce
bozar. Açan kullanıcı kaç satırın eşleştiğini ekranda görüyor.

## Sınırlar

- **Parçalı ödeme okunmuyor.** Şema tek ödeme satırı taşıyor. Fişten okunan
  ödeme tutarı genel toplamdan düşükse ekran uyarıyor; tahsilatın tamamı tek
  kanala yazılır, kullanıcı Fişler ekranından düzeltir.
- **Nakit ödeme ÖLÇÜLMEDİ.** Elimizdeki üç örnek fişin üçü de kartla ödenmiş.
  `KREDI_KARTI` doğruluğu %100 ölçüldü; `NAKIT` okuması ilk nakit fişle
  doğrulanmalı.
- **Aylık tavan** `usage_limits` satırından (`fis_tarama_monthly`), ilk
  oluşumda 1000. Sayaç model çağrılmadan önce artar: sağlayıcı hata dönerse
  bedava bir tarama sayılmış olur.
- Beyaz liste (`FIS_TARAMA_COMPANIES`) yerinde. Kayıt üretmek denemeyi ürün
  yapmıyor; modül/kota kalemi hâlâ yok.

## Ölçüm (2026-09-02, ödeme alanı eklendikten sonra)

`node scripts/ai-fis-test.mjs --dir ./fis-ornekleri --model <liste>`

| model | doğruluk | fiş başına | süre/kare |
|---|---|---|---|
| **google/gemini-3.7-flash** (varsayılan) | **%100** | $0,00286 | 4,1 sn |
| google/gemini-2.5-flash | %98 (bir VKN) | $0,00143 | 3,2 sn |
| qwen/qwen2.5-vl-72b | %65, 2 KDV hatası | $0,00100 | 16,2 sn |

Prompt gevşemesi geri tepmedi: Qwen'in fazladan kalemi POS slipi değil, TOPKDV'yi
kalem sanması. Ödeme şekli dört fişin dördünde de doğru okundu.

**Prompt'u değiştiren bu ölçümü yeniden koşmalı** — ikiz dosyalar ayrışırsa
tezgâhın sayıları yalan söylemeye başlar.

## Sırada

- Nakit ödenmiş bir fişle `NAKIT` okumasını doğrula.
- Canlıda bir firmada uçtan uca dene (tedarikçi oluşturma + kayıt + tahsilat).
- Deneme ürüne dönerse: modül kalemi, kota, `PricingItem` — beyaz liste kalkar.
