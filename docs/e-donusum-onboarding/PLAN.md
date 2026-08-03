# Kobipo Üzerinden Mysoft E-Dönüşüm Self-Servis Hesap Açma

> **Amaç:** Müşteriler Mysoft ile **hiç muhatap olmadan**, doğrudan Kobipo üzerinden
> e-Dönüşüm (e-Fatura / e-Arşiv) hesabını açsın, ürünü aktive etsin ve fatura kessin.
> Kobipo, Mysoft'un **İş Ortağı (bayi)** olduğu için bunu bayi API kimliğiyle yapabilir.

> **Bu dosya oturumlar arası hafızadır.** Farklı bir bilgisayarda devam ederken önce
> bu dosyayı oku, "İlerleme Günlüğü"nden en son nerede kaldığımıza bak, ilgili fazdaki
> checkbox'lardan devam et. Her anlamlı adımda checkbox işaretle ve günlüğe satır ekle.

---

## 1. Mimari Karar — "Yol A" (bayi kimliği + tenantIdentifierNumber)

Tüm belge ve hesap işlemleri **tek bayi (İş Ortağı) API hesabıyla** yapılır. Hangi
müşteri adına işlem yapıldığı `tenantIdentifierNumber = müşterinin VKN'si` alanıyla
belirtilir. Müşterinin kendi Mysoft kullanıcı adı/şifresi **hiç olmaz**.

**Neden:** Mysoft dokümanı (`swagger-v8.json:75`) `tenantIdentifierNumber` için birebir
şunu diyor: *"İşlem yapılması istenen müşterinin VKN/TCKN'si gönderilir. Servis
kullanıcısına birden fazla müşteri bağlandıysa kullanılacak bir alandır."* Bu alan tüm
InvoiceOutbox/InvoiceInbox uçlarında var. Kontör yükleme zaten bu modelle çalışıyor
(`lib/kontor/fulfill.ts` → `insertDocumentCredit`).

Bayi kimliği env'de: `MYSOFT_PARTNER_USERNAME` / `MYSOFT_PARTNER_PASSWORD` /
`MYSOFT_PARTNER_API_URL` → `lib/integrations/e-invoice/partner.ts` (`createPartnerProvider()`).

## 2. Mysoft'tan Beklenen (BLOKAJLAR — API dışı)

**A) Mükellef sorgulama paketi (✅ ÇÖZÜLDÜ — 2026-07-07):** addTenant içeride "mükellef
sorgulama" yapıyor; bayi API hesabının bu iş için aktif paketi yoktu
(*"Mükellef sorgulama işlemi için aktif bir paketiniz bulunmamaktadır..."*).
- Durum: ✅ Paket **CANLI bayi hesabına** (rifaterenn@gmail.com) tanımlandı ve doğrulandı.
  Salt-okunur teşhis (`getGibAccountModel` VKN 6271036106) canlı ortamda gerçek GİB verisi
  döndü ("MYSOFT DİJİTAL DÖNÜŞÜM A.Ş."). Paket/limit hatası YOK. addTenant artık geçmeli.

