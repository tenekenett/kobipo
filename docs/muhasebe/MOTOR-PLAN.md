# Muhasebe motoru — plan (2026-10-02)

Hedef (karar 2026-09-30): genel muhasebeyi (tam defter) Kobipo'ya çekmek. Düzen
Aposkal'ınki: **belge → kendiliğinden taslak yevmiye fişi → kullanıcı eksik hesabı
seçer → onay**. Hesap seçimi ÖĞRENİLİR (satışta ürüne, alışta cari + KDV oranına göre),
"emin" fişler toplu onaylanır. İnceleme ve karşılaştırma: Claude Docs (bkz.
`docs/finansal-raporlar/MUHASEBE-DEVAM.md`).

## Kararlar (2026-10-02, kullanıcı)

| Konu | Karar |
|---|---|
| Konum | **Ayrı modül: Muhasebe.** Kendi menü grubu ve modül anahtarı; abonelikte ayrı açılır, fiyatı sonra belirlenir. |
| Cari alt hesap no | **Sıralı:** `120.01.0001`, `320.01.0001`. Cari adı ve VKN hesap adında durur. |
| Geçmiş belgeler | **Seçilen başlangıç tarihinden:** sonrası toplu taslak fiş, öncesi açılış fişiyle girer. |
| Şube (2026-10-04) | **Modül yalnız tüzel kişide (ana firma / ek firma) alınır.** Şubeye açılmaz (`ModuleDef.notForBranches`): satın alma ucu 400, katalogda gizli, sistem-admin kartında kilitli, `resolveOpenModules({ isBranch })` hiçbir kanaldan açmaz, ücretsiz yapılamaz. Şubenin belgeleri ana firmanın defterine fiş üretir (`sourceCompanyId`). |
| Kapsam (2026-10-04) | 2 + 3 + 4. faz yapıldı. Luca/Zirve aktarımı (müşavirden örnek dosya ister) ve e-Defter kapsam dışı. |

## Durum (2026-10-04)

**2–4. faz yapıldı** (aşağıdaki bölümlerin hepsi koda girdi). Migrasyon
`20261004000001_muhasebe_2faz.sql` — deploy'dan ÖNCE ve HEMEN SONRA birer kez
uygulanır (yeni modül anahtarı `disabledModules` red listesine yazılıyor; eski kod
`applyEntitlements` çalıştırırsa anahtar düşer). Fiyat kalemi `module:accounting`
PASİF doğar; sistem yöneticisi fiyatı girip açar, o zamana kadar firmaya sistem-admin
kartından bedelsiz verilir.

| Parça | Dosya |
|---|---|
| Ortak fiş dili, `fisKur` (denge garantisi), İstanbul/UTC günü | `lib/muhasebe/fis.ts` |
| Belge kuralları (+ karşı yönlü cari, kuruş farkı gelir/gider satırına) | `fis-kurallari.ts` |
| Para hareketi, kasasız ödeme, çek/senet/ciro, virman, bordro, kart açılışları | `para-kurallari.ts` |
| Kaynak yükleyiciler (11 tür) + hesaplar arası virman eşleştirmesi | `kaynaklar.server.ts` |
| Senkron (aç / yenile / sil / "belge değişti"), fiş numarası | `senkron.server.ts` |
| Hesap çözümü (USER → alt hesap → öğrenilmiş → varsayılan → yok), parmak izi | `hesap-cozumu.ts` |
| Plan kurulumu, alt hesap açma (120.01.0001 …) | `hesap-plani.ts`, `hesap-plani.server.ts` |
| Açılış fişi (başlangıçtaki bakiyeler, fark satırı) | `acilis.ts`, `acilis.server.ts` |
| Onay, toplu onay, geri al, yeniden üret, öğrenme ve yayılım | `onay.server.ts` |
| Elle fiş, açılış farkını dağıtma | `manuel.server.ts` |
| Mizan, yevmiye (madde no), kebir | `mizan.ts`, `defter-sorgu.server.ts` |
| Bilanço / gelir tablosu (mizandan) | `mali-tablolar.ts` |
| Dönem kapanışı ve kilidi | `kapanis.ts`, `kapanis.server.ts` |
| Uçlar | `app/api/muhasebe/*` |
| Ekranlar | `app/(dashboard)/muhasebe/*`, `components/muhasebe/*` |

Ölçüm: birim testleri `npx vitest run lib/muhasebe`; canlı (salt okur, ~3 dk)
`npm run test:canli -- lib/muhasebe/defter-tutarlilik` — bütün defterlerin kaynaklarından
fişleri bellekte kurar: her fiş dengeli, cari alt hesabı = cari bakiyesi, kasa alt
hesabı = kasa bakiyesi (2026-10-04: 35 defter, 1.091 fiş, 155 cari, 37 kasa — geçti);
uçtan uca `node scripts/test-muhasebe.mjs` (dev sunucu açık, Reypo Medya; açtığını siler).

Canlı ölçümün bulduğu ve düzeltilen üç sapma: (1) müşteriye kesilen alış / tedarikçiye
kesilen satış (karşı yönlü belge) perakende hesabına gidiyordu — cari bakiyesi belgeyi
dolu olan cariye yazıyor; (2) cari satırı satır toplamından kuruluyordu, belge
toplamından 1–3 kuruş sapıyordu; (3) bir kasa hareketi başka firmanın kasasına yazılmış
(veri tutarsızlığı, tek kayıt: Demo Firma'nın 720 TL'lik tahsilatı Reypo Medya'nın "ana"
kasasında) — fiş kasa satırını hesapsız bırakıp "Gözden geçir"e düşürür.

### ▶ DEVAM — 2026-10-09 gece geliştirme turu (EN GÜNCEL)

Kullanıcı: "bakılmayanları tekrar kontrol edelim, geliştirilecek başka bir şey varsa geliştirelim".

**Bakılmayanlar bakıldı:** finans "Yeni İşlem" formu (masaüstü + 390 px; İşlem türü gelir/gider
listeleri, dövizli hesapta kur alanı TCMB önerisiyle) ve dövizli faturanın ödeme penceresi (390 px,
kur alanı + "kasaya X TL yazılır" notu). Taşan öğe yok. Ölçüm için geçici "TEST USD Ekran" hesabı +
USD fatura açıldı ve silindi. (Önceki turda "tarayıcı donuyor" sanılan şey ekran görüntüsü aracıydı;
sayfa yanıt veriyordu — tıklama sayfa içinden yapılınca çalıştı.)

**Bulunan ve düzeltilen:**
1. **Fatura ödemesi dövizli hesaba yazılabiliyordu** — dövizli hesap kontrolü yalnız DÖVİZLİ faturadaydı;
   TL fatura USD hesaptan ödenince TL tutar o hesaba dolar diye ekleniyordu. Ayrıca "hesap seçilmezse
   varsayılan Kasa" en eski CASH'i alıyordu (döviz kasası olabilir), satış ekranlarının varsayılan
   kanalları da. Artık: `createInvoicePayment` her faturada TL hesap ister; `ensureDefaultCashAccount`
   ve `defaultPaymentAccounts` döviz hesabını seçmez (testli); ödeme ekranı listede yalnız TL hesap
   gösterir; tutar boşken "0,00 TL yazılır" notu çıkmaz. Canlıda zarar yok (dövizli hesap 0).
2. **Ay sonu stok değeri kayıt anıyla ölçülüyordu** — defter 153'ü fatura tarihine yazarken stok
   `createdAt` ile ölçülünce geç girilen alış maliyeti başka aya kaydırıyordu. EREN FORKLİFT (gerçek):
   Nisan'dan beri alış stok hareketlerinin %47'si (1,82 M TL) fatura tarihinden başka aya düşüyor,
   49 güne kadar gecikme. Artık `lib/stock/cost.ts` → `hareketBelgeTarihi`/`hareketBelgeJoin`: faturaya
   bağlı hareket fatura günü, irsaliyeye bağlı (`waybill:<id>`) irsaliye günü, referanssız kayıt anı.
   `stokDegeri` ve tarih sınırlı AVCO (`resolveUnitCostsAsOf` — yalnız muhasebe kullanıyor) bu tarihle
   sorar. İptalin ters hareketi aynı referansla aynı güne düşer (iptal edilen fatura hiçbir ayda stok
   bırakmaz). Reypo Temmuz maliyeti 114.980 → 239.274 TL.

