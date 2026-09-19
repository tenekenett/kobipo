# Sanal POS Modülü — Arka Plan Araştırması (banka-doğrudan model)

**Tarih:** 2026-09-19 · **Durum:** araştırma, karar bekliyor · **Kod yazılmadı.**

**Model (kullanıcı kararı):** KOBİ kendi bankasına sanal POS başvurusu yapar, banka API
anahtarlarını verir, anahtarları Kobipo'ya girer. KOBİ Kobipo'da tutar girip ödeme linki
gönderir; karşı taraf kartla öder; para **doğrudan KOBİ'nin bankasına** düşer; tahsilat
Kobipo'da kayda geçer. PayTR/iyzico gibi aracı kuruluş **kullanılmaz** (istenirse aynı
adaptör yapısına "sağlayıcı" olarak eklenebilir; rakip iyzico ve Moka'yı da kart olarak
sunuyor). Rakip emsali: banka başına yıllık modül, 1.990 ₺ + KDV.

---

## 1. Hukuk ve uyum — bu modelde temiz

- 6493 md. 12/2 muafiyeti: *"teknik hizmet sağlayanların … işlemin herhangi bir anında
  transfer edilen fonun sahibi olmadığı hizmetler"* → lisans gerekmez. Para banka → KOBİ.
  Kobipo yalnız link üretir, bankaya yönlendirir, sonucu doğrular, kaydeder.
- **Kart formu ASLA Kobipo'da olmaz.** Bankanın "ortak ödeme sayfası" (3D Host / OOS /
  3D Pay Hosting) kullanılır → PCI DSS **SAQ A** (yıllık öz-değerlendirme anketi, denetim
  yok). Kendi sayfamızda kart alırsak SAQ A-EP: dış tarama + geniş anket; kaçınılır.
  Sonuç: **ortak ödeme sayfası olmayan banka ilk sürümde sunulmaz** (aşağıdaki tablo).
- 3D Secure zorunlu; bankaların ortak ödeme sayfası zaten 3DS'li çalışır.
- Bankanın verdiği API anahtarları KOBİ'nin sırrıdır; Mysoft kimlikleriyle aynı yolla
  (AES-256-GCM, `NEXTAUTH_SECRET` türevi) firma bazında şifreli saklanır.

## 2. Banka → protokol haritası

Ürün "banka" satar, kod "protokol" yazar. 13 banka kartı ≈ 8 protokol; NestPay tek
adaptörle 7+ bankayı kapsar.

