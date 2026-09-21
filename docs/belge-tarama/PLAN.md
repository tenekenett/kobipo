# Belge Tarama — fiş taramadan belge kutusuna

> **Amaç:** Kullanıcı elindeki belgeyi (fotoğraf, PDF, e-Arşiv, UBL XML) atar;
> sistem belgenin **ne olduğunu**, **bize ait olup olmadığını** ve **hangi kayda
> dönüşeceğini** kendisi bulur; kullanıcı yalnız onaylar. Bugünkü Fiş Tarama bu
> kutunun tek türlü ilk hâlidir ve **olduğu gibi korunur**.

> **Bu dosya oturumlar arası hafızadır.** Devam etmeden önce "İlerleme Günlüğü"ne
> ve §9 kararlara bak. Kararlar 2026-09-21'de verildi (§9), Faz 0 aynı gün başladı.
> Her anlamlı adımda checkbox işaretle, günlüğe satır ekle.

---

## 1. Kapsam

### 1.1 Bir KOBİ'ye "bizle alakalı" ne gelir

| Belge | Geliş biçimi | Kobipo'daki kaydı | Bugün | Faz |
|---|---|---|---|---|
| Yazarkasa / perakende fişi | foto | alış fişi (`Invoice` `isReceipt`) | **var** | — |
| Kâğıt alış faturası | foto | alış faturası (`PURCHASE`/`MANUAL`, no belgeden) | yok | 1 |
| e-Arşiv fatura (tedarikçiden) | PDF (e-posta / SMS linki) | alış faturası | yok — yalnız UBL XML `app/api/import` (`invoices-ubl`) | 1 |
| Elektrik / su / doğalgaz / telekom | e-Arşiv PDF | alış faturası (`globalChargeAmount` deseni hazır) | e-Arşiv ile aynı yol | 1 |
| Kâğıt sevk irsaliyesi | foto | alış irsaliyesi (`Waybill PURCHASE`) → "Teslim alındı" ile stok | yok | 2 |
| e-Fatura | Mysoft gelen kutusu | alış faturası | **var** (Gelen E-Faturalar) | — |
| e-İrsaliye (tedarikçiden) | Mysoft | alış irsaliyesi | yok — `/api/e-irsaliye` yalnız GİDEN | sonra |
| Banka dekontu / havale makbuzu | PDF, foto | fatura ödemesi (`/api/faturalar/odemeler`) | yok | 4 |
| Çek / senet | foto | `Check` (`/api/cek-senet`) | model **hazır**, okuma yok | 4 |
| e-SMM (avukat, mali müşavir, doktor) | PDF | alış faturası + **gelir vergisi stopajı** | model boşluğu: `Invoice` yalnız KDV tevkifatı taşır | 5 |
| Banka / kredi kartı ekstresi | PDF, Excel | mutabakat / çoklu gider | `/finans/mutabakat` var; okuma yolu incelenmedi | sonra |
| Vergi / SGK tahakkuk fişi | PDF | ödeme yükümlülüğü | model yok | sonra |
| Kira makbuzu, sigorta poliçesi | foto / PDF | gider | yok | sonra |
| Müşteriden sipariş (e-posta, ekran görüntüsü, el yazısı) | foto | satış siparişi | yok — satış tarafı | sonra |
| Kendi kestiğimiz elle yazılmış fatura / irsaliye kopyası | foto | satış kaydı | yok — satış tarafı | sonra |

Üç doğal katman: **(a)** kayıt modeli hazır, yalnız okuma katmanı eksik (fatura,
e-Arşiv PDF, irsaliye, dekont, çek) → Faz 1–4; **(b)** veri modelinde boşluk olanlar
(SMM stopajı, tahakkuk, kart ekstresi) → Faz 5+; **(c)** satış tarafı → **kapsamda**
(karar F, 2026-09-21): "kâğıt ne varsa" — her türün iki yönü var, yön VKN'den
türetilir (§3.2). Satış hedefleri §3.8'de; satış kayıtları Faz 1–2'nin ikinci
yarısı olarak yazılır (alış oturduktan sonra, aynı şema/kart, farklı hedef).

### 1.2 Kapsam dışı (bilerek, şimdilik)

- Tahakkuk fişleri, kart ekstresi, poliçe — kayıt modeli olmadan okuma anlamsız.
- e-İrsaliye gelen kutusu (Mysoft ucu ayrı iş).
- Otomatik (onaysız) kayıt — hiçbir fazda yok. Bkz. §2.

---

## 2. Değişmeyenler — koruma altındaki kararlar

1. **Fiş prompt'u ve şeması (`lib/fis-ocr/schema.ts`) DEĞİŞMEZ.** %100 ölçülmüş
   (2026-09-02). Sınıflandırıcı "fiş" derse aynı şema koşar; tezgâh aynı sayıları
   vermeli. Fiş yolunun yeni boru hattına taşınması EN SON adımdır (Faz 3) ve
   şartı ölçüm eşitliğidir.