**Geliştirilen:**
3. **Muhasebe dışa aktarımları** — Mizan (düzey + taslak süzgeciyle), Yevmiye, Kebir, Bilanço + Gelir
   Tablosu ekranlarında Excel/PDF/CSV (`lib/export/datasets/muhasebe.ts`; `muhasebe-mizan`,
   `-yevmiye`, `-kebir`, `-mali-tablolar`). Ekran uçlarıyla aynı sorgular; mali tablolar için iki
   mizan `maliTabloMizanlari`ye çıkarıldı (uç da onu kullanıyor). Kapı: modül kuralı zaten vardı,
   sayfa kuralı eklendi (`MUHASEBE_PAGES`); dışa aktarım ucu artık veri kümesinin 4xx'ini (kurulum
   yok, hesap yok, bozuk tarih) 500 yerine kendi koduyla döner. Taslak dahil dosya filtre satırında
   "ÖN İZLEME — resmî değil" yazar. Müşavirin ilk istediği dosyalar bunlar; Luca/Zirve aktarımı ayrı iş.
4. **Kapanış ön izlemesi uyarıları** (`kapanis.ts` → `kapanisAySonuUyarilari`, testli): yılın aylık
   maliyeti yazılmamış/güncel olmayan ayları (kapanış sayımla 153'ü kapatıp o ayların faturasız
   girişini de maliyete katardı) ve 397'de bekleyen faturasız giriş bakiyesi (kapanış aktarmaz,
   müşavir kararı). Engel değil, uyarı.

