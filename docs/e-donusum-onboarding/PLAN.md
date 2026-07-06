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

## 2. Açık Tek Soru (ticari/hukuki — API dışı)

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
- [ ] `npm run db:push` ile DB'ye uygula ← **kullanıcı çalıştıracak**

### Faz 1 — Provider metodları (bayi)
- [x] `createTenant()` — `addTenant`
- [x] `activateProduct()` — `addTenantActivation`
- [x] `getTenantActivationStatus()` — `getTenantActivation`
- [ ] (ops.) `addPreContract()` — ilk kontör otomatik yükleme

### Faz 2 — Onboarding API
- [ ] `POST /api/e-donusum/onboarding` — VKN doğrula (`check-vkn`) → `createTenant` →
      `activateProduct` → `Company` durumunu yaz. Idempotent + `SystemLog`.
- [ ] `GET /api/e-donusum/onboarding/status?companyId=` — `getTenantActivationStatus`
      ile GİB durumunu poll et, `Company.eDonusumActivatedProducts` güncelle.

### Faz 3 — UI Sihirbazı
- [ ] `E-Dönüşüm Ayarları` ekranını başvuru sihirbazına çevir: firma bilgileri (Company'den
      ön-dolu) → ürün seçimi (E-Fatura/E-Arşiv) → seri ön ekleri → "Başvur ve Aktive Et".
- [ ] Aktivasyon durumu göstergesi (Onaylandı/Bekliyor/Hata).
- [ ] Elle kimlik giriş kartını "gelişmiş / mevcut Mysoft hesabım var" fallback'i yap.
- [ ] (Karar #2'ye göre) muvafakat dijital onay adımı.

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

- **2026-07-06** — Proje başlatıldı. Dokümanla mimari doğrulandı (Yol A). Plan dosyası
  oluşturuldu. Faz 0 şema alanları + migration eklendi (db:push kullanıcıya bırakıldı).
  Faz 1 provider metodları (`createTenant`, `activateProduct`, `getTenantActivationStatus`)
  yazıldı. Sıradaki: Faz 2 onboarding API route'u. Mysoft'a muvafakat sorusu (Karar #2)
  soruldu, cevap bekleniyor.