| Protokol | Bankalar | Banka ne verir (KOBİ'nin gireceği alanlar) | Ortak ödeme sayfası | Test ortamı |
|---|---|---|---|---|
| **NestPay / Asseco (EST)** | Akbank (eski), TEB, **İş Bankası**, Şekerbank, **Halkbank**, QNB (eski), **Ziraat**, ING, Alternatif, Türkiye Finans | Client/Merchant ID, API kullanıcı adı + şifre, Store Key (3D) | **Var** (`3D_PAY_HOSTING`) | entegrasyon.asseco-see.com.tr |
| **Akbank JSON API** (yeni) | Akbank | Merchant ID, Terminal ID, Secret Key | Var | apipre.akbank.com |
| **GVP** | **Garanti BBVA** | Terminal ID, Merchant ID, PROVAUT kullanıcı + şifre, Store Key | Var (3D Pay Hosting/OOS) | sanalposprovtest.garantibbva.com.tr |
| **PosNet (XML)** | **Yapı Kredi** | Merchant ID, Terminal ID, PosNet ID, ENCKEY (3D) | **Var: "Ortak Ödeme Sayfası (OOS)"** — açık kaynak kütüphanelerde yok, banka dokümanından yazılır | setmpos.ykb.com |
| PosNet V1 (JSON) | Albaraka | Merchant ID, Terminal ID, ENCKEY | doğrulanacak | epostest.albarakaturk.com.tr |
| **PayFlex V4 / Common Payment** | **Vakıfbank (VPOS 7/24)**, Ziraat, İş (alternatif) | Merchant ID, şifre, Terminal No | Var (Common Payment) | onlineodemetest.vakifbank.com.tr, cptest.vakifbank.com.tr |
| **PayFor** | **QNB Finansbank**, Enpara, Ziraat Katılım | Merchant ID, kullanıcı kodu + şifre, MbrId | Var | vpostest.qnb.com.tr |
| **InterPOS** | Denizbank | Shop Code, kullanıcı + şifre, Merchant Pass | Var | test.inter-vpos.com.tr (IP kısıtlı) |
| **BOA / TDV2.0** | **Kuveyt Türk**, Vakıf Katılım | Müşteri No, Kullanıcı Adı, Şifre (e-postayla gelir) | Vakıf Katılım var; Kuveyt Türk **doğrulanacak** (kaynaklar çelişiyor) | boatest.kuveytturk.com.tr |
| — | ING | NestPay üzerinden | var | — |
| (ödeme kuruluşu) | iyzico, Moka, Tosla, Param, PayTR | API key + secret | var | sandbox |

Kalın olanlar rakibin ekranındaki bankalar. **İlk sürüm için en yüksek kapsama:**
NestPay (İş, Halk, Ziraat, TEB…) + GVP (Garanti) + PosNet OOS (YKB) + PayFlex (Vakıf,
Ziraat) + PayFor (QNB) = 5 protokol, ~10 banka.

## 3. Bu modelin iki altyapı gerçeği

### a) Sabit IP şart
Bankalar sanal POS API çağrılarını yalnız **önceden bildirilen sunucu IP'lerinden** kabul
eder (beyaz liste; TCMB'nin ödeme kuruluşları için tebliğ zorunluluğu, bankalarda fiili
uygulama). Ortak ödeme sayfasına yönlendirme tarayıcıdan gider (IP sorunu yok) ama
**sonuç sorgulama, iade, iptal, taksit sorgusu sunucudan** gider — ve doğrulamanın
kaynağı sorgu olmalı. Vercel'in sabit çıkış IP'si **yok** → seçenekler:
- küçük bir sabit IP'li sunucu (VPS) üzerinde banka çağrılarını ileten dar bir proxy
  (yalnız banka host'larına, imzalı istek) — en ucuz, tam kontrol;
- Vercel Secure Compute (kurumsal plan);
- üçüncü taraf sabit IP proxy hizmeti.
Hangisi olacağı **kullanıcı kararı** (altyapı seçimi). KOBİ'ye "bankaya bildirilecek IP"
olarak bu adres verilir; başvuru ekranında yazılı durur.

### b) Banka webhook göndermez
Sonuç yalnız tarayıcı **callback**'iyle (okUrl/failUrl POST) gelir. Karşı taraf ödeyip
sekmeyi kapatırsa callback hiç gelmez, ama para çekilmiştir. Bu yüzden:
- callback = tetikleyici; **doğrulama = bankaya durum sorgusu** (order id ile);
- **bekleyen denemeler için mutabakat cron'u**: N dakikadır PENDING kalan her deneme
  bankadan sorgulanır, sonuç yazılır (mevcut cron altyapısı + sabit IP proxy).

## 4. Kobipo içinde mimari

### Adaptör katmanı
```ts
interface PaymentProvider {
  key: "nestpay" | "gvp" | "posnet" | "payflex" | "payfor" | "interpos" | "boa" | ...
  credentialFields: FieldDef[]                       // KOBİ ekranında sorulacak alanlar
  createHostedPayment(link, creds, urls): HostedForm  // bankaya POST edilecek form (tarayıcı)
  parseCallback(req, creds): CallbackResult           // hash doğrula, orderId/tutar çıkar
  queryStatus(orderId, creds): StatusResult           // KAYNAK BU
  refund(orderId, amount, creds); cancel(orderId, creds)
  testConnection(creds): ok | error                   // "Bağlantıyı test et"
}
```
Banka özgü tuzaklar adaptörde kalır: order id kısıtları (NestPay ≤64 alfasayısal, PosNet
24, Garanti 36), tutar biçimi (Garanti kuruş tam sayı, PosNet "12,34"), para birimi kodu
(949), hash algoritması (SHA-1/SHA-512, alan sırası), callback alan adları.

**Kütüphane kararı (kullanıcının):**
- `@voxyfy/anadolupay` (Node/TS, MIT, 30+ banka, 261 test) — ama "erken aşama":
  PHP kaynağı bankaların test ortamlarında doğrulanmış, **Node portu henüz gerçek
  sandbox'ta ölçülmemiş**. Doğrudan bağımlılık riskli; adaptör yazarken **referans**
  olarak kullanılabilir (hash sıraları, alan adları).
- `mewebstudio/pos` (PHP, olgun, bankalarda doğrulanmış) — referans; Kobipo PHP değil.
- Kendi adaptörlerimiz, banka dokümanı + yukarıdakiler referans, bankanın test
  ortamında ölçülerek. Protokol başına 1–2 gün.

### Veri modeli
- `PaymentProviderAccount` — **firma bazında** (sözleşme tüzel kişiye; şube ana
  firmanınkini kullanır): `provider`, şifreli `credentials`, `status`
  (KURULUM / TEST_GECTI / AKTIF / ASKIDA), `financialAccountId` (tahsilatın düşeceği
  banka hesabı), `installmentsEnabled`, `lastTestAt`, `notifiedIp`.
- `PaymentLink` — mevcut model genişler: `invoiceId` **opsiyonel** (serbest tutar),
  `providerAccountId`, `customerId?`, `description`, `amount` sabit, `expiresAt`
  zorunlu, tek/çok kullanım, `status`.
- `PaymentAttempt` — her deneme: `orderId` (bankaya giden, benzersiz), `providerTxnId`,
  `authCode`, `status` (PENDING/SUCCESS/FAILED/CANCELLED/REFUNDED), `errorCode/Msg`,
  `cardMask` (**yalnız BIN + son 4**), `installment`, `rawCallback`, `queriedAt`.
- `InvoicePayment` / `Transaction` (mevcut) — başarılı deneme buraya yazar; fatura yoksa
  cari tahsilatı (kasasız ödeme kuralı: `docs/finans/KASASIZ-ODEME.md`).

### Akış
```
KOBİ: (Finans → Online Tahsilat) tutar + açıklama [+ fatura / cari] → banka seç → link üret
      → paylaş: kopyala · e-posta · WhatsApp/SMS metni
Karşı taraf: /pay/<token>  → KOBİ ünvanı, tutar, açıklama, "Bankanın güvenli sayfasına git"
      → adaptör.createHostedPayment → tarayıcı bankaya POST → banka sayfasında kart + 3DS
      → banka okUrl/failUrl → /api/pay/callback/<provider>/<token>
      → parseCallback (hash) → queryStatus (KAYNAK) → PaymentAttempt SUCCESS
      → PaymentLink PAID → InvoicePayment + Transaction (VIRTUAL_POS hesabı) → cari düşer → makbuz e-postası
Cron: PENDING denemeleri bankadan sorgula (sekme kapanma senaryosu)
Banka: ertesi gün (taksitte blokeli) KOBİ hesabına yatırır; komisyon bankaya göre net/brüt
```

### Güvenlik / sağlamlık
- `/pay/<token>` **hiçbir zaman** kendi başına PAID yazmaz (2026-08 açığı,
  `PAYMENT_LINKS_ENABLED=false`'un sebebi). Yalnız banka sorgusu yazar.
- Callback tutarı ≠ link tutarı → ret + log; hash `timingSafeEqual`, fail-closed.
- Aynı orderId ikinci callback → idempotent; aynı link ikinci ödeme → 409.
- Token ≥ 32 bayt; süre; iptal. Oturumsuz uçlar yalnız `/pay/*` + callback; oran sınırı.
- Kimlikler şifreli, loglara girmez; "Bağlantıyı test et" bankanın test/sorgu ucuyla.
- Cari görünürlüğü: link üretme `assertCariVisible`'dan geçer.

### Modül / ürün
- `lib/modules.ts` → `payments` anahtarı (**mevcut firmalarda kapatan migrasyon** —
  deny-list tuzağı), nav "Finans → Online Tahsilat".
- Fiyatlama iki seçenek (**ürün kararı**): (1) rakip gibi banka başına yıllık
  `PricingItem` ("Sanal POS — Garanti"), (2) tek "Sanal POS" modülü + N banka hakkı.
  Abonelik/kota altyapısı ikisini de taşır; (1) `purchasedModules`'a banka başına
  anahtar demek — modül kaydı bankaya göre üretilir.
- Kurulum sihirbazı: "1) Bankanıza sanal POS başvurusu yapın (IP: x.x.x.x'i bildirin)
  2) Anahtarları girin 3) Bağlantıyı test edin 4) Aktif" — rakibin metniyle aynı adımlar.

