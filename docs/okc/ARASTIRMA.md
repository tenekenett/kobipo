# ÖKC / yazarkasa POS entegrasyonu — araştırma (2026-09-24)

Soru: Kobipo bulutta (Vercel) koşuyor, tarayıcı USB/seri porta konuşamıyor. Yazarkasaya
**kablosuz, yerel ajan kurmadan** satış gönderilebilir mi?

Cevap: **Evet.** Büyük ÖKC işleticilerinin (TSM) çoğu bir **bulut sepet API'si** sunuyor:
Kobipo sunucusu sepeti işleticinin bulutuna yollar, cihaz kendi 4G/Wi-Fi'ı ile alır, kasiyer
ödemeyi cihazda tamamlar, sonuç (fiş no, Z no, ödeme kırılımı) **webhook** ile Kobipo'ya döner.
Kablo, sabit IP, masaüstü köprü yok. Sektörde bu yola "TSM entegrasyonu" / "kablosuz" deniyor.

> Önceki not (docs/restoran/PLAN.md "Açık riskler 1"): (a) konumlandırma / (b) entegrasyon.
> 2026-09-24'te kullanıcı (b) dedi.

## Kablo (GMP-3) — kurulumsuz OLAMAZ, mevzuat gereği

GİB'in ÖKC ↔ harici sistem protokolü GMP-3 herkese açık (en güncel: Sürüm 5.0, 02.08.2018,
ynokc.gib.gov.tr/UploadedFiles/Files/GMP3_v5_0_02082018.pdf). Fiziksel katman Ethernet, RS232
ya da USB (USB = USB-RS232, seri port); şifreleme DH-2048 + RSA-2048 + AES-256-CBC; ACK bekleme 3000 ms × 3.
Teknik olarak tarayıcıdan (Web Serial) konuşulabilirdi ama **mevzuat bunu kapatıyor** — §3.3 "PC Eşleşmesi":

> "YN ÖKC'nin eşleştiği ve PC üzerinden koşan yazılım, YN ÖKC üreticisinin temin ettiği derlenmiş
> (kodları paylaşılmadan) bir GMP-3 iletişim kütüphanesi kullanılarak geliştirilmiş olmalıdır."
>
> "Eşleşme için PC de koşan yazılım uzak sunucuda bulunuyor ve browser benzeri bir arayüz ile
> erişiliyor ise, eşleşmek için PC'de ayrı bir ara yazılım bulunmalıdır ve eşleşme bu yazılım
> üzerinden yapılmalıdır."
>
> "Donanımların eşleştirme işlemlerini yönetecek yetkili kişi, Maliye Bakanlığı tarafından
> yetkilendirilmiş ÖKC üreticisi firmaya bağlı yetkili servis personeli olmalıdır."

Yani kablolu yolda her müşteride: PC'ye üreticinin kütüphanesiyle ara yazılım + (çoğu markada)
yetkili servisin eşleştirmesi + çoğu zaman yıllık GMP3 lisansı. Rakiplerin "kurulum ücreti" buradan.
Kobipo'nun kendi GMP-3 gerçeklemesi (JS/Web Serial) üretici kütüphanesi olmadığı için uyumsuz.

Aynı belge bulut yolunu **açıkça** tanımlıyor (§2, s. 12):

> "…harici satış uygulama sisteminde oluşturulan satış/sipariş bilgilerinin harici sistemden ödemeyi
> gerçekleştirilecek YN ÖKC'ye iletilmesinde, bir master ÖKC veya GMP-3 kablolu bağlantı zorunluluğu
> olmaksızın, ÖKC TSM Merkezleri vasıtasıyla kablosuz yöntemle YN ÖKC'ye iletilmesi ve işlemlerin
> sonlandırılması da mümkündür."

devamında: "Self servis, masada yemek hizmeti veren veya kapıya teslim yapan lokanta, restoran vb." —
yani TSM bulut yolu tam bizim senaryomuz için tasarlanmış resmî yol.