2. **Kayıt tek kapıdan.** Belge tarama kendi yazma ucunu AÇMAZ: fatura
   `/api/e-donusum/invoices`, irsaliye `/api/irsaliye`, ödeme
   `/api/faturalar/odemeler`, çek `/api/cek-senet`. Numara serisi, stok, cari, kota,
   muhasebe mantığının ikinci kopyası yok (bkz. `docs/fis-tarama/KAYIT-AKISI.md`).
3. **Dip toplam yalnız `lib/invoice/document-totals.ts`ten** (`computeInvoiceTotals`);
   fiş `{ receipt: true }` kuralında kalır (CLAUDE.md).
4. **Sessiz kayıt yok.** Her belge onay kartından geçer; patlayan denetim / ağır
   uyarı / mükerrer kaydı kilitler, tek onay kutusuyla aşılır. "Tek tık" olur,
   "sıfır tık" olmaz.
5. **Fotoğraf saklanmıyor** — depolama kararı (§9) verilene kadar. Verilirse kanal
   `lib/storage/object-store.ts`tir (sağlayıcı seçimi kullanıcının).
6. **Firma bağlamı `?company=`**, rol seçili firmadan (CLAUDE.md). Belge başka firmaya
   aitse ekran bunu söyler, sessizce yazmaz.
7. **Beyaz liste + aylık tavan** (`FIS_TARAMA_COMPANIES`, `usage_limits`) kalır; deneme
   kapsamı genişliyor, ürün olmuyor. Ürünleşme ayrı karar (§9).

---

## 3. Mimari

### 3.1 Belirlilik merdiveni — en kesinden en tahminliye

Aynı belge için birden çok okuma yolu var; **ilk çalışan kazanır, alttaki üsttekini
doğrular.** Model, mümkün olan her yerde kaynak değil DENETİM aracıdır.

| Basamak | Girdi | Ne verir | Kesinlik | Maliyet |
|---|---|---|---|---|
| 1. UBL XML eki | PDF/A-3 gömülü XML, ya da doğrudan .xml | belgenin tamamı | tam | 0 |
| 2. Karekod | e-Arşiv / e-Fatura / e-SMM PDF'inin 1. sayfası | satıcı+alıcı VKN, no, tarih, ETTN, oran bazında matrah/KDV, ödenecek | tam (GİB kılavuzu) | 0 |
| 3. Metin katmanı | dijital üretilmiş PDF | ham metin → modele METİN olarak | okuma hatası 0, yapılandırma modelden | ~1/10 görsel |
| 4. Görsel | foto, taranmış PDF (rasterize) | bugünkü yol | modelin gözüne bağlı | ~$0,003/sayfa |

- Basamak 1 için mevcut `parseUblInvoices` (`app/api/import/route.ts`) yeniden
  kullanılır; oradaki "alıcı VKN = firma VKN" denetimi de aynen.
- Basamak 2'de model yalnız KALEMLERİ okur; başlık ve dip toplam karekoddan gelir.
  İkisi tutmazsa "insana sor". **Alan adları kılavuza göre yazılır ama ilk gerçek
  e-Arşiv PDF'inde ÖLÇÜLMEDEN koda girmez** (Faz 0 kalemi).
- Basamak 3'te ayrım tek soru: metin katmanından anlamlı karakter (eşik ölçülecek,
  ~200) çıkıyor mu. Çıkmıyorsa taranmış PDF'tir → basamak 4.
- Basamak 4 = bugünkü `extract.ts` yolu (sharp, 1568 px, JPEG 85).

### 3.2 İki geçişli okuma

**Geçiş A — sınıflandırıcı** (ucuz model, ör. flash-lite; ölçümle seçilecek):
girdi tüm sayfalar; çıktı

```
belgeler[]: { tur: FIS | FATURA | IRSALIYE | DEKONT | CEK | DIGER,
              sayfalar: [1,2], saticiVkn, aliciVkn, saticiUnvan,
              yon: ALIS | SATIS | BELIRSIZ, guven }
```

Tek kare/dosyada birden çok belge (masaya dizilmiş fişler, 12 sayfalık PDF'te 3
fatura) burada ayrılır. `yon` alıcı/satıcı VKN'nin firma VKN'siyle eşleşmesinden
KODDA türetilir, modele bırakılmaz.

**Geçiş B — türe özel çıkarım:** her belge için kendi şeması ve prompt'u. Fiş →
mevcut şema (dokunulmaz). Fatura, irsaliye, dekont → yeni şemalar (§3.7).

Neden iki geçiş, tek birleşik şema değil: birleşik şema fiş prompt'unu da
değiştirir (ölçüm yeniden), prompt şişer, tür karışması artar. İki geçişin bedeli
kare başına +%15–20 maliyet ve +1–2 sn; karşılığı her prompt'un ayrı ölçülebilir
kalması ve yeni türün ötekilere dokunmadan eklenmesi.