### Muhasebe
- Banka = KOBİ'nin `FinancialAccount`'u (BANK); ara hesap `VIRTUAL_POS` (bugün
  kullanımda). Tahsilat ara hesaba, banka yatırınca virman; komisyon gider satırı
  (banka dekontuyla mutabakat; bazı bankalar net yatırır, bazıları komisyonu ay sonu keser).
- Rapor: bekleyen sanal POS bakiyesi, link dönüşümü, banka bazında komisyon.

## 5. Fazlar (kaba efor)

| Faz | İş | Efor |
|---|---|---|
| 0 | Kararlar: sabit IP yolu, kütüphane/adaptör, açılış bankaları, fiyatlama | — |
| 1 | Sabit IP proxy + banka test hesapları (NestPay/Garanti test ortamı ile geliştirme) | 1–2 gün |
| 2 | Çekirdek: adaptör arayüzü, şifreli kimlik + kurulum sihirbazı, link üretimi (serbest + faturadan), `/pay/<token>`, callback + sorgu, `PaymentAttempt`, idempotency, mutabakat cron'u | 4–5 gün |
| 3 | İlk iki protokol: **NestPay** (7+ banka) + **GVP** (Garanti), bankanın test ortamında uçtan uca | 3–4 gün |
| 4 | Muhasebe bağı, makbuz e-postası, iade/iptal, modül/fiyatlama, raporlar, güvenlik taraması | 3 gün |
| 5 | Protokol başına ekleme: PosNet OOS (YKB), PayFlex (Vakıf/Ziraat), PayFor (QNB), InterPOS, BOA | 1–2 gün/protokol |

