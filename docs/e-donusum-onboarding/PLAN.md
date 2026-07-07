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

**A) Test bayi hesabı paketi (AKTİF BLOKAJ — 2026-07-07):** addTenant içeride "mükellef
sorgulama" yapıyor; test bayi API hesabının bu iş için aktif paketi/limiti yok
(*"Mükellef sorgulama işlemi için aktif bir paketiniz bulunmamaktadır..."*). Mysoft'un test
bayi hesabına **firma açma + mükellef sorgulama paketi** tanımlaması gerekiyor. Kod tarafı
createTenant için hazır; bu paket açılmadan test ilerleyemez.
- Durum: ⏳ Mysoft'a soruldu / cevap bekleniyor.
- Cevap: _(buraya)_

**B) Muvafakatname / sözleşme (ticari/hukuki):**

- **Muvafakatname / aracılık sözleşmesi / e-imza:** Bir mükellefi bayi olarak API ile
  aktive ederken GİB/Mysoft'un istediği ıslak/e-imzalı bir evrak var mı? API'de böyle
  bir alan yok (`addTenantPreContract` sadece **ticari** tarife/kontör sözleşmesi). Bu
  Mysoft'a WhatsApp ile soruldu. **Cevap gelince buraya yaz** ve gerekirse Faz 3'e
  dijital onay adımı ekle.
  - Durum: ⏳ Mysoft'tan cevap bekleniyor.
  - Cevap: _(buraya)_

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
- [ ] (ops.) `addPreContract()` — ilk kontör otomatik yükleme

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
- [ ] (Karar #2'ye göre) muvafakat dijital onay adımı — Mysoft cevabı sonrası.

Değişen dosyalar: `app/(dashboard)/ayarlar/e-donusum/page.tsx` (yeniden yazıldı),
`app/api/companies/[id]/route.ts` (GET select'e 4 onboarding alanı eklendi).

### Faz 4 — Belge işlemlerini bayi kimliğine taşı
- [ ] `sendInvoice` / `getInvoiceStatus` / inbox / iptal / pdf uçlarını **bayi provider +
      `tenantIdentifierNumber = firma VKN'si`** ile çalıştır. Mevcut per-firma kimlik
      yolunu "gelişmiş" fallback olarak koru.
- [ ] Onboarding'i biten firmada `isEDonusumEnabled=true` ve fatura kesme akışını doğrula.

### Faz 5 — Kontör entegrasyonu & test
- [ ] Aktivasyon sonrası mevcut kontör satın alma akışına yönlendir (zaten çalışıyor).
- [ ] Test ortamında (`mytest.tr`) uçtan uca: firma aç → aktive et → durum sorgula →
      kontör yükle → fatura kes.
- [ ] Canlıya (`mysoft.com.tr`) geçiş — Karar #2 (hukuk) çözüldükten sonra.

## 6. Dosya Haritası

| Dosya | Rol |
|---|---|
| `lib/integrations/e-invoice/mysoft-provider.ts` | Provider metodları (createTenant/activateProduct/getTenantActivationStatus) |
| `lib/integrations/e-invoice/partner.ts` | Bayi kimliği (mevcut) |
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