**Doğrulama:** `tsc` temiz, `npx vitest run lib` 2031 test; uçtan uca 133/133 (yeni: 0'da kapalı modülde
dışa aktarım 403, 7e dışa aktarım — CSV toplamları ekranla kuruşu kuruşuna, kebirde hesapsız 400,
Excel/PDF iner; 10'da kapanış uyarısı). Masaüstünde mizan "Dışa Aktar" düğmesi görüldü.
Canlı `cari/bakiye-tutarlilik` bu turun değişikliklerinden sonra geçti. **Canlı `muhasebe/defter-tutarlilik`
bu turun sonunda SONUÇLANMADI:** iki koşu 10 dk süre sınırına takıldı (doğrulama hatası değil —
veritabanı turu ~750 ms'ye çıkmıştı, test defter başına ~20 ardışık sorgu atıyor; bu turun kodu o
testin yoluna dokunmuyor: stok değeri/ödeme/dışa aktarım onun kaynaklarında yok). Sınır 20 dk'ya
çıkarıldı (`defter-tutarlilik.canli.test.ts`); üçüncü koşu sürerken oturum kapandı.

**▶ YENİ BİLGİSAYARDA İLK ADIMLAR (bu tur için)**
1. `git pull` → `npx prisma generate` (şema değişmedi ama önceki turdan AccountingEntry kalkmıştı).
2. `npx tsc --noEmit` ve `npx vitest run lib` (2031 test bekleniyor).
3. Canlı, salt okur: `npm run test:canli -- lib/muhasebe/defter-tutarlilik` (en fazla 20 dk; sonucu
   bu turda alınamadı). İsterseniz uçtan uca: `npm run dev` + `TEST_BASE_URL=http://localhost:3000
   node scripts/test-muhasebe.mjs` (Reypo; 133 kontrol; 12–20 dk).
4. Gözle (isteğe bağlı): Ay Sonu → satılan malın maliyeti ekranında "Faturasız stok girişi" kutusu ve
   ürün listesi (Reypo Temmuz'da görünür; ekranı görmek için betiği `MUHASEBE_BIRAK=1` ile koşup sonra
   `MUHASEBE_SIFIRLA=1` ile temizleyin), Yevmiye/Kebir/Bilanço ekranlarındaki "Dışa Aktar".

**▶ SIRADAKİ:** deploy → hemen ardından `20261009000002` (eski `accounting_entries`) → kullanıcı planı:
başka bir firmanın projesiyle kıyas → müşavire çıkış (C: Luca/Zirve ya da e-Defter; Luca/Zirve için
müşavirden örnek dosya gerekir). Açık kalan küçük konular yukarıdaki "Bilinen sınırlar"da.

**Bilinen sınırlar (yeni):** bordrodan düşülen avans kayıtlı avanstan fazlaysa 196 ters bakiye verir
(Reypo test verisinde −21.121; canlıda bordro avans kesintisi yalnız iki Reypo firmasında). İrsaliyeye
bağlı stok (canlıda 5 hareket) irsaliye günüyle, faturası 153'e fatura günüyle girer — ikisi farklı
aydaysa maliyet o iki ay arasında kayar.

### ▶ DEVAM — 2026-10-09 akşam doğrulama turu

Aşağıdaki "eksik turu"nun YENİ BİLGİSAYARDA İLK ADIMLAR ve YAPILACAKLAR 1–3 maddeleri yapıldı.

**Doğrulama:** `prisma generate` (AccountingEntry kalktı), `tsc` temiz, `npx vitest run lib` 2028 test;
canlı `defter-tutarlilik` ve `cari/bakiye-tutarlilik` geçti; uçtan uca `scripts/test-muhasebe.mjs`
**125/125** (önce 107/107; eklenenler: 7b özet denklemi, 7d faturasız giriş, 8f dövizli fatura ödemesi —
kasaya TL, kur farkı caride, silince kasa geri döner; 8g gece mutabakatı — anahtarsız 401, bildirmeyen
hareketin fişini açar/kaldırır). Ekranlar masaüstü + 390 px (iframe yöntemi) temiz: özet, ay sonu iki
sekme, demirbaşlar + ekleme penceresi, mali tablolar `?taslak=1`, personel kartı → Avanslar + pencere.
**Bakılmadı:** finans "Yeni İşlem" formu (tarayıcı ekran görüntüsünde takıldı; uç 8c'de sınandı),
dövizli hesapta kur alanının mobil görünümü.

**Bulunan ve düzeltilenler:**
1. **Faturasız stok girişi maliyetten düşülüyordu → hayali kâr** (kullanıcı kararı: ayrı satır). Reypo
   Temmuz maliyeti −2,5 milyon çıkıyordu: keçeye 181 adetlik fiyatsız elle düzeltme. Gerçek müşteri
   HİDROEREN stoğunu 505 elle hareketle kurmuş (Eylül: 333 ürün, ~748 bin TL faturasız giriş). Artık
   `faturasizGirisler` (stok-maliyeti.server.ts) ayın referanssız `IN`/`ADJUSTMENT` hareketlerini ürün
   başına NET alıp artısını ay sonu AVCO ile değerler; fişte B 153 · A 397 (rol `SMM_FAZLA`, öğrenme
   anahtarı `smm:fazla`), maliyet = 153 + faturasız giriş − stok değeri. Net almak şart: düzeltmeler
   yanlış yazılıp geri alınıyor (+123.456.786 / −123.456.787) — yalnız artılar toplanınca Reypo
   Temmuz'u 449 milyar çıktı. Alt sınır `max(ay başı, defter başlangıcı)` (açılış stoğuyla çift
   sayılmasın). Ekran girişi ürünleriyle anlatır. Reypo Temmuz maliyeti artık +114.980 TL.
2. **Özet "Giderler" eksiye düşüyordu:** `net satış − net kâr` diye türetiliyordu; satış dışı gelir
   (649) varken gider −1,88 milyon göründü. Artık `digerGelirler` (F + I) ayrı; kâr kutusu söyler.
3. Ufak: `lib/cari/invoice-direction.ts`'te import bir fonksiyonun açıklamasıyla arasına girmişti.

**Canlı veri (kullanıcı onayıyla, uygulamanın uçlarıyla):** D3 — Demo Firma'nın 720 TL tahsilatı
(hareket + ödeme) Demo Firma Kasa'sına taşındı (Reypo "ana" −720, Demo Kasa +720). Reypo test
artıkları silindi: 9 anlamsız çek (12,3 milyar "asdas" dahil; tahsilleri geri sarıldı) ve açıklamasız
2.000.000 TL gelir. Kalan tek çek gerçekçi (İş Bankası 0004567891, 12.500 TL). Reypo muhasebe kapalı,
fiş yok.

**Bilinen sınır (yeni):** yıl sonu kapanışı sayım tutarıyla çalışır (aralıklı envanter); Aralık'ın
aylık maliyeti yazılmadan kapanış yapılırsa Aralık'ın faturasız girişi maliyete karışır — önce Ay
Sonu'nda Aralık yazılmalı (kapanış bunu zorunlu tutmuyor). 397 geçici hesaptır; yıl sonunda nereye
aktarılacağı müşavirin kararı (geç girilmiş açılış stoğu → sermaye/geçmiş yıl; sayım fazlası → 679).

**Sıradaki:** deploy → hemen ardından `20261009000002` (eski `accounting_entries`); sonra kullanıcı
planı: başka bir firmanın projesiyle kıyas → müşavire çıkış (C).

### ▶ DEVAM — 2026-10-09 eksik turu (main'e gönderildi; ilk adımlar ve 1–3 yukarıda yapıldı)

Kullanıcı (muhasebeci değil) ekranları "karışık", cetvelleri "sağlıklı çalışmıyor" buldu. Ölçüm
(Reypo): 353 fişin hiçbiri onaylı değildi → mali tablolar sıfır; taslak dahil mizanda 56 hesapsız
satır (46'sı gider — E2E'nin BIRAK koşularından kalan 770.01/02/03 "TEST" alt hesapları 770'i alt
hesaplı yapmıştı); Reypo'da 12,3 milyar TL'lik "asdas" çeki gibi anlamsız test verisi. Kodda hesap
hatası yok (bilanço farkı = hesapsız satır toplamı). Eksik listesi A/B/C/D; kullanıcı planı: **A + B + D
sırayla → başka bir firmanın projesiyle kıyas → EN SON müşavire çıkış (C: Luca/Zirve ya da e-Defter)**.

| # | Eksik | Durum |
|---|---|---|
| A1 | Muhasebe Özeti — yapılacaklar + bu yılın rakamları + sözlük | **yazıldı** `/muhasebe/ozet`, `lib/muhasebe/ozet.ts` (saf) + `ozet.server.ts` |
| A2 | Mali tablolar boş/denk değil/brüt kâr şişkin görünürken nedenini söylemiyor | **yazıldı** `?taslak=1` ön izleme, `tabloNotlari` (farkHesapsizdan, dengeHatasi, smmEksik) |
| A3 | İki bilanço (Raporlar ↔ Muhasebe) | **yazıldı** Raporlar bilanço ve kâr/zararda "yönetim raporu" notu |
| A4 | Terimler açıklamasız | **yazıldı** `components/muhasebe/ekran-aciklamasi.tsx` (her ekranda kapanabilir kutu + `MUHASEBE_SOZLUGU`) |
| B1 | Vergi/SGK ödemesi 770'e düşüyor (gider çift, 360/361 kapanmıyor) | **yazıldı** `Transaction.purpose` (KDV, TAX, SGK, ADVANCE, LOAN, PARTNER) — `lib/finans/hareket-turu.ts`; finans formunda "İşlem türü" |
| B2 | Personel avansı kaydı yok (196 eksi) | **yazıldı** personel kartı → Avanslar (`lib/personel/avans*.ts`, `/api/personel/avans`), bordro formunda açık avans önerisi, açılışta 196 |
| B3 | Aylık KDV mahsubu elle | **yazıldı, E2E'de gerçek mahsup yazıldı** — `/muhasebe/ay-sonu?sekme=kdv`, `lib/muhasebe/kdv-mahsup*.ts` (onaylı fiş, sırayla, yalnız son ay geri alınır, vergi raporuyla karşılaştırma) |
| B4 | Satılan malın maliyeti yalnız yıl sonu | **yazıldı** — `/muhasebe/ay-sonu` (varsayılan sekme), `lib/muhasebe/stok-maliyeti*.ts`: ay sonu stok değeri (miktar × `resolveUnitCostsAsOf`, AVCO tarih sınırlı) ile 153 farkı → B 621 · A 153 (eksi olabilir: iade, sayım fazlası). Başlangıçtaki stok açılış fişine 153 olarak girer; kapanış ekranı Kobipo'nun 31 Aralık stok değerini önerir. Stok hareketi yoksa "gerekmez" (yıl sonu sayım) |
| B5 | Kredi / ortak / demirbaş-amortisman | **yazıldı** kredi 300, ortak 331/131 (purpose); `FixedAsset` + `/muhasebe/demirbaslar` + yıl sonu amortisman (DEPRECIATION, `amortisman.ts`), başlangıç öncesi demirbaş açılışa |
| B6 | Döviz (cari döviz, kur farkı, dövizli fatura ödemesi) | **yazıldı** — cari TL tutulur: dövizli fatura ve kasasız ödemesi FATURA KURUYLA (`lib/cari/doviz.ts`, SQL `doviz-sql.ts`) altı yerde (liste, iki kart ucu, ekstre, yaşlandırma, `invoiceBalanceEffect`/arşiv, `bakiye-asof`); ödeme kasaya TL (tutar × ödeme kuru, verilmezse fatura kuru) — eskiden döviz tutarı TL gibi yazılıyordu; finans hareketinin faturalara dağıtımı TL'den fatura kuruyla döviz ödemeye çevrilir. Kur farkı carinin bakiyesinde görünür kalır (bakiye kapama / kur farkı faturasıyla kapanır); yaşlandırma eksi kalan farkı kalem açmaz. Dövizli hesaptan fatura ödemesi reddedilir. Canlıda dövizli fatura 0 (2026-10-09) |
| B7 | Carisiz çek hesapsız | **yazıldı** formda uyarı (zorunlu yapılmadı: okutma/hızlı giriş cari bilmeden evrak açıyor); fişte karşı hesap seçilir |
| D1 | Gece mutabakatı | **yazıldı** — `lib/muhasebe/gece-mutabakati.server.ts`, uç `/api/muhasebe/cron/mutabakat`, `.github/workflows/muhasebe-mutabakat.yml` (günde bir, 00:23 UTC, `CRON_SECRET`) |
| D2 | Eski `accounting_entries` (3 test kaydı) | **kaldırıldı** — model ve fatura silmedeki silme kodu gitti; migrasyon `20261009000002_eski_muhasebe_kayitlari.sql` **DEPLOY'DAN SONRA** uygulanır (canlıdaki eski kod fatura silerken tabloya yazıyor) |
| D3 | Demo Firma'nın 720 TL tahsilatı Reypo'nun "ana" banka hesabında (tek kayıt) | **yapıldı (2026-10-09 akşam, kullanıcı onayıyla)**: hareket + ödeme Demo Firma'nın Kasa'sına taşındı, iki bakiye ±720 |

**Migrasyonlar:**
- `20261009000001_hareket_turu_demirbas.sql` — **CANLIDA** (kullanıcı uyguladı, 2026-10-09; kolonlar
  ve `fixed_assets` + RLS doğrulandı). `transactions.purpose`, `transactions."employeeId"` (FK NO
  ACTION), `fixed_assets`.
- `20261009000002_eski_muhasebe_kayitlari.sql` — **UYGULANMADI, DEPLOY'DAN SONRA** uygulanır:
  `accounting_entries`'i düşürür; canlıdaki eski kod fatura silerken o tablodan satır siliyor.

**Doğrulama durumu (2026-10-09 akşam, main'e gönderilirken):**
- `tsc` temiz; birim testleri geçiyor (`lib/muhasebe` 110, ilgili paketler 686, `lib` 2017+).
- Uçtan uca `scripts/test-muhasebe.mjs` migrasyondan sonra **100/101**: B1 (SGK 361, kredi 300,
  kâr/zarar bilgi satırı), B2 (avans 196), B3 (KDV mahsubu GERÇEKTEN yazıldı, 391/191 kapandı, geri
  alındı), B5 (amortisman 7.500, demirbaş silinince taslak kalktı). Tek kalan beklenti hatasıydı
  (açılış o adımda onaylıydı → "belge değişti" işaretlenir); betikte düzeltildi, **düzeltme koşulmadı**.
- Canlı tutarlılık `npm run test:canli -- lib/cari/bakiye-tutarlilik` B6 değişikliklerinden sonra
  **geçti** (çıkış 0; ayrıntılı çıktı okunmadı).
- **Koşulmayanlar:** B4'ün uçtan uca adımı (7d — betiğe yazıldı), B6'nın ödeme yazma yolu (dövizli
  fatura canlıda yok; elle/E2E sınanmadı), D1 gece mutabakatı ucu, Prisma istemcisi
  `AccountingEntry` kaldırıldıktan sonra YENİDEN ÜRETİLMEDİ (dev sunucusu dosyayı kilitliyordu).

**▶ YENİ BİLGİSAYARDA İLK ADIMLAR**
1. `git pull` → `npx prisma generate` (şemadan `AccountingEntry` kalktı, `purpose`/`fixed_assets` eklendi).
2. `npx tsc --noEmit` ve `npx vitest run lib`.
3. `npm run dev` + `MUHASEBE_SIFIRLA=1 TEST_BASE_URL=http://localhost:3000 node scripts/test-muhasebe.mjs`
   (Reypo; ~10 dk; 7d satılan malın maliyeti ve 8e düzeltmesi ilk kez koşacak).
4. Canlı (salt okur): `npm run test:canli -- lib/muhasebe/defter-tutarlilik` (yeni kaynaklar —
   türlü hareket, amortisman — mizan ↔ cari/kasa eşitliğini bozmamalı) ve
   `npm run test:canli -- lib/cari/bakiye-tutarlilik`.
5. Ekranları gözle (masaüstü + 390 px): `/muhasebe/ozet`, `/muhasebe/ay-sonu` (iki sekme),
   `/muhasebe/demirbaslar`, `/muhasebe/mali-tablolar?taslak=1`, finans "Yeni İşlem" → İşlem türü,
   personel kartı → Avanslar, Maaş formu → açık avans önerisi, dövizli fatura → Ödemeler (kur alanı).

**▶ YAPILACAKLAR (sırayla)**
1. Yukarıdaki doğrulamalar; çıkan hatayı düzelt.
2. **D3 — kullanıcı kararı:** Demo Firma'nın 720 TL tahsilatı (`transactions.id = cmsw0jy3q0025rrot6tjlewcu`,
   ödeme `cms0l591k0016qgqflfqxvcft`) Reypo'nun "ana" banka hesabında (`cmq8jznr9000141bn35fh8vlh`).
   Öneri: hareket + ödeme Demo Firma'nın Kasa'sına (`cmu48lupw000138fhzt61yr5m`) taşınır, iki bakiye
   ±720. Canlı veri yazar — kullanıcı onayıyla.
3. **Reypo test artıkları — kullanıcı kararı:** 9 anlamsız çek (biri 12,3 milyar TL "asdas") ve
   açıklamasız 2.000.000 TL gelir (`cmranwhyj00023auqn5zvhmpw`). Çek & Senet ekranından ya da
   uygulamanın silme uçlarıyla (kasa bakiyesi geri yazılsın diye). Bu oturumda canlıdan silen betik
   otomatik izin denetleyicisince reddedildi.
4. Deploy → hemen ardından `20261009000002` uygulanır.
5. Bilinen sınırlar (karar gerekirse): yaşlandırma eksi kalan kur farkını kalem açmaz (cari bakiyesinde
   görünür); dövizli hesaptan fatura ödemesi yok; amortismanda kıst (binek oto) yok; stok hareketinin
   tarihi `createdAt` (geç girilen belge maliyeti sonraki aya kaydırır).
6. Plan sonrası (kullanıcı): **başka bir firmanın projesiyle kıyas** → en son **müşavire çıkış**
   (C: Luca/Zirve aktarımı ya da e-Defter — karar yok). "Hedef kullanıcı" sorusu (sahip sade görünüm /
   müşavir tam ekran) cevapsız.

**Reypo:** kullanıcı "istediğin gibi kullan" dedi. Son E2E temizlikle bitti (modül kapalı, fiş yok,
TEST hesapları silindi).

Kararlar (2026-10-09): avans yalnız personel tarafından verilir (finans formu çalışan listesi okusaydı
maaş bilgisi açılırdı); KDV ödemesi, kredi ve ortak hareketi kâr/zarar, gelir-gider, harcamalar ve
finansal özette SAYILMAZ (bilgi satırı), vergi/SGK/avans nakit esaslı raporlarda gider kalır;
türlü hareket cariye/faturaya bağlanamaz; KDV mahsubu ve kapanış fişleri Fişler'den geri alınamaz
(kendi ekranlarından).

### ▶ DEVAM — başka bilgisayarda (2026-10-05 akşam)

**Durum:** modül kodda var, SATIŞTA KAPALI (fiyat kalemi `module:accounting` pasif, 42/42
firmada `accounting` kapalı). Kullanıcı kararı: önce zayıflıklar, sonra geliştirme; pilot
bitmeden fiyat AÇILMAZ. 2026-10-05'te yapılanlar aşağıda (inceleme düzeltmeleri, fiş kilidi,
toplu eşleme, veri modeli); hepsi main'de, tek commit.