Çekirdek + 2 protokol ≈ **10–13 gün**; her ek banka grubu 1–2 gün.

## 6. Repoda bugün ne var
- `PaymentLink` (faturaya bağlı) + `/pay/[token]` + `lib/faturalar/payment-links.ts`
  (`PAYMENT_LINKS_ENABLED=false`; sağlayıcısız "ödendi" açığı yüzünden kapalı).
- `lib/integrations/paytr/` — Kobipo'nun **kendi** abonelik tahsilatı; hash/fail-closed
  kalıpları kopyalanır, mağaza ayrı.
- `FinancialAccount.type = VIRTUAL_POS`, cron altyapısı, AES-256-GCM sır saklama.

## Kaynaklar
- TCMB rehberi §3.3 Sanal POS + md. 12/2 teknik hizmet muafiyeti (tcmb.gov.tr, PDF)
- Yapı Kredi POS: Ortak Ödeme Sayfası + POSNET 3D Secure XML dokümanı (yapikredipos.com.tr)
- Kuveyt Türk sanal POS kurulumu (banka e-postasıyla Müşteri No / Kullanıcı Adı / Şifre)
- Beyaz liste / IP kısıtı: İHS Teknoloji "Sanal POS API güvenliği ve whitelist"
- Protokol/banka matrisi ve test uçları: github.com/mewebstudio/pos (README + config/pos_test.php)
- Node/TS kütüphane: github.com/Voxyfy/anadolupay-node (`@voxyfy/anadolupay`, MIT, erken aşama)
- Rakip ekranı: banka başına 1.990 ₺+KDV/yıl, "banka üzerinden başvuru → API anahtarları → aktif et"