**B) Muvafakatname / sözleşme (✅ KAPANDI — 2026-08-03, Mysoft'a sormaya gerek kalmadı):**

Soru şuydu: bir mükellefi bayi olarak API ile aktive ederken ıslak/e-imzalı bir evrak
gerekiyor mu? **Cevap: hayır, ayrı evrak akışı kurmuyoruz.** Yetkilendirme evrakla değil,
yolun kendisine gömülü olarak veriliyor — bkz. §3.1. Kısaca:

- **e-Arşiv'de yetki = İVD şifresi.** Kullanıcı İnteraktif Vergi Dairesi kimliğini vererek
  "benim adıma başvur" demiş oluyor. Rakip doğrulaması: Paraşüt'ün "e-Arşiv Fatura
  (İnteraktif)" akışı da tam olarak İVD kullanıcı kodu + şifre + VKN istiyor ve
  *"Başvuru esnasında mali mühür ve e-imza almanız gerekmez"* diyor.
- **e-Fatura'da yetki = mali mührün kendisi.** Mühürle imzalamak zaten hukuki
  yetkilendirmedir, üstüne kâğıt gerekmez. (Bu yol şimdilik kapsam dışı — §3.1.)
- **Kobipo–kullanıcı ilişkisi** → uygulama içi onay kutusu + zaman damgası/IP kaydı
  (Faz 6.3). Paraşüt'teki "Sözleşme onayı → KAYDET VE BİTİR" adımının karşılığı.

Mysoft kendi bayi-müşteri sözleşmesi için ayrıca evrak isterse, bu **bizimle Mysoft
arasında** hallolur — müşterinin akışına girmez, akışı bloke etmez.

## 3. API Bulguları (tekrar araştırma yapma — referans)

Kaynak: `swagger-v8.json` (= https://edocumentapi.mysoft.com.tr/index.html, versiyon v8).
Test ortamı: `https://edocumentapi.mytest.tr`.

| İşlem | Endpoint | Model / Not |
|---|---|---|
| Firma aç | `POST /api/Tenant/addTenant` | `ApiTenantModel` (satır 19765). Zorunlu: `tenantName, shortName, vknTckn, registerNo, email`. `addTariffToTenant:true` bayi tarifelerini devreder. Dönüş: `Int32ResultModel` → `data` = yeni tenant id. Adres (`tenantAdress`) **opsiyonel**. |
| Ürün aktive et | `POST /api/Tenant/addTenantActivation` | `ApiTenantActivationModel` (satır 19414). Zorunlu: `id`(=0), `activationDemandDate`, `activationProductType`. E-Fatura/E-Arşiv/E-İrsaliye'de `serialNumberPrefix` zorunlu; E-Fatura/E-İrsaliye'de `activationAlias` (posta kutusu) zorunlu. |
| Aktivasyon durumu | `GET /api/Tenant/getTenantActivation?vknTckn=` | `ApiTenantActivationGetModel` (19290). `activationDemandStatus`: `WillBeSendToGib → SentToGib → Approved / Canceled / Error / Wait / Close`. `gibServiceStatus`/`gibServiceMessage` = GİB başvuru durum kodu/açıklaması. |
| (ops.) Sözleşme+kontör | `POST /api/Tenant/addTenantPreContract` | `ApiTenantPreContractModel` (20049). `isLoadCredit:true` ile ilk kontörü otomatik yükler. Zorunlu: `vknTckn, tariffCode, qty, startDate, isLoadCredit`. |
| (ops.) Firma kullanıcısı | `POST /api/Tenant/addTenantUser` | `ApiTenantUserModel` (20234). **Şifre alanı YOK** → Mysoft e-posta ile yolluyor. Yol A'da GEREKMEZ. |
| Vekâleten belge | InvoiceOutbox/InvoiceInbox uçları | `tenantIdentifierNumber` = müşteri VKN'si (satır 75). |

Ürün tipleri (`activationProductType`, string enum): `EInvoice`, `EArchive`, `EDespatch`,
`EBook`, `ESEVoucher`, `EProducerVoucher`, `EExchangeDocument`, `EBillDocument`,
`GIBEArchiveInvoice`, `Agreement`, `PreAccounting`, ... (tam liste 19443).

Nested modeller: `TenantAdressModel` (45777) → `country`/`city` = `GeneralLookupModel`
`{code,name}` (32375); `citySubdivision`(ilçe) zorunlu. `TaxOfficeLookupModel` (45171) =
`{taxOfficeCode, taxOfficeName}`. `ApiActivationAliasModel` (19271) = `{aliasPrefix, domainName}`.

## 3.1 Yetkilendirme: İVD vs. mali mühür (2026-08-03 araştırması — tekrar araştırma yapma)

**Kritik bulgu:** `ApiTenantActivationModel`'de `iVdUsername` + `iVdPassword` alanları var
(İnteraktif Vergi Dairesi kullanıcı adı/şifresi). GİB başvurusunu Mysoft **mükellefin kendi
İVD kimliğiyle** yapıyor. `getTenantActivation`'ın `gibServiceStatus`/`gibServiceMessage`
açıklaması da bunu doğruluyor ("aktivasyon başvuru **dosyasının** GİB tarafındaki durumu").

**Swagger tam metin taraması** (kesin, tekrar bakma): `mühür` **0**, `e-imza` **0**,
`sertifika` **0**, `muvafakat` **0** geçiş. `İnteraktif` 6 geçiş — 2'si aktivasyon modeli,
4'ü **ilgisiz** bir uç (`TenantPublicIntegrationSaveRequestModel` → `addTenantPublicIntegration`,
GİB'den e-Arşiv gelen kutusu çekmek için; `publicIntegrationType: İVD(1)/E-Beyanname(2)/
Türmob(3)` seçenekleri ORADA, aktivasyonda değil — alternatif sanıp peşine düşme).

→ **Aktivasyonda İVD dışında yetkilendirme mekanizması YOK.** Sertifika/mühür API'den
geçemez: özel anahtar token'ın güvenli yongasından çıkmaz, imzalama token'ın takılı olduğu
makinede olur. Bu bir eksiklik değil, tasarım gereği.

**e-Arşiv ile e-Fatura farkı (neden biri mühürsüz, diğeri değil):**

| | e-Arşiv | e-Fatura |
|---|---|---|
| Mükellefin mührü | **Gerekmez** | **Gerekli** (tüzel: mali mühür, gerçek kişi: e-imza) |
| Neden | GİB'e sadece raporlama; imzayı özel entegratör kendi mührüyle atar | Mükellef GİB e-Fatura **ağına kayıt** olur; posta kutusu/etiket doğrudan kendi sertifikasına bağlanır → mühür imza aracı değil, **kimliğin kendisi** |
| Başvuru | İVD kullanıcı kodu + şifre, uygulama içinde, dakikalar | Mühür siparişi (Kamu SM, 3–10 gün, ücretli) → mühürle GİB başvurusu → sonra aktivasyon |
| Uygulama dışı adım | Yok | **Var** — token'la imzalama kullanıcının kendi makinesinde |

**Rakip doğrulaması (Paraşüt):** İkiye ayırmışlar. e-Arşiv (İnteraktif) = İVD kullanıcı kodu
+ şifre + VKN, mühürsüz, dakikalar içinde "HİZMET DEVREDE". e-Fatura = mali mühür zorunlu,
ve o yolu yazılımla değil **insanla** çözüyorlar ("Anahtar Teslim e-Fatura" = ücretli
danışman hizmeti; kendi rehberlerinde "destek ekibine e-posta gönderin" diyorlar). Yani
e-Fatura'da mühür şartını atlayan teknik bir yol yok — kimsede yok.

**Not (Paraşüt rehberinden):** e-Arşiv (İnteraktif) için **İVD'ye kayıtlı telefon numarası**
gerekiyor (muhtemelen SMS doğrulaması). Sihirbazda önceden uyar, yoksa kullanıcı orada takılır.

**Kapsam dışı bırakılanlar (2026-08-03 kararı):**
- **e-Fatura** — mühür gerektirdiği ve uygulama dışı adım içerdiği için şimdilik tamamen
  bir kenarda. Route seviyesinde de kapalı tutulacak (yanlışlıkla canlı başvuru açılmasın).
- **ÖKC / yazarkasa yolu** (`addVuk507Activation`, `serviceOperatorType: 1=İdeal, 2=Pavo`)
  — yeni nesil ÖKC TSM'i üzerinden aktivasyon. Sihirbazda seçenek olarak bile durmayacak.

## 4. Veri Modeli Değişiklikleri (Company)

`prisma/schema.prisma` + `supabase/migrations/*_company_edonusum_onboarding.sql`:

- `eDonusumOnboardingStatus String?` — `NONE | TENANT_CREATED | ACTIVATION_PENDING | ACTIVE | FAILED`
- `eDonusumTenantCreatedAt DateTime?`
- `eDonusumActivatedProducts String[] @default([])` — ör. `["EInvoice","EArchive"]`
- `eDonusumActivationError String? @db.Text`

> ⚠️ Şema kolonları eklendikten sonra DB'ye uygulanmalı: dev server kapalıyken
> `npm run db:push` (veya Supabase migration'ı push et). Uygulanmazsa onboarding
> route'u DB update'te patlar.

## 5. Fazlar

### Faz 0 — Dokümantasyon & Şema
- [x] Plan dosyası (bu dosya)
- [x] `Company` şema alanları (Faz 4 durum takibi için)
- [x] Supabase migration dosyası
- [x] `npm run db:push` ile DB'ye uygula (2026-07-06 çalıştırıldı)

### Faz 1 — Provider metodları (bayi)
- [x] `createTenant()` — `addTenant`
- [x] `activateProduct()` — `addTenantActivation`
- [x] `getTenantActivationStatus()` — `getTenantActivation`
- [x] `addPreContract()` + `getPreContract()` — **opsiyonel DEĞİL, aktivasyon ön koşulu**
      (2026-08-03 canlı bulgu; bkz. günlük 19). `isLoadCredit:false` ile çağrılıyor:
      sözleşme tanımlanır, kontör YÜKLENMEZ (kontör ayrı akış).

### Faz 2 — Onboarding API
- [x] `POST /api/e-donusum/onboarding` — VKN doğrula → `createTenant` → `activateProduct`
      (ürün başına) → `Company` durumunu yaz. Idempotent (tenant varsa atlar, "zaten
      kayıtlı" hatasını tolere eder) + `SystemLog`.
- [x] `GET /api/e-donusum/onboarding/status?companyId=` — `getTenantActivationStatus`
      ile GİB durumunu poll et; tüm başvurulan ürünler onaylıysa `status=ACTIVE` yap.
- [ ] (sonra) İstek gövdesine VKN'nin e-Fatura mükellefi olup olmadığını `check-vkn` ile
      otomatik belirleyip ürün önerisi — şimdilik ürünler UI'dan açık geliyor.

**Sözleşme (request body):**
`POST` → `{ companyId, registerNo?, email?, products: [{ type, serialNumberPrefix,
internetSerialNumberPrefix?, aliasPrefix?, aliasDomain? }] }`. `type` ∈
{EInvoice, EArchive, EDespatch, ESEVoucher, EProducerVoucher}. EInvoice/EArchive/EDespatch
için `serialNumberPrefix` (3 karakter) zorunlu. Dönüş: `{ success, tenantId?, status,
activations: [{type, ok, activationId?, error?}], error? }`.
`GET /status` → `{ success, status, allApproved, submitted, activations: [{productType,
demandStatus, state: approved|error|pending, gibServiceStatus, gibServiceMessage,
serialNumberPrefix}] }`.

> ⚠️ **Açık noktalar (test ederken doğrula):** (1) `registerNo` şahıs firmasında yok →
> boşsa VKN gönderiliyor; Mysoft reddederse UI'dan alınmalı. (2) `taxOffice` için sadece
> ad gönderiliyor (kod yok); Mysoft kod isterse vergi dairesi lookup'ı eklenecek.
> (3) Adres `createTenant`'ta şimdilik gönderilmiyor (opsiyonel) — gerekirse eklenecek.

**Mysoft hata kodları (test 2026-07-06'da görüldü):**
- `00208` = "Firma zaten başka bir iş ortağı/sistem tarafından açılmış" → VKN **bize bağlı
  değil**, kullanamayız. (Mysoft demo VKN'si `6271036106` bu durumda.)
- `00180` = "Girilen bilgilere uygun firma bulunamadı" → `getTenantActivation`/aktivasyon
  bizim servis kullanıcımıza bağlı olmayan firmada bunu döner.
- **Düzeltme:** `createTenant` hata verince artık kör "devam" YOK. `getTenantActivationStatus`
  ile prob atılıyor: succeed dönerse firma bizimdir → devam; dönmezse (00180) → 409
  `TENANT_NOT_OURS` ile net hata. Böylece 00208 → yanıltıcı 00180 zinciri bitti.
- **Test için VKN:** `6271036106` başkasının altında; taze/boşta bir VKN gerekli. Checksum
  geçerli sahte VKN üretici doğrulandı (bkz. günlük). Aktivasyonun test-GİB'de sahte VKN
  kabul edip etmediği açık → Mysoft'a "test mükellef VKN/TCKN seti var mı?" sorulacak.

### Faz 3 — UI Sihirbazı
- [x] `E-Dönüşüm Ayarları` ekranı başvuru sihirbazına çevrildi: ürün seçimi (E-Arşiv/E-Fatura)
      + 3 karakter seri ön ek + "Başvur ve Aktive Et" → `POST /api/e-donusum/onboarding`.
      Seri ön ekler `eArchivePrefix`/`eFaturaPrefix`'ten ön-dolu.
- [x] Aktivasyon durumu göstergesi: banner'da durum rozeti + "Durumu Yenile" (`GET /status`)
      ile GİB satırları (onaylandı/bekliyor/hata).
- [x] Elle kimlik giriş kartı "Gelişmiş — Mevcut Mysoft hesabımı elle bağla" collapsible'ına
      indirildi (ortam + kullanıcı/şifre + Test Bağlantısı orada).
- [~] Muvafakat dijital onay adımı → **Faz 6.3'e taşındı** (Karar #2 kapandı, §2-B/§3.1).

Değişen dosyalar: `app/(dashboard)/ayarlar/e-donusum/page.tsx` (yeniden yazıldı),
`app/api/companies/[id]/route.ts` (GET select'e 4 onboarding alanı eklendi).

### Faz 4 — Belge işlemlerini bayi kimliğine taşı
- [x] Merkezî çözümleyici `lib/integrations/e-invoice/company-provider.ts`
      (`resolveCompanyEInvoiceProvider`): firmanın kendi kimliği varsa **manuel** (mevcut
      davranış birebir korunur), yoksa bayi altında açıldıysa **bayi provider +
      `tenantIdentifierNumber = firma VKN'si`**. `createPartnerProvider(vknTckn?)` opsiyonel
      VKN alacak şekilde genişletildi. Ortak `COMPANY_PROVIDER_SELECT` alan kümesi.
- [x] `sendInvoice` (send-invoice-helper + `invoices/route.ts` POST create+send), `getInvoiceStatus`
      (status + check-status), iptal (cancel), pdf, inbox (liste/sync/detay/pdf/respond) ve
      numaratör uçları çözümleyiciye bağlandı. Manuel yol her uçta öncelikli; bayi yol yalnızca
      kimlik yoksa devreye girer.
- Not: `e-irsaliye/[id]/{send,status}` şu an `createEInvoiceProvider()`'ı argümansız çağırıyor
      → MOCK provider (Mysoft'a bağlı değil, bitmemiş ayrı özellik). Onboarding kapsamı dışı,
      DOKUNULMADI (sessizce canlıya çevirmek beklenmedik gerçek e-İrsaliye gönderimi yaratırdı).
- [x] Onboarding tüm ürünler onaylanınca (`status=ACTIVE`) `isEDonusumEnabled=true` yapılıyor
      → bayi firmada fatura kesme akışı açılıyor (send-helper'ın isEDonusumEnabled kapısı).
- [ ] (test) Bayi firmada gerçek fatura kes / gelen fatura çek — Mysoft firma-ekleme yetkisi
      + aktif tenant gerektirir; kod hazır, uçtan uca test yetki gelince.
- Not (kapsam dışı, gerekirse aynı desenle taşınır): `templates/*` (belge tasarımı),
      `withholding-types`, `discover-*`/`verify-tenant-vkn` (teşhis) hâlâ per-firma kimliği
      bekliyor — çekirdek fatura akışı için gerekli değil.

### Faz 5 — Kontör entegrasyonu & test
- [x] **(5.1)** Aktivasyon sonrası kontör satın almaya yönlendir: onboarding sihirbazında
      tenant açıldıysa (`TENANT_CREATED`/`ACTIVATION_PENDING`/`ACTIVE`) yeşil CTA →
      "Kontör Yükle" butonu `/e-donusum/kontor?company=<id>`'ye götürür (mevcut kontör akışı).
- [ ] **(5.2)** Test ortamında (`mytest.tr`) uçtan uca: firma aç → aktive et → durum sorgula →
      kontör yükle → fatura kes. ⛔ Mysoft test firma-ekleme yetkisi bekliyor (00030).
- [ ] **(5.3)** Canlıya (`mysoft.com.tr`) geçiş — Karar #2 (hukuk) çözüldükten sonra.

### Faz 6 — e-Arşiv + İVD self-servis başvuru  ← **AKTİF İŞ**

Kapsam kararı (2026-08-03): **yalnızca e-Arşiv + İVD.** e-Fatura ve ÖKC/VUK507 kapsam dışı
(§3.1). Hedef: kullanıcı Kobipo'dan çıkmadan, mühürsüz, dakikalar içinde e-Arşiv hesabını
açsın.

Hedef akış:
1. Ürün: e-Arşiv (tek seçenek) → 2. İVD kullanıcı kodu + şifre → 3. Yetkilendirme onayı →
4. `addTenantActivation` (İVD bilgileriyle) → 5. `getTenantActivation` ile durum takibi.

- [x] **6.1 Provider** (`mysoft-provider.ts:511` `activateProduct`): params'a
      `iVdUsername`/`iVdPassword` ekle, body'ye koşullu yaz. Credential'ı **log'a basma**;
      hata dönüşünde `raw` içinde geri sızdırma (`:546` mevcut log yalnız response basıyor,
      öyle kalsın).
- [x] **6.2 Route** (`app/api/e-donusum/onboarding/route.ts`): body'den `ivdUsername` /
      `ivdPassword` / `consentAccepted` al. e-Arşiv için İVD zorunlu → yoksa 400.
      `EInvoice`/`EDespatch` gelirse 400 "şimdilik desteklenmiyor" (kapsam dışı ürünle
      yanlışlıkla canlı GİB başvurusu açılmasın). Credential **DB'ye yazılmaz**.
- [x] **6.3 Onay kaydı:** `consentAccepted` zorunlu; kabul anı + IP (`x-forwarded-for`) +
      userId → `SystemLog` (`action: EDONUSUM_ONBOARDING_CONSENT`). Şema değişikliği YOK.
- [x] **6.4 UI** (`ayarlar/e-donusum/page.tsx:594`): e-Fatura satırı devre dışı ("Yakında"
      rozeti + mali mühür gerekçesi notu; `ProductRow`'a `disabled`/`badge`/`note` eklendi).
      İVD kullanıcı kodu + şifre alanları (`type=password`, `autoComplete=off`).
      "İVD'ye kayıtlı telefon numaranız olmalı" uyarısı. Şifresi olmayan/bilmeyen için
      ivd.gib.gov.tr yönlendirmesi + "mali müşavirinizde olabilir" notu. Yetkilendirme
      onay kutusu. **Submit sonrası şifre state'i temizlenir.**
- [ ] **6.5 Test:** gerçek firmada e-Arşiv aktivasyonu → `getTenantActivation` →
      `gibServiceStatus`/`gibServiceMessage` gözlemi. Bu aynı zamanda "İVD tek başına
      yeterli mi" sorusunun **ampirik** cevabıdır — GİB ne isterse orada yazar.

> 🔒 **Değişmez güvenlik kuralı:** İVD şifresi vergi hesabının tamamına erişim verir
> (beyanname, borç, tebligat). Yalnızca istek gövdesinde taşınır: DB'ye, `SystemLog`'a,
> console'a, SWR cache'ine, hata mesajına **girmez**. Pass-through, saklama yok.

## 6. Dosya Haritası

| Dosya | Rol |
|---|---|
| `lib/integrations/e-invoice/mysoft-provider.ts` | Provider metodları (createTenant/activateProduct/getTenantActivationStatus) |
| `lib/integrations/e-invoice/partner.ts` | Bayi kimliği + `createPartnerProvider(vknTckn?)` |
| `lib/integrations/e-invoice/company-provider.ts` | **Faz 4** çözümleyici: manuel vs bayi provider seçimi (belge uçları) |
| `app/api/e-donusum/onboarding/route.ts` | Onboarding orkestrasyonu (Faz 2 — TODO) |
| `app/api/e-donusum/onboarding/status/route.ts` | Aktivasyon durum poll (Faz 2 — TODO) |
| `app/(dashboard)/ayarlar/e-donusum/page.tsx` | Sihirbaz UI (Faz 3 — TODO) |
| `prisma/schema.prisma` | Company onboarding alanları |
| `supabase/migrations/20260706000001_company_edonusum_onboarding.sql` | Kolon migration'ı |

## 7. Ortam Değişkenleri

```
MYSOFT_PARTNER_USERNAME=...      # bayi API kullanıcısı
MYSOFT_PARTNER_PASSWORD=...      # bayi API şifresi
MYSOFT_PARTNER_API_URL=...       # opsiyonel; boşsa canlı (MYSOFT_PROD_URL)
```
Test için onboarding'i `MYSOFT_TEST_URL` (`https://edocumentapi.mytest.tr`) ortamında
denemek istersek bayi test kimliğiyle `MYSOFT_PARTNER_API_URL`'i test URL'sine çek.

## 8. İlerleme Günlüğü

- **2026-07-06 (1)** — Proje başlatıldı. Dokümanla mimari doğrulandı (Yol A). Plan dosyası
  oluşturuldu. Faz 0 şema alanları + migration eklendi (db:push kullanıcıya bırakıldı).
  Faz 1 provider metodları (`createTenant`, `activateProduct`, `getTenantActivationStatus`)
  yazıldı. Mysoft'a muvafakat sorusu (Karar #2) soruldu, cevap bekleniyor.
- **2026-07-06 (2)** — Kullanıcı `npm run db:push` çalıştırdı (Faz 0 bitti). Tasarım kararı:
  onboarding **register akışında değil, E-Dönüşüm Ayarları ekranında** yapılacak. Faz 2
  route'ları yazıldı: `POST /api/e-donusum/onboarding` + `GET /api/e-donusum/onboarding/status`.
  `tsc` temiz.
- **2026-07-06 (3)** — Faz 3 UI sihirbazı bitti. E-Dönüşüm Ayarları ekranı yeniden yazıldı
  (ürün seçimi + seri ön ek + Başvur/Durumu Yenile); elle kimlik girişi "Gelişmiş" bölümüne
  indirildi. companies GET'e 4 onboarding alanı eklendi. Proje geneli `tsc` 0 hata.
  **Sıradaki: UI üzerinden gerçek test.** Kullanıcı `.env`'e bayi TEST kimliğini
  (`MYSOFT_PARTNER_USERNAME/PASSWORD`, `MYSOFT_PARTNER_API_URL=https://edocumentapi.mytest.tr`)
  girip `npm run dev` ile ekrandan "Başvur ve Aktive Et" deneyecek. Açık payload noktaları
  (registerNo/taxOffice kodu/adres) ilk gerçek çağrıda netleşecek → Faz 2 §"Açık noktalar".
  Test OK olursa **Faz 4** (belge gönderimini bayi + tenantIdentifierNumber'a taşıma).
- **2026-07-06 (4)** — İlk gerçek TEST çağrısı yapıldı (VKN 6271036106). Sonuç: addTenant
  `00208` (firma başka iş ortağı altında), ardından aktivasyon `00180`. Teşhis: 6271036106
  Mysoft demo VKN'si, bize bağlı değil. Kod düzeltildi (createTenant hatasında
  getTenantActivation prob'u ile "bizim mi" ayrımı → 409 TENANT_NOT_OURS). Kullanıcıya taze
  checksum-geçerli test VKN'leri üretildi.
- **2026-07-06 (5)** — Taze VKN 4457389606, E-Arşiv aktivasyonu hep `00180`. E-Arşiv'de
  `internetSerialNumberPrefix` da zorunlu diye onu eklendik (Swagger 19454) — ama 00180 sürdü.
- **2026-07-06 (6)** — **KÖK NEDEN BULUNDU.** Prob mantığı `createTenant` hatasını gizliyormuş.
  `force:true` teşhisiyle gerçek addTenant yanıtı görüldü: `00081 "Vergi dairesi tanımı
  bulunamadı. Ad: pamukkale"`. Yani createTenant HİÇ başarılı olmamış; serbest metin vergi
  dairesi ("pamukkale") reddediliyor. 00180 sadece bunun yan etkisiymiş.
  **Düzeltmeler:** (a) prob kaldırıldı, createTenant başarısızsa NET hata + DUR (aktivasyona
  geçme), timestamp yalnızca başarıda yazılır; (b) `force` param'ı eklendi (teşhis/retry);
  (c) provider'a `listTaxOffices()` (`GET /api/GeneralCard/taxOffice`) eklendi; (d) route
  firmanın vergi dairesini bu listeyle eşleyip **kod+resmi ad** gönderiyor (normalizeTr ile
  Türkçe eşleme), eşleşmezse taxOffice'i hiç göndermiyor.
  **Sıradaki:** kullanıcı `force:true` ile tekrar deneyecek → addTenant artık başarılı olmalı
  → aktivasyon sonucunu göreceğiz. Sonra Faz 3.1'de UI'a vergi dairesi seçici eklenebilir.
- **2026-07-06 (7)** — force retry → vergi dairesi hatası geçti, yeni hata `00094 "Firma Adres
  bilgisi alanları zorunludur"`. Yani addTenant adresi ZORUNLU tutuyor (swagger'da opsiyonel
  görünse de). Düzeltme: provider'a `listCities()` (`GET /api/GeneralCard/city`) eklendi;
  route company.city'yi şehir listesiyle eşleyip `tenantAdress` gönderiyor (ülke sabit TR,
  şehir kod+ad lookup'tan, ilçe/citySubdivision şimdilik il ile dolduruluyor, streetName=
  company.address, buildingNumber="1"). company select'ine city+address eklendi.
- **2026-07-07 (8)** — Kullanıcı VKN'yi kısa süre 6271036106 (Mysoft'un kendi VKN'si) yaptı →
  `00208` (açılamaz, başkasının). Kavram netleştirildi: gelen fatura için KENDİ VKN'si aktive
  edilmeli, Mysoft'un VKN'si değil. VKN 4457389606'ya dönüldü. force retry sonucu:
  **payload TAMAMEN DOĞRU** — tüm alan doğrulamaları (vergi dairesi + adres) geçti. Yeni hata
  KOD DEĞİL, HESAP: addTenant içeride "mükellef sorgulama" yapıyor ve **test bayi API hesabının
  bu işlem için aktif paketi/limiti yok** ("Mükellef sorgulama işlemi için aktif bir paketiniz
  bulunmamaktadır veya paket limitiniz yetersizdir"). ⛔ **BLOKAJ (Mysoft provizyon):** test
  bayi hesabına firma açma + mükellef sorgulama paketi tanımlanmalı. Kullanıcı Mysoft'a soracak.
  **Kod tarafı createTenant için TAMAM.** Paket açılınca retry → addTenant geçmeli → aktivasyon.
  Bu arada Faz 4 (belge gönderimini bayi+tenantIdentifierNumber'a taşıma) YAZILABİLİR (test için
  aktif tenant gerektiğinden ancak paket sonrası TEST edilir).
- **2026-07-07 (9)** — Mysoft paketi beklenirken proje BEKLEMEDE. Kullanıcı diğer site
  kısımlarını geliştirmeye devam edecek. UI kararı: E-Dönüşüm Ayarları ekranı ESKİ haline
  döndürüldü (ortam + API kimlik girişi ana içerik). Onboarding başvuru sihirbazı en alta,
  **kapalı (collapsed) "Beta"** bölüm olarak taşındı — mantık/işlevsellik korunuyor, sadece
  gizli. Kod hazır; paket gelince o bölüm açılıp test edilecek. tsc 0 hata.
- **2026-07-07 (10)** — ✅ **BLOKAJ KALKTI: mükellef sorgulama paketi alındı.** Artık
  onboarding uçtan uca test edilebilir. Env durumu: `MYSOFT_PARTNER_USERNAME/PASSWORD` dolu,
  `MYSOFT_PARTNER_API_URL` BOŞ → bayi çağrıları şu an CANLI (`MYSOFT_PROD_URL`) ortama gidiyor.
  ⚠️ Test etmeden önce netleştirilecek: paket TEST bayi hesabına mı yoksa CANLI'ya mı tanımlandı?
  Test hesabındaysa `MYSOFT_PARTNER_API_URL=https://edocumentapi.mytest.tr` set edilmeli.
  **Sıradaki:** doğru ortam ayarıyla `force:true` retry → addTenant geçmeli → aktivasyon sonucu.
- **2026-07-07 (11)** — ✅ **BAĞLANTI DOĞRULANDI.** Kullanıcı: paket CANLI bayi hesabına
  tanımlandı → `MYSOFT_PARTNER_API_URL` boş bırakıldı (çağrılar zaten canlıya gidiyor, env
  değişikliği gerekmedi). Salt-okunur teşhis çalıştırıldı (token + `getGibAccountModel`):
  (1) bayi kimliği (rifaterenn@gmail.com) canlı ortamda token aldı; (2) mükellef sorgulama
  VKN 6271036106 için gerçek GİB verisi döndü ("MYSOFT DİJİTAL DÖNÜŞÜM A.Ş.", e-Fatura
  2019-07-01), paket/limit hatası YOK. Blokaj kesin olarak kalktı.
  **Sıradaki:** gerçek firma açma testi — E-Dönüşüm Ayarları > (alt) Beta sihirbazından bir
  firma için "Başvur ve Aktive Et" → addTenant + aktivasyon sonucu izlenecek. ⚠️ Bu CANLI
  ortam: açılan firma GERÇEK GİB başvurusu olur; test için dikkatli/uygun bir firma seçilmeli.
- **2026-07-07 (12)** — ⚠️ **TEST ORTAMI KURULUMU YOK.** Kullanıcının canlıda açacak gerçek
  firması yok → önce test ortamında (mytest.tr) denemek istendi. Aynı bayi kimliğiyle test
  ortamı prob edildi (`--test`): `POST mytest.tr/oauth/token` → **400 "Kullanıcı tanımsızdır"**.
  Yani canlı bayi hesabı (rifaterenn@gmail.com) test ortamında YOK — Mysoft'ta test/canlı ayrı
  sistemler, ayrı hesaplar. **Önemli düzeltme:** `MYSOFT_PARTNER_API_URL` hep boş olduğundan
  önceki TÜM denemeler (madde 4–8) aslında CANLI'ya gidiyormuş; "test bayi hesabı" ifadesi
  yanlıştı. Gerçek bir test ortamı kurulumumuz hiç olmadı.
  **Blokaj (yeni):** test ortamında firma açma denemesi için Mysoft'tan AYRI **test bayi
  kullanıcı adı/şifresi** (mytest.tr'de tanımlı) gerekiyor. Alınırsa `.env.local`'e ayrı
  değişkenlerle konup `MYSOFT_PARTNER_API_URL=https://edocumentapi.mytest.tr` ile test edilir.
  Alternatif: canlıda kullanıcının KENDİ firmasıyla gerçek onboarding (asıl üretim kullanımı).
- **2026-07-07 (13)** — ✅ **TEST BAYİ KİMLİĞİ BULUNDU** ama yeni blokaj. Kullanıcı test API
  kimliğini verdi: `rifaterenn@gmail.com` / şifre farklı (canlı `Rey159753+`, TEST ayrı şifre).
  mytest.tr'de token alındı; **mükellef sorgulama TEST'te de çalışıyor** (paket aktif).
  Uçtan uca deneme (sahte checksum-geçerli VKN, Denizli/Pamukkale) yapıldı:
  vergi dairesi lookup OK (1050 kayıt, Pamukkale VD 20280 eşleşti); **şehir listesi TEST'te
  yalnız 1 kayıt** (sandbox kısıtlı) → cityCode boş; **addTenant → `00030` "Firma ekleme
  yetkisine sahip değilsiniz"**. Yani TEST bayi hesabında **firma ekleme (addTenant) yetkisi
  YOK** (mükellef sorgu var, tenant-create yok). Canlı hesapta bu yetki VAR (canlı denemeler
  00081/00094 alan-doğrulamasına kadar ilerlemişti = yetki geçilmişti).
  ⛔ **BLOKAJ:** Mysoft'un TEST bayi hesabına **firma ekleme yetkisi** tanımlaması gerekiyor
  (veya bu yetkiye sahip düzgün bir test bayi hesabı vermesi). Kod tarafı tamam; payload doğru.
  Alternatif hâlâ: canlıda kullanıcının KENDİ firmasıyla gerçek onboarding.
  NOT: env DEĞİŞTİRİLMEDİ — testler scratchpad script'iyle (kimlik yalnız env-var'la) yapıldı,
  canlı `.env.local` (MYSOFT_PARTNER_* → canlı) olduğu gibi duruyor.
- **2026-07-07 (14)** — Test blokajı kenara bırakıldı; kalan iş KOD olarak bitirildi. **FAZ 4
  TAMAM.** Yeni merkezî çözümleyici `company-provider.ts` (`resolveCompanyEInvoiceProvider`):
  firmanın kendi Mysoft kimliği varsa MANUEL (mevcut/çalışan davranış birebir korunur), yoksa
  bayi altında açıldıysa BAYİ (master bayi + `tenantIdentifierNumber = firma VKN`). Tüm belge
  uçları buna bağlandı: send-invoice-helper, invoices/[id]/{status,check-status,cancel,pdf},
  inbox/{route(live),sync,[uuid]/route,[uuid]/pdf,[uuid]/respond}, numerators. `partner.ts`
  → `createPartnerProvider(vknTckn?)`. onboarding/status → tüm ürün onaylanınca
  `isEDonusumEnabled=true`. Tasarım ilkesi: bayi yolu EKLEMELİ — manuel kimlikli firmalar hiç
  etkilenmez (riski sınırlar; çünkü uçtan uca test edilemiyor). **Proje geneli `tsc` 0 hata.**
  Kalan: bayi firmada gerçek fatura akışı testi (Mysoft firma-ekleme yetkisi + aktif tenant
  gelince). Kapsam dışı bırakılan per-firma uçları: templates/*, withholding-types, teşhis
  uçları (çekirdek akış için gerekmez).
- **2026-07-07 (15)** — UX kararı: başvuruda kullanıcıya **prefix SORULMUYOR**. Gerekçe:
  swagger'da `serialNumberPrefix` şema-required DEĞİL ama açıklaması "E-Fatura/E-Arşiv/E-İrsaliye
  ise girilmesi zorunlu" diyor → prefix hesap açma (addTenant) değil **aktivasyon** aşamasının
  işi. Karar: onboarding route prefix'i opsiyonel yaptı; girilmezse **otomatik atıyor** (önce
  firmada kayıtlı eFaturaPrefix/eArchivePrefix, yoksa firma adından türetilmiş 3 karakter,
  `defaultPrefixFromName`). Aktivasyon başarılıysa kullanılan prefix firmaya yazılıyor
  (eFaturaPrefix/eArchivePrefix) → Seri No Tanımları'nda görünür/değiştirilebilir, gönderimde
  aynı numaratör. UI: Beta sihirbazından prefix input'u ve prefix state alanı kaldırıldı,
  "prefix otomatik atanır, sonra Seri No Tanımları'ndan değişir" notu eklendi. tsc 0 hata.
- **2026-07-07 (16)** — **Faz 5.1 eklendi.** Onboarding sihirbazında tenant açıldıysa
  (TENANT_CREATED/ACTIVATION_PENDING/ACTIVE) yeşil "Kontör Yükle" CTA'sı görünüyor →
  `/e-donusum/kontor?company=<id>` (mevcut kontör satın alma akışı). Kod tarafı Faz 5.1 tamam;
  kalan 5.2 (uçtan uca test) ve 5.3 (canlıya geçiş) dış bağımlılık bekliyor (Mysoft yetki /
  muvafakatname). tsc 0 hata.
- **2026-08-03 (17)** — 🔓 **MUVAFAKATNAME BLOKAJI KALKTI (Mysoft'a sormadan).** Swagger tam
  metin taraması + mevzuat/rakip araştırmasıyla yetkilendirme mekanizması netleşti → §3.1
  yazıldı, §2-B kapatıldı. Özet: aktivasyonda yetki `iVdUsername`/`iVdPassword` (İnteraktif
  Vergi Dairesi) ile veriliyor; swagger'da `mühür`/`e-imza`/`sertifika`/`muvafakat` kelimeleri
  **hiç geçmiyor** (sertifika API'den geçemez — özel anahtar token'dan çıkmaz). e-Arşiv
  mühürsüz açılabiliyor; e-Fatura'da mükellefin mali mührü kaçınılmaz (mühür = e-Fatura
  ağındaki kimliğin kendisi). Paraşüt de tam bu ayrımı yapıyor ve e-Fatura'yı ücretli insan
  hizmetiyle ("Anahtar Teslim") çözüyor — teknik bir kestirme yok.
  **Kapsam kararı (kullanıcı):** e-Fatura ve ÖKC/VUK507 tamamen kenara; **yalnızca e-Arşiv +
  İVD yolu** yapılacak → **Faz 6** açıldı (6.1 provider → 6.2 route → 6.3 onay kaydı →
  6.4 UI → 6.5 gerçek test). Kod henüz yazılmadı; sıradaki iş 6.1.
  ⚠️ Faz 6.5 aynı zamanda "İVD tek başına yeter mi" sorusunun ampirik cevabını verecek.
- **2026-08-03 (18)** — **Faz 6.1–6.4 KOD TAMAM** (kalan: yalnız 6.5 gerçek test).
  (a) `activateProduct` artık `ivdUsername`/`ivdPassword` alıp body'ye `iVdUsername`/
  `iVdPassword` yazıyor; mevcut log yalnız response basıyor, request body ASLA loglanmıyor.
  (b) Route: `SUPPORTED_PRODUCTS` → sadece `EArchive`; `OUT_OF_SCOPE_PRODUCTS` haritası
  e-Fatura/e-İrsaliye/e-SMM/e-MM'yi 400 `PRODUCT_OUT_OF_SCOPE` ile kapatıyor (UI'da gizlemek
  yetmez — uç canlıya gidiyor, kazara istek gerçek GİB başvurusu açar). İVD alanları zorunlu
  (400 `IVD_REQUIRED`), `consentAccepted` zorunlu (400 `CONSENT_REQUIRED`).
  (c) Onay kaydı `SystemLog`'a `EDONUSUM_ONBOARDING_CONSENT` olarak düşüyor: kullanıcı + IP +
  ürünler + VKN. Kimlik bilgisi YAZILMIYOR (yalnız kullanıcı kodu uzunluğu). Onay, başvuru
  sonucundan bağımsız kaydediliyor.
  (d) UI: e-Fatura satırı kilitli ("Yakında" + mühür gerekçesi), İVD kullanıcı kodu/şifre
  alanları, İVD'ye kayıtlı telefon uyarısı + ivd.gib.gov.tr yönlendirmesi, yetkilendirme
  onay kutusu, "şifre saklanmıyor" bilgisi. Şifre başarılı başvurudan sonra state'ten
  temizleniyor (hatada bırakılıyor — kullanıcı baştan yazmasın).
  Kaynak `tsc` **0 hata** (yalnız `.next/types/validator.ts` bayat artefakt hatası var,
  var olmayan `app/(dashboard)/page.tsx`'e atıf — kapsam dışı, önceden mevcut).
  **UI notu:** bölüm hâlâ en altta, kapalı ve "Beta" rozetli. Ana akışa çıkarma işi
  bilerek 6.5 sonrasına bırakıldı — gerçek GİB başvurusu doğrulanmadan öne almak yanlış olur.
- **2026-08-03 (19)** — 🎉 **addTenant İLK KEZ BAŞARILI** + yeni kök neden bulundu ve düzeltildi.
  Faz 6 prod'a alındı, gerçek müşteri firmasıyla denendi (ASDOĞUŞ PAZ.SAN.TİC.LTD.ŞTİ.,
  VKN 0860998219): **tenant 53949 açıldı** — vergi dairesi/adres/şehir doğrulamalarının
  tamamı geçti, payload doğru. Projede addTenant'ın ilk başarısı.
  **Aktivasyon takıldı:** `addTenantActivation` → *"Üzerinize tanımlı aktivasyon ürün
  bilgisi bulunmamaktadır."* İki farklı İVD kullanıcı koduyla denendi (log'da uzunluk 10 ve 8),
  **ikisinde de aynı hata** → hata İVD kimliğinden DEĞİL, çağrı o aşamaya gelmeden reddediliyor.
  **Teşhis:** `/api/kontor/tariffs` (mevcut salt-okunur uç) ile bakıldı — bayide **aktif tarife VAR**:
  `REYPO-001` "REYPO BİLİŞİM YILLIK E BELGE TARİFESİ", `isPassive:false`, ürünleri E-Fatura /
  E-Arşiv Fatura / E-İrsaliye / E-SMM / E-MM / E-Döviz / E-Adisyon, kademeler 250→10000 kontör.
  Yani Mysoft provizyonu EKSİK DEĞİL (mükellef sorgulama paketi de zaten tanımlıydı — addTenant'ın
  başarısı bunu kanıtlıyor). **Kök neden:** `addTenant`'taki `addTariffToTenant:true` tarifeyi
  tenant'a DEVRETMİYOR; aktivasyondan önce `addTenantPreContract` ile tarife firmaya
  tanımlanmalı.
  **Düzeltme:** provider'a `getPreContract()` + `addPreContract()` eklendi; route'a "1.5) tarife
  ön koşulu" adımı girdi: mevcut sözleşme varsa atlar (idempotent), yoksa aktif tarifelerden
  istenen ürünleri kapsayanı seçip (`PRODUCT_TARIFF_TEXT` ile Türkçe etiket eşleşmesi) en küçük
  kademeyle tanımlar. **`isLoadCredit:false`** — sözleşme açılır ama kontör YÜKLENMEZ; otomatik
  yükleme bayi havuzunu sessizce düşürür ve mevcut satın alma akışıyla çakışırdı.
  Sözleşme adımı patlarsa `stage:"preContract"` ile net hata döner, aktivasyona geçilmez.
  Kaynak `tsc` 0 hata. **Sıradaki: prod'a deploy + aynı firmada tekrar başvuru** (addTenant
  atlanır, tarife tanımlanır, aktivasyon denenir).
  ⚠️ **Temizlik borcu:** ASDOĞUŞ'ta `isEDonusumEnabled=true` ama aktivasyon yok (elle açılmış
  olmalı — status route yalnız allApproved'da yazar). Aktivasyon oturana kadar kapatılmalı,
  yoksa fatura gönderimi Mysoft'ta reddedilir.
  ⚠️ **Not:** lokal `.env`'deki `MYSOFT_PARTNER_*` canlıda token ALAMIYOR ("Kullanıcı
  tanımsızdır") — prod'daki kimlik farklı. Bayi çağrılarını lokalden teşhis etmek şu an
  mümkün değil; prod'daki `/api/kontor/tariffs` gibi uçlar üzerinden bakılmalı.