- **Migrasyon `20261005000001_muhasebe_veri_modeli.sql` CANLIDA** (kullanıcı uyguladı,
  2026-10-05; kolonlar + indeks + 5 evrakın durum tarihi doğrulandı). Deploy güvenli —
  migrasyon zaten önde. Tekrar çalıştırılabilir.
- **Doğrulama:** `tsc` temiz, `npx vitest run lib` 1839 test, `lib/muhasebe` 80 test;
  uçtan uca `scripts/test-muhasebe.mjs` iki kez **72/72** (yeni adımlar: 1a bakiyesiz açılış,
  3b toplu eşleme, 3c onay kilidi yarışı, 8b veri modeli).
- **Reypo Medya temiz bırakıldı:** muhasebe kapalı, fiş/ayar/öğrenme yok, test çeki/hesabı/
  hareketi/bordrosu yok. Önceki koşuların hesap planı satırları BİLEREK duruyor (kullanıcı
  kararı) — `MUHASEBE_SIFIRLA` gerekmez.

**▶ 2026-10-05 mobil taramasının bulguları — 1 ve 2 aynı gün akşam DÜZELTİLDİ ve 390 px'te
yeniden ölçüldü** (taslak, gözden geçir ve iki onaylı fiş detayı + toplu eşleme: taşan
etkileşimli öğe 0; not anahtarsız 6 grupta çıkıyor). `tsc` temiz, `npx vitest run lib` 1861
test, uçtan uca iki koşu 72/72 (biri `MUHASEBE_BIRAK=1`, sonra `MUHASEBE_SIFIRLA=1` ile temizlik).

1. **Fiş detayında onay düğmeleri 390 px'te kırpılıyor** (önemli — telefondan fiş
   onaylanamıyor). `/muhasebe/fisler/[id]`: "Onayla", "Onayla ve sıradaki", "Onayı geri al"
   sağ kenarı 494–673 px, görünür sınır 375 px; panel gövdesi `overflow-x-clip` olduğu için
   kaydırılamaz. Kök sebep (bkz. hafıza "mobilde kırpılan kontroller", kök sebep 2): fiş kartı
   (`Kart`, `section`) `div.grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]`in çocuğu ve
   `min-w-0` taşımıyor → satır tablosunun `min-w-[640px]`i kartı 674 px'e itiyor; tablonun
   kendi `overflow-x-auto`su da bu yüzden çalışmıyor. **Düzeltme (tek satır):**
   `app/(dashboard)/muhasebe/fisler/[id]/page.tsx` → o grid'e `grid-cols-[minmax(0,1fr)]`
   (masaüstü `lg:` sütunları aynen kalır). Sonra aynı yöntemle yeniden ölç (aşağıda).
   → **Yapıldı, ölçüldü:** onay düğmeleri ekranda, satır tablosu kartın içinde kayıyor.
2. **Toplu eşlemede anahtarsız grup öğrenilmez, ekran bunu söylemiyor.** Reypo'da en büyük
   grup "Gider / hizmet alışı" (8 fiş): carisiz alış satırları, `learnKeys` boş
   (`fis-kurallari.ts` → `belge.cari` yoksa öğrenme anahtarı yok). Eşleme fişleri çözer ama
   onayda kural öğrenilmez; sonraki carisiz alışlar yine "gözden geçir"e düşer. **Düzeltme:**
   `app/(dashboard)/muhasebe/fisler/eslesme/page.tsx` → `g.ogrenmeAnahtarlari.length === 0`
   olan grubun alt satırına "bu seçim öğrenilmez, yalnız bu fişlere yazılır" notu
   (`Grup` tipine `ogrenmeAnahtarlari` eklenmeli; uç zaten döndürüyor). → **Yapıldı** (sarı not).
3. **Ölçülemeyen:** finans hareket formundaki kur alanı (yalnız dövizli hesap seçilince
   görünür; Reypo'da dövizli hesap yok). Diğer alanlarla aynı yapı; dövizli test hesabıyla bak.

**Mobil ölçüm yöntemi (2026-10-05'te çalıştı):** dev sunucusu + Chrome (localhost'ta oturum
açık olmalı). `MUHASEBE_BIRAK=1` ile betiği koş (ekranlar veriyle dolsun), localhost'ta herhangi
bir sayfayı (`/robots.txt`) aç, `javascript_tool` ile gövdeyi 390×844 bir `<iframe>` yap; her
sayfayı iframe'e yükle, yerleşmeyi bekle (dönen `svg.animate-spin` ve "Yükleniyor" metni
kalkana kadar), sonra `.overflow-x-clip` kabının sağını geçen ve kaydırılabilir atası olmayan
her etkileşimli öğeyi listele. Her çağrıda 3 sayfa (~40 sn, CDP tavanı 45 sn). Temiz çıkanlar:
Fişler (iki sekme), toplu eşleme (+ hesap seçici listesi), yeni elle fiş, açılış fişi, mizan,
yevmiye, kebir, bilanço/gelir tablosu, hesap planı, ayarlar; bordro, çek ve finans hareketi
diyalogları. İş bitince Reypo'yu temizle: `MUHASEBE_SIFIRLA` bloğundaki dört sorgu
(`scripts/test-muhasebe.mjs` başı) ya da betiği `MUHASEBE_SIFIRLA=1` ile bir kez daha koş.