Sınıflandırıcı korpusuna BİLEREK girecek zor örnekler: ÖKC "fatura bilgi fişi"
(başlığında FATURA yazan yazarkasa çıktısı), proforma, sipariş teyidi, bize ait
olmayan fatura, satış faturamızın kopyası.

### 3.3 Modül yerleşimi

```
lib/belge-ocr/
  saglayici.ts        OpenRouter çağrısı — extract.ts'ten TAŞINIR, davranış birebir
                      (fiş tezgâhı aynı sayıları vermeli; Faz 0'da ölçülür)
  girdi/
    pdf-metin.ts      metin katmanı var mı / çıkar
    pdf-raster.ts     sayfa → görsel (Vercel'de çalıştığı Faz 0'da ölçülür)
    karekod.ts        1. sayfadan GİB karekodu çöz
    xml-ek.ts         PDF/A-3 eki → parseUblInvoices
  sinif/              geçiş A şeması + prompt
  fatura/             schema.ts · validate.ts · to-invoice.ts
  irsaliye/           schema.ts · validate.ts · to-waybill.ts
  dekont/             (Faz 4)
  eslestir/           cari (VKN), ürün alias, irsaliye↔fatura, dekont↔fatura
  mukerrer.ts         ETTN › VKN+no › tedarikçi+gün+tutar › dosya hash
lib/fis-ocr/          KALIR; extract.ts yalnız saglayici.ts'i çağırır
```

Her `validate.ts` ve `to-*.ts` **saf** (React/Prisma yok): onay kartı istemcide her
düzeltmede yeniden koşturur, sunucu aynı modülle doğrular — fişteki desenin aynısı.

### 3.4 Kuyruk ve gelen kutusu

Uç sınırı 60 sn. Tek fotoğraf / ≤5 sayfa PDF sığar; 12 sayfalık PDF veya "20 belge
birden" sığmaz. Bugünkü "kuyruk yok, akış anında, kaydedilmezse kaybolur" kararı bu
kapsamda tutulamaz.

**Yeni tablo `document_scans`** (RLS açık, policy yok — CLAUDE.md):

```
id · companyId · kaynak (UPLOAD | EMAIL) · dosyaAdi · mime · sayfaSayisi
dosyaSha256          → aynı dosya ikinci kez yüklenince yakalanır (dosya saklanmasa da)
durum                BEKLIYOR | OKUNUYOR | ONAY_BEKLIYOR | KAYDEDILDI | REDDEDILDI | HATA
sinif JSON           geçiş A çıktısı
cikarim JSON         geçiş B çıktısı (belge başına)
denetimler JSON
hedefTur · hedefId   kaydedilen Invoice / Waybill / InvoicePayment / Check
model · maliyetUsd · sureMs
createdBy · createdAt · updatedAt
```

İşleme modeli **ilk aşamada istek içinde**: her yükleme = tek dosya = tek istek,
sonuç satıra yazılır; toplu yükleme istemciden sıra sıra gider. Gerçek arka plan
işçisi (cron/after) ERTELENİR — abonelik cron'u da aynı gerekçeyle ertelenmişti
(2026-08-08); iki ayrı kuyruk altyapısı açmayalım. Sayfa tavanı (ör. 10) aşılırsa uç
"böl" der, sessizce kırpmaz.

Gelen kutusu ekranı = bu tablonun listesi: okunmuş ama onaylanmamış belge kaybolmaz.

### 3.5 Eşleştirme katmanı — asıl kazanç burada

| Ne | Bugün | Plan |
|---|---|---|
| Cari | VKN ile (`suppliers.taxNumber`) — iyi | aynen; yoksa `QuickCariDialog` VKN ön dolu |
| Ürün | ad eşitliği (`trFold` bile değil) — zayıf | **`supplier_product_aliases`**: companyId · supplierId · tedarikçi kodu/adı (trFold) · productId · sonGorulme. İlk faturada kullanıcı eşler, ikincisinden itibaren otomatik. Barkod/GTIN basılıysa o da anahtar. |
| İrsaliye ↔ fatura | editörde elle "İrsaliye Bağla" | faturada okunan "İrsaliye No" → tedarikçinin `stockProcessed && !invoiceId` irsaliyesi → `waybillIds` ile bağlanır → **stok iki kez girmez** (mevcut `skipInvoiceStock`) |
| Dekont ↔ fatura | yok | tutar + cari + ±3 gün → açık faturaya `InvoicePayment` (Faz 4) |
| ETTN ↔ gelen kutusu | yok | `IncomingInvoice.uuid` ile çakışma: aynı e-fatura hem Mysoft'tan hem PDF'ten gelirse iki kez işlenmez |

Ürün araması Türkçe duyarsız kuraldan geçer (`lib/text/tr-fold.ts`, CLAUDE.md).