## Hız (kullanıcının 1 numaralı şartı)

Rakiplerde entegrasyon kasiyerin tutarı cihaza elle girmesinden yavaş olduğu için kullanılmıyor.
Ölçülecek hedef: **"Öde"ye basıştan cihaz ekranında tutara ≤ 2 sn.** Tasarım kuralları:
- Sepet ÖNCE gider; fiş/stok/cari/muhasebe (ağır kısım) webhook gelince arkadan yazılır.
- Masada liste kipi: sepet "hesap istendi" anında gönderilir → garson cihazı aldığında sepet zaten orada.
- Erişim jetonu (Token JWT 24 sa) önbellekte; KDV → kısım eşlemesi önceden, ödeme anında sorgu yok.
- İnternet yoksa: kart zaten çekilemez (banka da internet ister); nakitte cihaza elle giriş + Kobipo'da
  "ÖKC'ye elle girildi" işareti — geri düşme AÇIK olmalı, sessiz değil.
- Ölçüm: sunucu tarafı bugün Token simülatörüyle, cihaz tarafı gerçek cihazla.

## Markalar

| İşletici | Cihazlar | Bulut yolu | Doküman | Kimlik / ücret |
|---|---|---|---|---|
| **Token** (Koç) | Beko 300TR, X30TR, 400TR (Android) | **Token X Connect Cloud** — REST + webhook | **Açık, tam** (+ Postman + simülatör) | `client-id`/`client-secret` Token geliştirici ekibinden; ücret belirtilmemiş |
| **Ödeal** (Akbank) | Ödeal Android ÖKC | **Device2Device** — REST + callback | **Açık** (stage ortamı var) | Anahtarlar üye işyerine özel, portal.odeal.com'dan; test anahtarı destekten |
| **Pavo** | N86, UN20, N96, N6, CT20 (hepsi) | **Cloud** (+ REST yerel, P2P cihaz içi) | Kamuya açık değil, talep edilecek | Müşteri pavopay.pavo.com.tr'de API key üretir + cihaz seri no; Pavo **ayrı entegrasyon lisansı almıyor** (cihazda yıllık GMÖ ücreti) |
| **Worldline** (Ingenico + PAX, iKasa) | Kablosuz: Move/5000F, IWE280, PAX A910SF (IDE280 yalnız kablo) | **Cloud API** | Ücret ödendikten sonra verilir | **Yıllık GMP3 entegrasyon lisansı** (online.ikasa.com.tr); bulutta satış cihaza itilemez, kasiyer cihazdan çağırır |
| Hugin | Tiger T300 | TSM kablosuz var ama **yalnız liste**: "satışlar doğrudan cihaza gönderilemez, sipariş olarak bekletilir" (webticari) → kasada anında kip yok | Kamuya açık değil | Bilinmiyor |
| inPOS | M530 | TSM kablosuz var (SambaPOS: "masada ve paket serviste") | Kamuya açık değil | Bilinmiyor |
| Verifone, Profilo, Vera, Paygo, Propay | — | Araştırılmadı | — | — |

Ölçek (firmaların kendi beyanı, karşılaştırma kaba): Türkiye'de 2.126.235 ÖKC (BKM, 31.12.2023,
Token blogu). Token 680.000+ cihaz yönetiyor, Pavo 250.000 cihazlık ağ. Marka bazında resmî pay bulunamadı.

## Öncelik (2026-09-24)

1. **Hemen başla — doküman açık:** Token (X30TR kesin; 300TR/400TR sorulacak) — simülatörle cihazsız
   geliştirilir, yalnız test kimliği istenir. Ödeal — D2D açık, stage var; e-Arşiv'i kendisi kesme
   meselesi netleşmeli.