**Sonra:** 4. Pilot (aşağıdaki listede). Açık kararlar: eski `accounting_entries` tablosu + 3
kayıt; Demo Firma'nın Reypo kasasındaki 720 TL; ciroyu cari kaynağı yapmak (ciroda tedarikçi);
cari döviz desteği; dövizli fatura ödemesinin kasa tutarı (bulundu, düzeltilmedi — aşağıda).
Not (2026-10-05 akşam): ödemedeki kasa tutarını TEK BAŞINA düzeltmek yetmez — cari bakiyesinin
altı yeri de faturanın para birimine bakmıyor (100 USD fatura cariye 100 TL girer). Kasa
tutarını kurla çevirmek kasa ile cariyi bu kez öbür yönden ayırır; ikisi "cari döviz desteği"
kararıyla birlikte tasarlanır.

**2026-10-05 — `8ecffe1` incelemesinin düzeltmeleri:**

- **Bakiyesiz başlangıçta açılış fişi elle açılır.** `8ecffe1` satırsız açılış taslağını
  kaldırınca müşavirin sermaye/demirbaş gireceği yer de kalkmıştı (elle satır yalnız VAR OLAN
  açılış fişine yazılabiliyordu; elle fiş başlangıçtan önceye tarihlenemiyor). Artık fiş ilk
  elle satırlarıyla birlikte açılır (`manuel.server.ts` → `acilisFisiniElleAc`; uç
  `POST /api/muhasebe/fisler {acilis:true}`; ekran `/muhasebe/fisler/acilis`, Ayarlar'dan
  bağlantı). Son elle satır silinince fiş kalkar (`PUT …/[id]` → `silindi`).
- **Açılış senkronu yalnız elle satırı olan fişi her seferinde yeniden yazıyordu** (erken
  dönüş otomatik satır şartına bağlanmıştı): satır id'leri her Fişler açılışında değişiyordu.
  Artık yalnız gerçekten satırsız taslak düşer.
- **Toplu yenileme onaylı fişe yazabiliyordu** (okuma ile yazma arasında onay — eskiden de
  vardı). `UPDATE … AND status = 'DRAFT' RETURNING id`; satırlar yalnız dönen fişlerde
  değişir. `taslaklariYenidenCoz` da yazma anında taslak + otomatik kaynak (USER değil) sorar.
- **Toplu onay** yalnız gerçekten onayladığı fişlerden öğrenir (eşzamanlı onayda sayaç iki
  kez artıyordu); diğerleri "başka oturumda onaylandı" diye atlanır.
- **Kaynak türleri tek bağlantıda sırayla okunur** (`dbConnectionLimit()`); Vercel'de paralel
  okuma kazanç getirmiyor, büyük defterde pool_timeout (P2024) riski taşıyordu.
- `undici` devDependency olarak yazıldı (betik import ediyordu, yalnız Vercel CLI'nin alt
  bağımlılığıydı). Betiğe "1a) bakiyesiz başlangıç" adımı eklendi.
- **Fiş kilidi** (aynı gün, ikinci tur — yukarıdaki "dar pencere" kapandı): onay satırları
  kilitsiz okuyup sınıyordu; arada senkron fişi yeniden kursa yeni satırlar sınanmadan
  onaylanabilirdi. Artık taslağın satırına yazan HER yol (senkron yenileme ve silme, hesap
  tazeleme, elle hesap seçimi, açılış senkronu ve elle satırları, elle fiş düzenleme, toplu
  eşleme) `kilit.server.ts` → `taslaklariKilitle` ile başlar; onay `fisleriKilitle` ile kilidi
  alıp satırları kilit altında okur ve sınar. Betikte "3c" adımı yarışı canlı canlandırır
  (betik kilidi tutarken onay gelir, satır hesapsız yapılır → onay 400, fiş taslak kalır).
  Yolda bulunan iki ufak: açılış senkronu boş taslağı silerken fiş bu arada onaylandıysa
  silmiyor ama ayardaki `openingVoucherId`yi yine boşaltıyordu; elle fiş silme okumada taslak
  görüp koşulsuz siliyordu — ikisi de düzeltildi.
- **Toplu eşleme ekranı** (`/muhasebe/fisler/eslesme`, Fişler başlığında "Toplu eşle"; kural
  `esleme.ts` testli, okuma/yazma `esleme.server.ts`, uç `/api/muhasebe/fisler/eslesme`):
  bekleyen satırlar (hesapsız ya da tahmin olan varsayılan; alt hesap, elle ve açılış farkı
  hariç) öğrenme anahtarına göre gruplanır — "ACME · KDV %20 alışları", "Faturasız gider ·
  Kira", "Bordro gideri". Gruba seçilen hesap satıra USER olarak yazılır, kural YAZILMAZ
  (öğrenme yalnız onayda); ekran "emin"e geçen fişleri onaylamayı önerir, onayla kural
  öğrenilir. Kilitli döneme yazılmaz. Satır içinde alt hesap açılabilir (hesap seçici).

**Yeni bilgisayarda ilk adımlar:**

1. `git pull` → `npx prisma generate` (eski client "journalVoucher yok" tip hataları verir)
   → `.next` bayatsa sil (`.next/dev/types` silinmiş Ba-Bs sayfasını arıyor olabilir).
2. Doğrula: `npx vitest run lib/muhasebe` (80 test) ve `npx tsc --noEmit`.
3. Uçtan uca: `npm run dev` + `TEST_BASE_URL=http://localhost:3000 node scripts/test-muhasebe.mjs`
   (Reypo Medya, 72 kontrol; sonda açtığını siler. Önceki bir `MUHASEBE_BIRAK=1` koşusu
   kurulum bıraktıysa `MUHASEBE_SIFIRLA=1` ekle). Yerelden DB turu ~420 ms: bir koşu ~10 dk,
   istek başına 5–40 sn normaldir (canlıda ms). Windows'ta dev sunucusu `TaskStop` ile
   kapanmaz — port 3000'i dinleyen node'u ayrıca kapat.
4. Canlı tutarlılık (salt okur, ~4 dk): `npm run test:canli -- lib/muhasebe/defter-tutarlilik`.

**Sıradaki iş (sırayla):**

1. ~~**Veri modeli eksikleri**~~ → 2026-10-05 yazıldı, migrasyon `20261005000001_muhasebe_veri_modeli.sql`
   (dört NULL'lanabilir kolon; deploy'dan ÖNCE uygulanır — yeni Prisma istemcisi kolonları seçer).
   Canlı ölçüm önce: dövizli hesap/hareket 0, virman bacağı 0, ciro 1, bordro 14 (4 firma) —
   geriye dönük doldurma yalnız çek/senet durum tarihinde (`updatedAt`).
   - **İşveren SGK:** `PayrollRecord.employerSgk`; boş = otomatik (teşviksiz taban oran,
     `bordroIsverenPayi` — ekran öneriyi yer tutucuda gösterir), girilen tutar aynen. Fiş:
     B 770 (`bordro:isveren-sgk`, ayrı öğrenilir) · A 361. Bordro ekranında alan + açıklama.
   - **Çek/senet durum tarihi:** `statusChangedAt` (`lib/cek-senet/durum-tarihi.ts`); form
     portföy dışı durumda tarih sorar; tahsil hareketi aynı günle yazılır/taşınır. Ciro fişi
     bu tarihle (not yazmak artık fişi oynatmaz); başlangıçtan önce alınıp SONRA ciro edilen
     evrak açılış portföyünde ve cirosu fişlenir; bilanço da ciroyu o güne kadar portföyde sayar.
     **Ciroda tedarikçi BİLEREK yok:** Kobipo'da ciro cari bakiyesine girmiyor (tedarikçiye
     ödeme ayrı "verilen evrak" kaydı); fişe 320 yazmak cari ile mizanı ayırır ve çift sayardı.
     Ciroyu cari kaynağı yapmak ayrı ürün kararı (cari bakiyesinin altı yeri).
   - **Virman ortak kimliği:** `Transaction.transferGroupId`, eşleştirme saf modülde
     (`virman-eslestir.ts`, testli); kimliksiz eski bacak eski kurala düşer.
   - **Kur:** `Transaction.exchangeRate`; para birimi HESAPTAN gelir (formlar hep "TRY"
     gönderiyordu), kur istekten ya da bugünün TCMB kurundan; geçmiş tarihte kur zorunlu.
     Dövizli hesapta cari/fatura bağı ve farklı para birimli virman REDDEDİLİR (cari bakiyesi
     TL tutulur). Finans sayfası hareket formunda kur alanı; form artık sunucunun hata
     mesajını gösteriyor. Kalan: cari döviz desteği (ayrı iş). **Bulunan, düzeltilmeyen:**
     dövizli FATURANIN ödemesi (`lib/finans/create-invoice-payment.ts`) kasaya faturanın para
     birimi ve döviz tutarıyla yazılıyor — TL kasaya 100 USD ödeme kasadan 100 TL düşer, hareket
     "USD" etiketli ve kursuz (muhasebede "kur yok" görünür). Canlıda dövizli fatura ve ödemesi
     0 (2026-10-05); ödeme çekirdeğinde ayrı tasarım ister (kasa tutarı = döviz × fatura kuru).