### 3.6 Mükerrer anahtarı

Sıra: **ETTN** (karekod/XML) › **satıcı VKN + belge no** › tedarikçi + gün + tutar
(fişteki mevcut sezgisel) › **dosya sha256**. Sonuç fişteki gibi ENGEL değil UYARI;
onay kutusuyla aşılır, mükerrer ekranda GÖRÜLMEDEN kutu onu aşamaz.

Yan bulgu: `@@unique([companyId, invoiceNo])` alışta TEDARİKÇİNİN numarasını
tutuyor. e-Arşiv no yapısı 3 harf seri + yıl + 9 hane; seri harfleri firmaya özel
değil → iki tedarikçi aynı numarayı üretebilir. Bugün P2002 → 409 "zaten kayıtlı"
(yanlış mesaj). Tekillik alışta tedarikçi bazlı olmalı mı → §9.

### 3.7 Tür bazlı şema ve denetimler

**Fatura** (`fatura/schema.ts`): saticiUnvan, saticiVkn, aliciVkn, aliciUnvan,
faturaNo, ettn, tarih, vade, senaryo/tip (e-belgeyse), kalemler[{ad, tedarikciKodu,
miktar, birim, birimFiyat (KDV HARİÇ), iskontoTutar, kdvOrani, kdvTutar, satirTutar}],
kdvKirilimi[{oran, matrah, kdv}], genelIskonto, ilaveMasraf (ETV/enerji fonu),
matrahToplam, kdvToplam, odenecek, irsaliyeNoListesi[], odeme?, guven.
Denetimler:
- alıcı VKN = firma VKN (şube ana firmanın VKN'sini devralır — `parentCompany.taxNumber`);
  tutmuyorsa "bu belge bu firmaya kesilmemiş" — ağır
- satıcı VKN/TCKN checksum (mevcut `vknGecerliMi`/`tcknGecerliMi` yeniden kullanılır)
- satır: miktar × birimFiyat − iskonto = satırTutar (±0,05)
- KDV kırılımı: oran başına Σ satır net × oran = kdv(oran)
- dip: `computeInvoiceTotals(kalemler, {globalDiscount, globalCharge})` = odenecek;
  kuruş artığı `payableRoundingAmount`a, ≥0,50 fark → ağır (fişteki kural)
- karekod ↔ model çapraz (varsa): no, tarih, toplam, KDV — tutmazsa ağır
- tarih ≤ yarın; vade ≥ tarih

**İrsaliye** (`irsaliye/schema.ts`): saticiUnvan, saticiVkn, aliciVkn, irsaliyeNo,
duzenlemeTarihi, sevkTarihi, tasiyici, plaka, sofor, sevkAdresi, kalemler[{ad,
tedarikciKodu, miktar, birim}], faturaNoAtfi?, guven.
Denetimler: alıcı VKN biz; tedarikçi ZORUNLU (uç 400 döner — kartta kilit); miktar > 0;
sevk ≥ düzenleme; ürün eşleşmeyen satır → "stoğa girmeyecek" uyarısı (ağır değil).

**Dekont** (Faz 4): banka, tarih, tutar, gönderen/alıcı ad-IBAN, açıklama, referans.
Denetim: alıcı IBAN bizim mi (`Account.iban` varsa), açıklamada fatura no var mı.

Karekodlu belgede başlık alanları karekoddan gelir; modelin okuduğu değer yalnız
karşılaştırmada kullanılır.

### 3.8 Kayıt hedefleri

| Tür | Uç | Gövde özellikleri |
|---|---|---|
| Fatura | `POST /api/e-donusum/invoices` | `type: PURCHASE`, `invoiceType: MANUAL`, `isReceipt: false`, `invoiceNo` belgeden, `dueDate`, kalemler KDV hariç + `discountAmount`, `globalDiscountAmount`, `globalChargeAmount`, `payableRoundingAmount`, `waybillIds` (eşleşen irsaliye), `notes`: ETTN + kaynak. Status DRAFT = ekranda "Kayıtlı". Ödeme fişteki akışla opsiyonel. |
| İrsaliye | `POST /api/irsaliye` | `type: PURCHASE`, `supplierId` zorunlu, `waybillNo` belgeden, `date`, `deliveryDate`, `carrier`, `vehicleNo`, `driverName`, `deliveryAddress`, kalemler `{productId?, description, quantity, unit}` → DRAFT. Kartta "Teslim alındı" anahtarı → `PUT status: DELIVERED` (stok girer, `stockProcessed`). |
| Dekont | `POST /api/faturalar/odemeler` | fatura seçiliyse; faturasız cari ödeme **C1 kararına bağlı** (genel denetim 2026-09). |
| Çek | `POST /api/cek-senet` | `direction: GIVEN/RECEIVED` yönden; uç gövdesi Faz 4'te okunur. |

### 3.9 Ekran

- **URL `/alis/fis-tarama` KALIR**, menü etiketi "Belge Tarama" olur (nav, sayfa
  başlığı, `DENEME_PAGES`). Ayrı sayfa açılmaz: page-access kuralları tek sayfada
  toplu kalır.
- Tek bırakma alanı: görsel + PDF + XML, çoklu dosya. Tür seçici YOK; sınıflandırıcı
  bulur, kart başlığında "Fatura · Tedarikçi X" yazar, kullanıcı türü kartta
  değiştirebilir (yanlış sınıf → o türün şemasıyla yeniden okutulur, sayaç sayar).
- Gelen kutusu listesi (durum, tür, tedarikçi, tutar, tarih); kart açılır.
- `FisOnayKarti` DEĞİŞMEZ. `FaturaOnayKarti`, `IrsaliyeOnayKarti` yeni; ortak
  parçalar (denetim rozetleri, engel/onay kutusu, mükerrer şeridi, tedarikçi seçici)
  bir kabuğa çıkarılırken fiş kartının davranışı korunur (test:
  `lib/write-guard-coverage.test.ts`, `lib/page-access.test.ts`).
- Page-access eklemeleri: `/api/irsaliye` `writePages` += `/alis/fis-tarama`;
  yeni `/api/alis/belge-tarama` prefix'i (`pages`/`writePages` = yalnız bu sayfa);
  Faz 4'te `/api/cek-senet`. `page-access.test.ts`'teki "kaydın gerektirdiği HER uca
  erişebilir" testi her faz için genişletilir.

### 3.10 Uçlar

```
POST   /api/alis/belge-tarama            dosya → sınıf + çıkarım + denetim → document_scans satırı
GET    /api/alis/belge-tarama            gelen kutusu listesi (companyId, durum)
GET    /api/alis/belge-tarama/[id]       tek tarama (kart)
PATCH  /api/alis/belge-tarama/[id]       tür değiştir / reddet / hedefe bağla (kaydeden uç değil)
GET    /api/alis/fis-tarama              mükerrer denetimi — KALIR, anahtar sırası §3.6'ya göre genişler
POST   /api/alis/fis-tarama              Faz 3 sonunda /belge-tarama'ya yönlenir (ölçüm eşitliği sonrası)
```

Yazma yetkisi: POST para harcar → `ensureCompanyWrite` + beyaz liste + sayaç
(fişteki üçlü). Girdi türleri: mevcut görsel listesi + `application/pdf` +
`text/xml`/`application/xml`. Boyut: 15 MB kalır; sayfa tavanı ayrı.

### 3.11 Maliyet ve sayaç

Birim "tarama" değil **sayfa**: `usage_limits` anahtarı `belge_tarama_sayfa_monthly`
(fişin `fis_tarama_monthly` sayacı Faz 3'te buna katlanır; tavan yeniden
belirlenir). Metin katmanlı PDF neredeyse bedava, görsel sayfa ~$0,003, sınıflandırıcı
~1/5. Sayaç yine modelden ÖNCE artar (fişteki gerekçe).

### 3.12 Ölçüm tezgâhı

`scripts/ai-belge-test.mjs --tur sinif|fatura|irsaliye|dekont --dir ./<tur>-ornekleri`
— fiş tezgâhının deseni: `.dogru.json` ile alan alan doğruluk, gerçek maliyet,
süre. Metin-PDF için ayrı yol (görsel değil metin gönderir). Şema/prompt ikizi kuralı
burada da geçerli: `lib/belge-ocr/<tur>/schema.ts` ↔ tezgâh.

**Korpus kullanıcıdan gelir** (üretilen örnek = uydurma ölçüm):
- fatura ≥10: kâğıt + e-Arşiv PDF karışık, ≥3 çok oranlı, ≥2 iskontolu, 1 elektrik/telekom, 1 çok sayfalı
- irsaliye ≥5, dekont ≥5
- sınıf korpusu: yukarıdakiler + fişler + ≥3 "bize ait olmayan" + 1 ÖKC fatura bilgi fişi + 1 proforma

Kabul eşiği (öneri): sınıf %100; karekodlu belgede başlık %100; kalemler ≥%95;
kâğıt faturada kritik alanlar (VKN, no, tarih, ödenecek) %100.

---

## 4. Veri modeli değişiklikleri

| Tablo / alan | Faz | Not |
|---|---|---|
| `document_scans` (yeni) | 0 | §3.4; `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`; `npm run check:rls` |
| `supplier_product_aliases` (yeni) | 1 | §3.5; RLS; `@@unique([companyId, supplierId, anahtar])` |
| `Invoice.sourceScanId?` / `Waybill.sourceScanId?` | 1–2 | kayıt → tarama izi. Fişte "iz kalmıyor" bilinçli tercihti (fotoğraf da yok); dosya saklanırsa iz anlamlı → §9 |
| `Invoice` gelir vergisi stopajı alanları | 5 | e-SMM için; ayrı tasarım |

Migrasyon canlıya `scripts/apply-migration.js` ile, komutu kullanıcı çalıştırır
(hafıza: migrasyon uygulama yolu).

---

## 5. Fazlar

### Faz 0 — Zemin (kod yazmadan önce ölçülecekler dahil)
- [x] `saglayici.ts`: OpenRouter çağrısını `extract.ts`ten taşı; fiş tezgâhı aynı sayıları veriyor mu (ölçüm eşitliği)
- [x] PDF metin katmanı çıkarma — kütüphane seçimi, Vercel'de çalışma ölçümü → `unpdf` (saf JS); yerelde ölçüldü, **Vercel ölçümü dağıtımdan sonra** `GET /api/alis/belge-tarama/saglik` (süper admin)
- [x] PDF raster — `pdfjs-dist` legacy + `@napi-rs/canvas` (platform ikilisi, sharp gibi); yerelde ölçüldü, **Vercel ölçümü saglik ucuyla**. Yedek yol (OpenRouter `file` + `engine: native`) yazılmadı; raster düşerse uç açık hata verir
- [x] Karekod çözümü (jsQR: gömülü görsel › raster); alan adları kılavuzdan yazıldı, **gerçek e-Arşiv PDF'inde HENÜZ doğrulanmadı** (korpus yok) — tanınmayan anahtarlar `diger`e düşer, düzeltme tek yerde (`girdi/karekod.ts` + test)
- [x] PDF/A-3 XML eki okuma (pdfjs `getAttachmentContent`); `parseUblInvoices` BİLEREK kullanılmadı, ayrı UBL-TR okuyucu `lib/belge-ocr/ubl.ts` (ETTN, satır iskontosu, irsaliye atfı, tevkifat)
- [x] Sınıflandırıcı şema + prompt; **korpus ölçümü yapılmadı** (örnek yok), model = fişin ölçülmüş modeli (`BELGE_SINIF_MODEL` env ile değişir)
- [x] `document_scans` migrasyonu + RLS
- [x] Tezgâh `scripts/ai-belge-test.ts` (tsx; şema ikizi YOK, uygulama modüllerini import eder) — `--tur fis` 3 örnekte %100 (taşıma sonrası eşitlik ölçüldü)

### Faz 1 — Alış faturası (kâğıt + e-Arşiv PDF)
- [x] `fatura/schema.ts` + prompt; **korpus ölçümü bekliyor**
- [x] `fatura/validate.ts` (§3.7) — birim test YOK (UBL/karekod/pdf/normalize testli)
- [x] `fatura/to-invoice.ts` (`computeInvoiceTotals`, `payableRoundingAmount`) — birim test YOK
- [x] Karekod/XML başlık önceliği; model yalnız kalem
- [x] `cari_product_aliases` (tedarikçi VE müşteri) + eşleştirme + öğrenme (kartta yapılan eşleme kayıtta yazılır)
- [x] İrsaliye no → `waybillIds` bağlama
- [x] Mükerrer: ETTN, VKN+no, `IncomingInvoice.uuid` çakışması, sha256
- [x] `POST/GET /api/alis/belge-tarama`, `[id]`
- [x] `FaturaOnayKarti` + ortak kabuk (fiş kartı davranışı korunarak)
- [x] Page-access + testler
- [x] Alıcı VKN ≠ firma → kart "başka firmaya kesilmiş olabilir" der; **doğru firmayı ÖNERMEZ** (istemcide firma VKN listesi yok)

### Faz 2 — Alış irsaliyesi
- [x] `irsaliye/schema.ts` + prompt; **korpus ölçümü bekliyor**
- [x] `irsaliye/validate.ts`, `to-waybill.ts` — birim test YOK
- [x] `IrsaliyeOnayKarti`; tedarikçi zorunlu kilidi; "Teslim alındı" anahtarı → PUT DELIVERED
- [x] Ürün eşleşmesi: alias + `trFold`; eşleşmeyen satır uyarısı
- [x] Page-access: `/api/irsaliye` write += `/alis/fis-tarama`

### Faz 3 — Gelen kutusu ve fiş yolunun taşınması
- [x] Gelen kutusu listesi + çoklu yükleme (sıra sıra istek)
- [x] Menü etiketi "Belge Tarama", sayfa başlığı, `DENEME_PAGES`
- [x] Fiş yolu boru hattında (sınıf FIS → `fisTaraHazir`); üç örnekte alanlar birebir (VKN, tarih, toplam, KDV, kalem). Eski `POST /api/alis/fis-tarama` duruyor, ekran çağırmıyor
- [x] Sayaç: ekran `belge_tarama_sayfa_monthly` (sayfa); `fis_tarama_monthly` yalnız eski POST'ta. Tavan `ensureUsageLimit` varsayılanı (1000/ay), firmaya göre elle
- [x] `docs/fis-tarama/KAYIT-AKISI.md` güncelle (kuyruk kararı değişti)

### Faz 4 — Dekont → ödeme, çek
- [ ] C1 kararı (faturasız cari tahsilat) — bu faz ona bağlı
- [x] `dekont/` şema, denetim (IBAN mod-97, bizim hesap), açık fatura eşleştirme (en eskiden dağıtım); faturasız tahsilat YOK (C1 açık)
- [x] Çek/senet → `/api/cek-senet` (CHECK/PROMISSORY_NOTE, direction keşideci/lehtar'dan)

### Faz 5 — Sonrası (her biri ayrı karar)
- [ ] e-SMM: gelir vergisi stopajı modeli
- [ ] E-posta ile iletme (`belgeler-<slug>@…`) — e-posta sağlayıcısı kararı
- [ ] Dosya saklama — depolama kararı; `Attachment` modeli/`/api/attachments` bugün
  yalnız satır yazıyor (dosya yüklemiyor, taslak); gerçek soyutlama `object-store.ts`
- [ ] Asistan bağı: "N belge onay bekliyor", tedarikçi fiyat sapması uyarısı
- [x] Satış tarafı — karar F ile kapsama girdi; fatura/irsaliye/çek kartlarında yön seçici (SATIS → müşteri + SALES/GIVEN hedefi)

---

## 6. Riskler ve erken ölçülecekler

- **Vercel'de PDF raster.** Yerel ikili isteyen kütüphaneler paketi patlatabilir
  (sharp'ın `models.ts` ayrımı aynı sebeple var). Faz 0'da ölçülmeden Faz 1'e geçilmez.
- **Karekod alanları.** Kılavuzdan yazılan ad gerçek PDF'te farklı çıkabilir; ölçüm şart.
- **Tür karışması.** Fiş ↔ fatura (ÖKC fatura bilgi fişi), proforma ↔ fatura. Korpus.
- **Çok sayfalı belgede kalem sürekliliği.** Görsel yolda sayfa sınırı kalemi böler;
  metin yolu bunu yaşamaz — dijital PDF'te metin yolunu tercih etmenin bir sebebi daha.
- **Fatura no tekilliği** (§3.6) — mesaj yanlış, karar bekliyor.
- **Maliyet kaçağı.** Sayfa sayacı ve sayfa tavanı olmadan 100 sayfalık PDF tek
  taramada tavanı aşar.
- **Fiş regresyonu.** Taşıma sırasında tek koruma tezgâh ölçümü; korpus yerinde
  (`fis-ornekleri/`) olmalı.

---

## 7. Hukuki / iş notları

- Kâğıt belgenin **aslı** saklanmak zorunda (VUK); tarama kopyadır — veri giriş
  yardımcısı, arşiv değil. e-Arşiv PDF'in kendisi belgedir; saklanması değer taşır.
- e-Fatura mükellefi bir firmaya tedarikçi e-Arşiv KESEMEZ (e-Fatura keser, kutuya
  düşer). e-Arşiv PDF akışının asıl müşterisi e-Fatura'ya geçmemiş küçük firma ve
  herkes için elektrik/telekom gibi kurumsal faturalar.
- Mysoft portalına yönlendirme yok ilkesi burada da geçerli; belge kutusu Mysoft'u
  kullanıcıdan saklar.

---

## 8. Bu plan neyi VARSAYIYOR

Aşağıdaki kararlar verilmeden plan bu varsayımlarla yazıldı; karar değişirse ilgili
bölüm güncellenir.

| # | Karar | Seçenekler | Plan varsayımı |
|---|---|---|---|
| 1 | Tür tespiti | kullanıcı seçer / model tespit eder | **model tespit eder**, kullanıcı kartta düzeltir (§3.2) |
| 2 | Kapsam | alış / + satış | ~~yalnız alış~~ → **alış + satış** (karar F, 2026-09-21) |
| 3 | PDF girişi | yalnız foto / + PDF + XML | **PDF + XML dahil** (§3.1) |
| 4 | Ekran | aynı sayfa / ayrı sayfalar | **aynı sayfa**, etiket "Belge Tarama" (§3.9) |
| 5 | Kuyruk | yok / tablo + istek içi / gerçek işçi | **tablo + istek içi** (§3.4) |
| 6 | Beyaz liste / sayaç | aynı / ayrı | **aynı liste**, sayaç sayfa bazlı (§3.11) |

---

## 9. Kararlar — 2026-09-21'de verildi

| # | Soru | Karar | Sonuç |
|---|---|---|---|
| A | PDF'ler yalnız yükleme ile mi, e-posta iletme de mi? | **yalnız yükleme** | e-posta Faz 5, sağlayıcı o zaman sorulur |
| B | Dosya saklanacak mı? Hangi depolama? | **şimdilik yok** | mükerrer `dosyaSha256` ile; saklama Faz 5'te sağlayıcıyla birlikte |
| C | Alış faturası no tekilliği tedarikçi bazlı mı? | **evet** | `@@unique([companyId, supplierId, invoiceNo])` — Faz 1'de ayrı migrasyon; aynı sorun `Waybill @@unique([companyId, waybillNo])`ta da var, Faz 2'de aynı çözüm |
| D | e-SMM stopajı modellenecek mi? | **sonra** | Faz 5, ayrı tasarım (kullanıcı: "sonra bakarız") |
| E | Deneme mi ürün mü? | **deneme** | beyaz liste + sayfa sayacı; ürünleşme fişle birlikte |
| F | Satış tarafı? | **EVET — "kâğıt ne varsa, çek/senet dahil"** | §1.1 (c), §3.8 satış hedefleri; her tür iki yönlü |
| G | Kayıt → tarama izi (`sourceScanId`)? | **B ile birlikte: yok** | `document_scans.hedefId` tek yönlü iz olarak yeter |
| — | Korpus | **şimdilik yok, korpussuz başla** | Faz 0 kütüphane/Vercel ölçümleri korpussuz; şema/prompt ölçümü örnek gelince. Karekod/XML ölçümü için Mysoft test ortamından taslak PDF ya da gelen kutusu PDF'i kullanılabilir (gerçek düzen) |

## 10. İlerleme Günlüğü

- **2026-09-19** — Kapsam analizi ve plan yazıldı. Kod yok. Mevcut fiş taraması
  (`lib/fis-ocr`, `docs/fis-tarama/KAYIT-AKISI.md`) referans alındı. Yan bulgular:
  `/api/attachments` POST dosya yüklemiyor (satır yazıyor); alış fatura no tekilliği
  tedarikçiler arası çakışabilir (§3.6). Açık kararlar §9'da bekliyor.
- **2026-09-21** — §9 kararları alındı (A yükleme, B saklama yok, C tedarikçi
  bazlı no, D sonra, E deneme, F **satış dahil**, G yok, korpus yok). Faz 0 başladı.
- **2026-09-21 (devam)** — Faz 0–4 kodu yazıldı, `next build` temiz, testler
  geçiyor. Kütüphane: `unpdf` + `jsqr` (saf JS), raster için `pdfjs-dist`
  legacy + `@napi-rs/canvas`. Üç migrasyon canlıya UYGULANMADI (kullanıcı
  çalıştırır): `20260921000001_document_scans`, `20260921000002_cari_product_aliases`,
  `20260921000003_purchase_doc_no_per_counterparty` (fatura + irsaliye no
  tedarikçi bazında tekil, kısmi indeksler). Açık ölçümler: Vercel'de raster
  (`/api/alis/belge-tarama/saglik`), gerçek e-Arşiv PDF'inde karekod alan adları,
  sınıflandırıcı/fatura/irsaliye/dekont/çek prompt'ları GERÇEK korpusta —
  bugüne kadar yalnız 3 fiş fotoğrafı ve iki üretilmiş PDF ile koştu.
  Bilerek yapılmayan: fatura/irsaliye validate ve to-* birim testleri; satış
  tarafı için "yön" seçimi kartta (aynı şema, farklı hedef).
- **2026-09-21 (akşam)** — Migrasyonlar canlıya uygulandı (doğrulandı: RLS açık,
  kısmi tekil indeksler yerinde). Chrome'dan Reypo Medya Ajansı (demo, beyaz
  liste) ile uçtan uca test: sistem kontrolü 5/5 ✓ (yerel); fiş fotoğrafı →
  fiş kartı %100; üretilmiş e-Arşiv PDF (karekod + metin katmanı, 3 kalem, genel
  iskonto) → fatura kartı tüm denetimler ✓, VKN'den tedarikçi hızlı kart, 2/3
  kalem ürünle eşleşti, kayıt: fatura 461,17 + stok girişi + 2 alias öğrenildi +
  satır SAVED; irsaliye fotoğrafı → kart ✓, alias'tan "öğrenilmiş" eşleşme,
  kayıt + DELIVERED; dekont PDF → IBAN mod-97 sahte IBAN'ı yakaladı, ünvan
  benzerliğinden müşteri, 28 açık faturaya dağıtım yazıldı; çek fotoğrafı →
  portföye alındı. Test sırasında düzeltilen üç hata: (1) `[yon]` effect'i
  mount'ta cari eşleşmesini siliyordu → yön değiştirme olayına taşındı;
  (2) çek "Taraf" denetimi lehtar VKN basılmamışken patlıyordu; (3) VKN'siz
  belgede (dekont/çek) cari önerisi yoktu → ünvan benzerliği eklendi. Ayrıca
  kayıt sonrası gelen kutusu tazeleme ve dekontta "n/N yazıldı" ilerlemesi.
  Sağlık ucu beyaz listeye bağlandı (süper admin şart değil). Gerçek belgeyle
  hâlâ koşmadı; Vercel ölçümü bekliyor.