2. **Yaz, doküman iste — ücretsiz görünüyor:** Pavo (Cloud, tüm modeller, lisans yok).
3. **Sonra:** Hugin, inPOS (doküman kapalı; Hugin'de kasa kipi yok), Worldline (yıllık lisans +
   kasiyer cihazdan çağırıyor → hız hedefine en uzak).

### Token X Connect Cloud (en olgun, doküman açık)

- Kimlik: `POST /v1/auth/token` (Basic `client-id:client-secret`) → Bearer JWT, 24 sa.
- Webhook: `POST /clientSettings/set` → `callbackUrl` (`${terminal-id}`, `${basket-id}` yer
  tutucuları), `callbackAuth`. Entegratör başına TEK callback URL (sepet bazında ezilebilir).
- Kısım/departman listesi: `GET /fiscalParameters` (`terminal-id`) → KDV oranı ↔ `sectionNo` eşlemesi buradan.
- İki kip (cihazda ayarlanır):
  - **Mod 1 — anında (kasa):** `POST /instantBasket` → cihaz hemen ödeme ekranını açar.
  - **Mod 0 — liste (masa/paket):** `POST /basket` (`terminal-id` ya da `branch-id`) → sepet şubedeki
    cihazlarda listede durur, garson masada seçip tahsil eder. `GET /openBaskets`, `PUT`/`DELETE /basket/{id}`,
    `POST /basket/unlock`.
- Sepet: `basketID` (UUID, **küresel tekil**, tekrarında 1007), `title`, `note`, `items[]`
  { `name`, `price` (kuruş, tamsayı), `quantity` (×1000), `sectionNo`, `taxPercent` (×100: 1000 = %10) },
  `paymentItems[]` { `type`, `amount`, `description` }.
- Webhook `BASKET_COMPLETED` → `data`: `basketID`, `status` (0 başarılı, −1 iptal/red, 99 fiş iptal),
  `documentType`, **`receiptNo`**, **`zNo`**, `UUID`, **`InstanceIdentifier` (cihaz seri no)**, `invoiceID`,
  `paymentItems[]` { `type`, `amount`, `TxnNo`, `BatchNo`, `status` }. Ayrıca `BASKET_LOCKED`/`UNLOCKED`.
- Hatalar: 1103 "kalem toplamı ≠ ödeme toplamı", 1100 "terminalde zaten açık sepet var",
  1104 "terminal kipi anında sepete uygun değil", 1018 "sepet kilitli".
- Tamamlanmayan sepet en çok 3 gün tutulur.
- **EKÜ no webhook'ta yok** — cihaz tanımında tutulacak ya da başka uçtan okunacak (doğrulanacak).

### Ödeal Device2Device

- Ortam: stage `https://api.stg.odeal.com/api/v1`, canlı `https://api.odeal.com/api/v1`.
- Başlıklar: `X-ODEAL-MERCHANT-KEY`, `X-ODEAL-SECRET-KEY` (üye işyerine özel).
- Eşleme: cihazdaki Ödeal uygulamasında "Cihazlarım" → cihaz kodu → sepette `externalDeviceKey`.
- Sepet gelince cihaz "uyanır" ve sepeti gösterir; ödeme Ödeal uygulamasında biter.
- Callback türleri: ödeme başarılı / iptal / başarısız, e-Fatura oluştu / iptal.
- **Ödeal e-Fatura/e-Arşiv'i KENDİSİ kesiyor** (`eInvoiceIntegrator: "ODEAL"`) → Kobipo'nun Mysoft
  üzerinden kestiği belgeyle çakışma riski; hangi tarafın belge keseceği netleşmeli.
- İade yok; iptal yalnız gün sonundan önce ("batch malileştiyse iptal edilemez").

## Kobipo'ya etkisi (tasarım notları, karar değil)

- **Akış tersine döner:** bugün fiş Kobipo'da kesilip tahsilat yazılıyor
  (`lib/satis/submit-receipt-sale.ts`). ÖKC'de ödeme CİHAZDA biter; yetkili kayıt webhook'tur.
  Önerilen: sepet gönderilince adisyon "cihazda ödeniyor" (kilitli) → `BASKET_COMPLETED` gelince
  fiş + tahsilat webhook'taki ödeme kırılımından yazılır → iptal gelirse kilit açılır.