2. ~~**Toplu eşleme ekranı**~~ → 2026-10-05 yapıldı (yukarıda). Kalan: gerçek bir müşavirle
   "grup adları anlaşılıyor mu" sınaması (pilot) + anahtarsız grup notu (yukarıda, madde 2).
3. ~~**Mobil (390 px)**~~ → 2026-10-05 tarandı (iframe yöntemi); iki bulgu aynı gün
   düzeltildi ve yeniden ölçüldü. Kalan tek ölçülmeyen: dövizli hesapta kur alanı.
4. **Pilot** (2–3 hafta, gerçek firma + müşaviri) → sonra Luca/Zirve aktarımı, sürekli
   envanter (her satışta 621/153), kâr dağıtımı yardımcısı. Fiyat ancak pilottan sonra.

Açık kullanıcı kararları (aşağıda): eski `accounting_entries` tablosu + 3 kayıt; Demo Firma'nın
Reypo kasasına yazılmış 720 TL'lik tahsilatı. Reypo test hesabı TEMİZLENMEZ (kullanıcı kararı).

**2026-10-04 akşam — uçtan uca koşuldu (aşağıdaki "HİÇ çalışmadı" satırları artık geçersiz):**
deploy sonrası migrasyon tekrarı yapıldı; `scripts/test-muhasebe.mjs` 39/40 geçti (kalan tek madde:
ilk yarım kalan koşu Reypo'da `accounting`ı açık bıraktı, betik başlangıç durumunu geri yüklediği
için "modül kapalı → 403" denenemiyor — kod hatası değil). Ekranlar Chrome'da açıldı: Fişler,
fiş detayı + hesap seçici, Mizan (taslaklar dahil), Bilanço/Gelir Tablosu, Ayarlar + kapanış ön
izlemesi. 390 px mobil HÂLÂ bakılmadı (pencere küçültülemedi). Koşunun bulup düzelttikleri:

- **Yazma yolları kayıt başına sorgu atıyordu** (yerelden DB turu ~420 ms): kurulum 2,6 dk,
  200 fişlik mutabakat adımı 5 dk (istemci 300 sn'de kopuyordu), alt hesap açma 2,3 dk, toplu onay
  5 dk. Toplu yazmaya çevrildi: `planKur` üst bağı tek `UPDATE … FROM (VALUES)`, alt hesaplar tek
  `createMany` (çakışmada eski tek tek yol), fişler parça başına `createManyAndReturn` + satır
  `createMany` (çakışmada tek tek), sil/işaretle tek sorgu, kaynak türleri paralel okunur,
  `taslaklariYenidenCoz` tek UPDATE + toplu "emin" tazeleme, `topluOnayla` tek okuma + tek onay +
  gruplanmış öğrenme. Sonra: kurulum 11 sn, mutabakat adımı 24–44 sn, toplu onay 6 sn (yerelden).
- **Satırsız fiş:** 0 TL'lik belge (ikram/tam iskonto fişi) ve bakiyesiz başlangıç satırsız taslak
  üretiyordu — "emin" görünür, onaylanamaz ("Fişte satır yok"), taslak sayıldığı için YIL SONU
  KAPANIŞINI KİLİTLER. Artık açılmaz; eski boş taslaklar mutabakatta / açılış senkronunda silinir.
- **Mizan "taslaklar dahil"** hesapsız taslak satırları INNER JOIN'le düşürüyor, borç ≠ alacak
  görünüp "bu bir hatadır, desteğe bildirin" basıyordu. Uç `hesapsiz` toplamını döner, ekran
  sarı notla yazar, denge onlarla birlikte ölçülür.
- Betik: hesap planı beklentisi 400 → 321 (Tekdüzen satır sayısı); açılış fişi bakiye yoksa
  "yok" da kabul; başlangıç 2026-07-01 (açılış fişi yolunu sınamak için — 1 Ocak'ta Reypo'nun
  bakiyesi yok).

Zayıflık turu (aynı gün, ikinci geçiş): taslak fiş YENİLEME de topluya alındı (parça başına tek
transaction; betiğe "kaynak değişti → fiş yenilendi" adımı eklendi); fiş detayında hesap
seçicinin listesi artık kırpılmıyor (masaüstünde `overflow-visible`); altı muhasebe ekranı
durum gelene kadar boş durmuyor ve durum hatasını yazıyor (`DurumBekleniyor`). Betik:
fetch zaman aşımı 15 dk, kopan istekte temizlik sunucunun durulmasını bekler,
`MUHASEBE_SIFIRLA=1` önceki BIRAK kurulumunu silip modülü kapatır. Son koşu 40/41
(`MUHASEBE_SIFIRLA=1`; tek kalan, betiğin 770.01 beklentisiydi — sistem doğru olarak 770.02 verdi; beklenti düzeltildi, betik ondan sonra yeniden koşulmadı).
Son koşu temizlikle bitti: Reypo'da muhasebe KAPALI, fiş/ayar yok; önceki koşuların açtığı hesap
planı satırları (≈350, 770.01 dahil) BİLEREK duruyor (test firması, kullanıcı kararı).

**Neyin ÇALIŞTIRILDIĞI, neyin ÇALIŞTIRILMADIĞI (dürüst döküm):**

| Parça | Durum |
|---|---|
| Kural dosyaları (`fis.ts`, `fis-kurallari`, `para-kurallari`, `acilis`, `mizan`, `mali-tablolar`, `kapanis`) | birim testli (58 test) |
| Kaynak yükleyiciler (`kaynaklar.server.ts`, 11 tür, virman eşleştirmesi) | canlı veriyle ÇALIŞTI (salt okur tutarlılık testi) |
| Modül/şube kuralı, yetki ve modül haritası, menü | birim testli (page-access, modules, write-guard nöbetçileri) |
| Senkron YAZIMI (`senkron.server.ts`), alt hesap açma, plan kurulumu, açılış fişi yazımı, onay/öğrenme/yayılım, elle fiş, kapanış yazımı | yalnız tip kontrolü — veritabanına HİÇ yazılmadı |
| Ham SQL: mizan, yevmiye (madde no penceresi), kebir, fiş listesi araması, kasa açılış bakiyesi, fiş numarası | yalnız tip kontrolü — HİÇ çalışmadı (SQL hatası çıkabilir) |
| Bütün `/api/muhasebe/*` uçları ve 8 ekran | HİÇ çalışmadı, tarayıcıda açılmadı |
| Belge/para yazma yollarına eklenen `muhasebeyeBildir` çağrıları | tip kontrolü; modül kapalıyken tek sorguyla döner |
| `scripts/test-muhasebe.mjs` | yazıldı, HİÇ çalıştırılmadı — hata verirse betiğin kendisi de hatalı olabilir |

**Açık kararlar / yapılmadı:**

- **Eski model tam kaldırılmadı (§2.8):** `auto-entries.ts` silindi, yevmiye/kebir ekranları ve
  muhasebeci dışa aktarımı yeni defterden okuyor; ama `accounting_entries` tablosu ve
  Reypo Medya'daki 3 eski kayıt (000001–000003, 120/600/391) DURUYOR, artık hiçbir ekran
  okumuyor. Taşımak (elle fişe) ya da tabloyu düşürmek kullanıcı kararı.
- **Veri tutarsızlığı (canlı ölçüm):** Demo Firma A.Ş.'nin 720 TL'lik tahsilatı
  (`transactions.id = cmsw0jy3q0025rrot6tjlewcu`, "Tahsilat — FS-SAT-2026-0002") Reypo
  Medya'nın "ana" kasasına yazılmış. Tek kayıt, test verisi; düzeltilmedi. Motor bu
  hareketin kasa satırını hesapsız bırakır.
- **Gece mutabakatı** yok (aşağıda "Bilinen sınırlar").
- Luca/Zirve aktarımı (müşavirden örnek dosya), e-Defter, modül fiyatı.

**Plandan sapmalar (uygulanan hâl geçerlidir):**

- §2.2 açılış: ters bakiyeli cari 340/159'a AYRILMAZ, kendi 120/320 alt hesabında ters
  bakiyeyle kalır (mizan ↔ cari bakiyesi eşitliği için); ayrım bilançoda cari başına
  yapılır (`mali-tablolar.ts`: 120 alacak → 340, 320 borç → 159, 335 borç → 135).
  Personel masraf defteri bakiyesi de hep 335 alt hesabında.
- §3 bordro: B 770 brüt · A 361 SGK · A 360 vergi · A **369** diğer kesinti · A **196**
  avans mahsubu · A 335 net. Dönemin son günü tarihli.
- §3 virman: kasa hareketleri ortak kimlik taşımadığı için iki bacak tutar + gün + referansla
  eşleştirilir; eşleşen giriş bacağı ayrı fiş açmaz.
- §2.7 fiş no: `2026/000123` (açılış sırası); yevmiye madde numarası yıl içinde tarih sırası.

**1. faz — temel (yapıldı):**

- `lib/muhasebe/tekduzen.ts` — Tekdüzen planı (sınıf/grup/defteri kebir, tür, ters hesap,
  normal bakiye). 6. sınıfta "(-)" ters sayılmaz (610 borç bakiyelidir).
- `lib/muhasebe/fis-kurallari.ts` — belge → dengeli taslak fiş (22 test). Canlı ölçüm (salt
  okur): 777 belgeden 630'u fişe giriyor (147 iptal / GİB'e gitmemiş e-belge), 630'unun hepsi
  dengeli ve belgenin kendi toplamıyla kuruşu kuruşuna tutuyor.