- **Tutar:** ÖKC KDV dahil fiyat + kuruş tamsayı ister, KDV'yi kendisi hesaplar. Fiş zaten
  `{ receipt: true }` kuralında (KDV dahil). Mali belge ÖKC'ninkidir; fark çıkarsa
  ÖKC toplamı esas alınır, sessiz geçilmez.
- **Kısım eşlemesi:** KDV oranı → `sectionNo`, cihaz başına (`/fiscalParameters`).
- **Cihaz tanımı şube bazında** (her şubenin kendi cihazı/terminal-id'si).
- **Tekrar gönderim:** `basketID` = Kobipo'nun kendi UUID'i → ağ hatasında aynı sepet iki kez basılmaz.
- **Webhook ucu** herkese açık olacak: `callbackAuth` doğrulaması şart; aynı webhook iki kez gelirse idempotent.
- **Z raporu:** her fişte `zNo` gelir → gün sonu `zNo` bazında gruplanıp cihazın Z toplamıyla karşılaştırılır.
- **Sağlayıcı soyutlaması:** e-fatura sağlayıcısı deseni — tek arayüz, `token` / `odeal` / `pavo` sürücüleri.
- **Sabit IP gerekmiyor** (sanal POS'tan farkı) — ama canlı ortamda IP beyaz listesi isteyen işletici var mı, sorulacak.

## Açık sorular (işleticilere)

1. Token: canlı `client-id` için sözleşme/ücret var mı? EKÜ no nereden okunur? İade/iptal akışı?
2. Pavo: Cloud API dokümanı ve test ortamı (merkezioperasyon@pavo.com.tr, 0850 611 0 444).
3. Ödeal: e-Belgeyi Ödeal değil Kobipo/Mysoft kesebilir mi (ya da hiç kesilmesin, yalnız ÖKC fişi)?
4. Hepsi: fatura isteyen müşteride "fatura bilgi fişi" nasıl basılır, bilgi fişi numarası döner mi?
   (Mysoft `InvoiceOutboxModel`de ÖKC alanı yok; yalnız `invoiceOutboxNetleBelge` → `okcBilgiFisleri`.)
5. Mali müşavir: VUK 507 (GMÖEBYS — Pavo/Ödeal cihazının her satış için e-Belge kesmesi; Mysoft'ta
   `addVuk507Activation`) kafe için ÖKC fişinin yerine geçer mi?

## Kaynaklar

- Token X Connect Cloud — genel: https://developer.tokeninc.com/token-developer-portal-1/x-platform/token-x-connect-cloud/genel-tanitim-tr
- Token X Connect Cloud — geliştirici: https://developer.tokeninc.com/token-developer-portal-1/x-platform/token-x-connect-cloud/gelistirici-dokumani-tr
- Token Postman: https://documenter.getpostman.com/view/29891759/2sB34hEzUj · Simülatör: https://xci.devtokeninc.com/
- Ödeal D2D: https://docs.odeal.com/entegrasyon/tr/api/d2d/whatisd2d · SSS: https://docs.odeal.com/entegrasyon/tr/guide/faq
- Pavo tipleri (Ritapos): https://ritapos.com/pavoya-entegre-pos-sistemi/
- iKasa bulut: https://www.scmedya.com/en/ikasa-move5000-f-entegrasyon-altyapisi-ve-web-entegrasyonu
- Beko TSM (yerel sunuculu eski yol, Akınsoft): https://akinsoftteknikdestek.com/yardim-merkezi/beko-x30tr-token-kablosuz-entegrasyonu/
- Rakip fiyatı (Drive): kafe_restoran_yazilim_fiyat_analizi — Adisyo ÖKC modülü 565 ₺/ay