- `prisma/schema.prisma` + `supabase/migrations/20261002000002_muhasebe_motoru.sql` —
  `journal_vouchers`, `journal_voucher_lines`, `account_mapping_rules`, `account_plans`a cari
  bağı. Prisma'nın `migrate diff` çıktısıyla birebir aynı. 2. fazın şema ekleri (aşağıda)
  uygulanmadan ÖNCE bu dosyaya katılır — iki ayrı migrasyon gerekmez.

Eski model: `AccountingEntry` satır başına tek borç–tek alacak; otomatik kayıt yalnız satış
faturasında (`lib/invoice/auto-entries.ts`). Canlıda tek firmada 3 kayıt; geçiş yükü yok.

## Mimari ilkeler

1. **Fiş belgenin muhasebe karşılığıdır.** Tutar belgeden gelir, motor vergi hesaplamaz;
   kalem değeri belgedeki hâliyle (`belgedekiKalem`). Fişe giren belge = KDV'ye giren belge
   (`kdvyeGirerMi`). Kural tek yerde: `fis-kurallari.ts`.
2. **Defter tüzel kişiye aittir.** Şube ana firmanın VKN'siyle çalışır (CLAUDE.md "Şube ≠
   firma"): şubenin belgeleri ANA FİRMANIN defterine fiş üretir, fiş kaynak şubeyi taşır.
   Ek firma ayrı VKN → ayrı defter. Hesabın kökü `resolveAccountRootId` DEĞİL, tüzel kişi:
   şubede `parentCompanyId`, aksi halde firmanın kendisi.
3. **Fiş belgeyle senkron, sessiz sapma yok.** Fiş kaynağın PARMAK İZİNİ (`sourceHash`:
   fişe giren alanların özeti) taşır. Taslak fiş belge değişince yeniden üretilir; ONAYLI fiş
   değiştirilmez, "belge değişti" işaretlenir (`sourceChangedAt`) ve listede ayrı sekmede durur.
4. **Hesapsız satırlı fiş onaylanamaz, dengesiz fiş olmaz.** Motor dengeyi garanti eder;
   onay ucu ayrıca doğrular (borç = alacak, her satırda hesap, hesap yaprak düzeyde).
5. **Öğrenme ONAYDA olur.** Taslakta seçilen hesap satıra yazılır (`accountSource = USER`) ve
   yeniden üretimde korunur; eşleşme kuralı (`account_mapping_rules`) yalnız onaylanan fişten
   öğrenilir — yanlış tıklama öğretmesin.

## 2. faz — taslak fişler ve ekran

### 2.1 Modül ve menü

- `MANAGEABLE_MODULES`'a `accounting` ("Muhasebe"); `PricingItem["accounting"]` ücretli
  (isFree değil). Kural CLAUDE.md "Abonelik FİRMA bazındadır": yetkinin kaynağı
  `purchasedModules` / `grantedModules`; yeni firma kapalı doğar.
- Menü grubu **Muhasebe**: Taslak Fişler (`/muhasebe/fisler`), Yevmiye (`/muhasebe/yevmiye`),
  Kebir (`/muhasebe/kebir`), Mizan (`/muhasebe/mizan`), Hesap Planı (`/muhasebe/hesap-plani`),
  Muhasebe Ayarları (`/muhasebe/ayarlar`). Roller: ADMIN, BM, ACCOUNTANT.
- `PAGE_API_RULES` `/api/muhasebe` kuralı yeni sayfalara taşınır; yazma (onay, hesap açma,
  ayar) `writePages`'te açıkça. Bugünkü "mali tablolar okuyan defteri okur" bağı korunur.
  Kapsam nöbetçisi (`lib/page-api-coverage.test.ts`) yeni uçları yakalar.

### 2.2 Kurulum (modülün ilk açılışı)

1. **Başlangıç tarihi** seçilir (varsayılan: içinde bulunulan yılın 1 Ocak'ı).
2. **Hesap planı kurulur:** Tekdüzen planı firmaya yazılır (idempotent; aynı kodlu mevcut
   hesap korunur). Kasa/banka/kart hesapları (`FinancialAccount`) için alt hesaplar açılır:
   100.01.0001…, 102.01.0001…, kredi kartı 309.01.0001….
3. **Açılış fişi (TASLAK)** başlangıç tarihindeki bilinen bakiyelerden: cari bakiyeleri
   (`lib/cari/bakiye-asof.ts` — bilançoyla aynı kaynak, müşteri 120 / tedarikçi 320; ters
   bakiye kendi alt hesabında kalır, 340/159 ayrımı bilançoda — bkz. "Plandan sapmalar"), kasa-banka (`cashBalanceBefore`), portföydeki çek/senet (101/121,
   103/321), personel masraf defteri (335/135). Stok, demirbaş, sermaye Kobipo'da yok →
   hesapsız satır olarak bırakılmaz; fark satırı **500 önerisiyle hesapsız** durur, kullanıcı
   (müşavir) dağıtır.
4. **Geçmiş belgeler:** başlangıç tarihinden bugüne fişe giren her belge için taslak fiş
   arka planda üretilir (sayfalı iş; ilerleme ekranda).

### 2.3 Senkron — tek fonksiyon, iki tetik

`syncBelgeFisi(belgeId)` (lib/muhasebe): belgeyi okur → `belgeFisTaslagi` → hesapları çözer
→ fişi yazar/günceller/siler. İdempotent; `sourceHash` aynıysa dokunmaz.

- **Yazma tetiği:** belgeyi yazan ÇEKİRDEK yollar çağırır — `createInvoiceFromBody`, fatura
  PUT, dönüşümler (fiş/sipariş/teklif → fatura), GİB gönderimi (`send-invoice-helper`), durum
  sorgusu (`check-status`, `sync-statuses`), iptal (`void-invoice`, fiş iptali), içe aktarım
  (`fatura-ice-aktar`). Bugün 18 dosya belge yazıyor; `auto-entries.ts` çağrılarının yeri
  başlangıç listesidir.
- **Mutabakat tetiği:** Taslak Fişler açılırken ve gece işi olarak "başlangıç tarihinden
  sonra fişe girip fişi olmayan / izi değişmiş belge" sorgusu çalışır. Bir yazma yolu
  unutulsa da fiş eksik kalmaz — sapma ekranda sayılır.
- Muhasebe modülü kapalıysa ikisi de çalışmaz (fiş yazılmaz, belge yazımı etkilenmez; fiş
  yazımı belgenin transaction'ını DÜŞÜRMEZ, hatası loglanır ve mutabakat yakalar).

### 2.4 Hesap çözümü

- Motorun önerdiği kod firmanın planında aranır. Ana hesabın alt hesabı varsa (ör. 600'ün
  altında 600.01.001) satır hesapsız kalır, öneri ana kod — yaprak olmayan hesaba yazılmaz.
- **Cari alt hesabı otomatik açılır:** 120/320 altında sıradaki numara (`120.01.0001`), adı
  "<cari adı> — <VKN/TCKN>", `account_plans.customerId/supplierId` bağlı. Cari başına tek.
  Carisiz satış (perakende) → "120.01.0000 Perakende Müşteriler" tek alt hesap.
- Hesap seçici: arama (Türkçe duyarsız, `trFold`), "sıradaki alt hesabı aç" (Aposkal'daki
  Ctrl+Enter karşılığı), pasif hesaba yazılmaz.

### 2.5 Öğrenme

- Onayda, her satırın `learnKeys`i için seçilen hesap motorun varsayılanından farklıysa ya
  da öğrenilmiş hesaptan farklıysa `account_mapping_rules` upsert edilir (`hits++`).
- Anahtarlar `fis-kurallari.ts`te: `satis:urun:<id>`, `satis-iade:urun:<id>`,
  `alis:urun:<id>`, `alis:cari-kdv:<tedarikçi>:<oran>`, `satis:kdv:<oran>`, `alis:kdv:<oran>`,
  `satis:otv`, `satis:diger-vergi`, `alis:tevkifat`.
- "Emin" fiş: tüm satırların hesabı belli ve alış gider/stok satırı varsayılan değil
  (motorun `emin` kararı). Toplu onay yalnız emin fişlere açık.

### 2.6 Ekranlar

- **Taslak Fişler:** sekmeler — Emin (toplu onay) · Gözden geçir (hesapsız / tahminli) ·
  Belge değişti · Onaylı. Filtre: tarih, belge türü, cari.
- **Odak görünümü:** solda belge önizlemesi (fatura/fiş sayfası), sağda fiş; hesapsız satır
  kırmızı, "Onayla" kilitli; onay sonrası sıradaki fişe geçer. Onaylı fiş salt okunur,
  "Geri al" taslağa döndürür (yalnız açık dönemde).
- **Mizan:** dönem, düzey (ana/alt hesap), "taslaklar dahil" anahtarı. Toplam borç = toplam
  alacak ekranda yazılır.
- **Yevmiye / Kebir:** yeni modelden yeniden yazılır (bugünkü sayfalar `AccountingEntry`
  okuyor).
- **Hesap Planı:** ağaç, alt hesap aç/pasifleştir; fişte kullanılan hesap silinemez (FK RESTRICT).

### 2.7 Fiş numarası

Taslak ve onaylı fiş firmada sıralı iç numara taşır (`voucherNo`, ör. `2026/000123`).
Yevmiye defterinin MADDE numarası tarih sırasıyla basımda verilir; geriye tarihli onay
iç numarayı bozmaz. (e-Defter fazında dönem kapanışıyla kesinleşir.)

### 2.8 Eski modelin emekliye ayrılması

`auto-entries.ts` çağrıları `syncBelgeFisi`ye döner; `AccountingEntry` okuyan yerler
(yevmiye/kebir sayfaları, `app/api/export/accountant`) yeni modele geçer. Canlıdaki 3 eski
kayıt bir kerelik betikle açılış/elle fişe taşınır, tablo sonra kaldırılır.
**Durum (2026-10-04):** ilk iki adım yapıldı; tablo ve 3 kayıt duruyor (açık karar, yukarıda).

### 2.9 Şema ekleri (1. faz migrasyonuna katılır)

- `journal_vouchers`: `sourceHash TEXT`, `sourceCompanyId TEXT` (şube), `kind TEXT`
  (ACILIS | MAHSUP | TAHSIL | TEDIYE).
- `journal_voucher_lines`: `accountSource`ta `USER` değeri.
- Muhasebe ayarı: `accounting_settings` (companyId PK, `startDate`, `planInstalledAt`,
  `openingVoucherId`) — `companies`a kolon değil (kaşe tablosundaki gerekçe).

### 2.10 Ölçüm

- Birim: `fis-kurallari.test.ts` (mevcut), hesap çözümü, öğrenme, açılış fişi (saf parçalar).
- Canlı (`npm run test:canli`, salt okur): her fiş dengeli; her fişin `sourceHash`i belgeyle
  aynı; **mizan 391/191 ↔ KDV raporu** aynı dönemde eşit (KDV raporu fişe giren belge kümesiyle
  aynı tanımı kullanıyor — iki rakamın ayrışması ya motorda ya rapordadır); mizan 120/320
  alt hesap toplamları ↔ cari bakiyeleri (`bakiye-asof`).

## 3. faz — para hareketleri

| Kayıt | Fiş |
|---|---|
| Tahsilat (fatura ödemesi, cari avansı) | B 100/102/309.xx · A 120.cari |
| Tediye | B 320.cari · A 100/102/309.xx |
| Virman | B hedef hesap · A kaynak hesap |
| Faturasız gider | B 770 (kategoriye göre öğrenilir) · A kasa/banka |
| Faturasız gelir | B kasa/banka · A 649 (öğrenilir) |
| Alınan çek / tahsili | B 101 · A 120 → B 102 · A 101 |
| Verilen çek / ödenmesi | B 320 · A 103 → B 103 · A 102 |
| Senet | 121 / 321 aynı desen |
| Bakiye kapama (WRITE_OFF) | satışta B 611 · A 120; alışta B 320 · A 649 |
| Cari virman fişi | B 120/320.x · A 120/320.y |
| Çalışan cebinden ödedi | B 320.cari · A 335.personel; iadesi B 335 · A kasa |
| Bordro | B 770 (brüt, öğrenilir) · A 335 (net), 360 (gelir + damga), 361 (SGK işçi), 369 (diğer kesinti), 196 (avans) |

Kural `fis-kurallari.ts`e yeni giriş tipleri olarak eklenir (aynı satır/öğrenme yapısı).
İşveren SGK payı bordroda tutulmuyor — fişte eksik kalır, ekran yazar.

## 4. faz — raporlar ve köprü

- Bilanço ve gelir tablosu mizandan (bugünkü bilanço cari/kasa kaynaklarından kuruluyor;
  ikisi yan yana ölçülür, sonra mizana geçilir). Dönem sonu kapanış (690 → 590/591).
- Muhasebeciye köprü: Luca / Zirve fiş aktarımı (Excel); format müşavirden örnekle alınır.
- e-Defter ve beyanname gönderimi sonraki faz.

## Riskler

- **Belge yazma yolu çok (18 dosya):** mutabakat tetiği olmadan bir yol unutulur ve fiş
  sessizce eksik kalır. Mutabakat 2. fazın parçasıdır, sonraya bırakılmaz.
- **Onaylı fişin belgesi değişirse** fiş kendiliğinden değişmez — "Belge değişti" sekmesi
  boş değilse panoda uyarı (otomasyon kartı).
- **Eski kurallarla kaydedilmiş belgeler** (Temmuz ÖTV test faturaları) kayıtlı değerleriyle
  fişe girer; motor yeniden vergi hesaplamaz — fiş belgeyle aynı kalır.

## Kalan sorular

- ~~Şubede muhasebe modülü~~ → karar 2026-10-04: yalnız tüzel kişide (yukarıda).
- Luca/Zirve aktarım formatı: müşavirden örnek dosya.
- Modül fiyatı.

## Bilinen sınırlar (2026-10-04)

- **Artımlı senkron BİLEREK yok (ölçüm 2026-10-04):** mutabakat her açılışta bütün kaynakları
  okur. En büyük defter (Reypo, 332 fatura) ~350 fiş / ~330 KB; ~15 sorgu, türler paralel
  (yalnız havuzda birden çok bağlantı varken — Vercel'de `connection_limit=1`, orada sırayla;
  bkz. 2026-10-05).
  Yerelden 13–22 sn ölçülen sürenin tamamı ağ turu (~420 ms); canlıda Vercel `fra1` ↔ Supabase
  `eu-central-1` (1–2 ms) bir saniyenin altında. Artımlı yol (son mutabakat damgası + değişen
  kaynak) migrasyon ve "değişeni kaçırma" riski getirir; firma başına yılda birkaç bin belgeyi
  geçen ilk müşteride ölç, o zaman yaz.
- **Gece mutabakatı yok:** fiş senkronu belge yazılırken ve Fişler / Ayarlar ekranı
  açılırken çalışır. Cron dağıtımı bilinçli ertelendiği için (abonelik notu) gece işi
  yazılmadı; seyrek yazma yolları (bordro toplu oluşturma, cari kartı açılış bakiyesi,
  kasa hesabı açılışı, eski içe aktarım) ekran açılınca yakalanır.
- **Çek/senet ciro, iade ve protesto tarihi tutulmuyor:** ciro fişi evrakın son
  güncellenme günüyle açılır, tedarikçi müşavirce seçilir; iade/protesto evrakın alış
  fişini kaldırır (cari bakiyesiyle aynı model). Başlangıçtan önce alınıp sonra ciro
  edilen evrak fişlenmez (açılış portföyü bugünkü durumla kurulur — bilançoyla aynı).
- **İşveren SGK payı bordroda yok:** tahakkuk fişine girmez, müşavir elle ekler.
- **Satılan malın maliyeti aralıklı envanterle:** yıl sonu sayım tutarı kapanışta girilir.
- **Kur:** kasa hareketinde kur tutulmuyor, TL dışı hareket fişe girmez (ekran sayar).
- **Kapanış hedef hesapları yaprak olmalı:** 621/632/690/590 alt hesaplıysa kapanış durur.
