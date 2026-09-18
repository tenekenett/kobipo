# Uçtan uca tarama — 2026-09-18

Her API ucu (288), her panel sayfası (130) ve her query süzgeci; dört kimlikle
(anon / adminA / adminB / viewerA + süper salt-okuma) gerçek HTTP ile, **üretim
derlemesine** karşı (`next build` + `next start`). 5.033 API sondası + 565 sayfa
sondası. Araç ve yöntem: `scripts/uctan-uca/` (README orada).

A firması = Reypo Medya Ajansı (dev), B = Demo Firma A.Ş. Tarama sonrası A'nın 57
tablosunun satır sayısı DEĞİŞMEDİ (olumsuz yazma sondaları hiçbir yere yazamadı) —
kapılar sağlam. Açılan geçici kayıtlar (viewer hesabı, 3 "OTO-TARAMA" firması) silindi.

## Özet — gerçek bulgular

| # | önem | uç | sorun | durum |
|---|---|---|---|---|
| 1 | **orta** | 20 uç (tarih/sayı param) | geçersiz `startDate`/`year` vb. → **HTTP 500** (400 olmalı) | **DÜZELTİLDİ** |
| 2 | **orta** | `GET /api/faturalar` | 500 gövdesinde **Prisma sorgu yapısı sızıyor** (bilgi ifşası) | **DÜZELTİLDİ** |
| 3 | **düşük** | `POST /api/companies` | yalnız-VIEWER üye kendine **yeni bağımsız hesap** açabiliyor | **DÜZELTİLDİ** (kısıtlandı) |
| 4 | **düşük** | 6 rapor ucu | geçersiz `year`/`month` → boş yerine 500 (alt küme, #1 ile aynı kök) | **DÜZELTİLDİ** (#1'e dahil) |
| — | bilgi | perf | medyan 2,1 sn; ağır uçlar 3–5 sn (uzak DB'ye **sıralı** sorgu; N+1 ölçümü ayrı) | ertelendi (N+1 ayrı tur) |

**Kritik/yüksek gerçek bulgu YOK.** Aşağıdaki "kritik"lerin hepsi tarayıcı
sınıflandırma yanılması (aşağıda "Elden geçirilen otomatik bulgular").

## Uygulanan düzeltmeler (2026-09-18, kullanıcı onayıyla)

**#1 + #2 — geçersiz parametre → 400, sızıntı yok.** Ortak doğrulayıcı
`lib/http/query-params.ts` (`parseDateParam`/`parseIntParam`/`parseYearParam`/
`parseMonthParam`, geçersizde `BadRequestError`). `lib/api/errors.ts` → `withApiErrors`
`BadRequestError` ve Prisma `PrismaClientValidationError`/`RangeError("Invalid Date")`
→ **400 generic** (ham sorgu metni ASLA gövdeye yazılmaz — güvenlik ağı). İç catch'i
olan uçlar `badRequestResponse(error)` ile aynı dala bağlandı. 20 uçta parametreler
doğrulanıyor; `faturalar` catch'i artık `error.message` basmıyor.
Doğrulama: 11/11 geçersiz girdi → 400 (sızıntı yok), geçerli aralık → 200; birim test
`lib/http/query-params.test.ts` (14 senaryo). teklif `status` enum'u güvenlik ağıyla
400'e düşer (kaynak doğrulaması gerekmedi).

**#3 — üye kullanıcı yeni bağımsız hesap açamaz.** `lib/company/create-company.ts`:
new-account kapısı "kök firmanın ADMIN'i miyim" yerine "herhangi bir firmaya üye miyim"
ölçer. Kayıt sonrası 0 üyelikli kullanıcı ilk firmasını açabilir (signup firma
oluşturmaz); ikinci firma şube/ek firmadır; süper-admin muaf. **Bilinçli ters etki:**
başka firmada çalışan biri (ör. müşterisinin firmasında ADMIN olan mali müşavir) kendi
ilk firmasını artık bu uçtan açamaz — eski davranışı geri almak için o dosyada tek
koşul yeterli. Doğrulama: VIEWER → 400; 0-üyelikli yeni kullanıcı → 201.

Tümü: tsc temiz, 105 birim testi geçiyor, üretim derlemesi (lint dahil) temiz.

## 1 & 2 — Geçersiz query parametresinde 500 (bilgi ifşası: yalnız `faturalar`)

Tarih/sayı bekleyen query anahtarı geçersiz gelince (`startDate=abc`,
`year=999999999999`, `month=2026-13-45`, `startDate='`) uç **500** döner. Kök neden
tek: `new Date("abc")` → `Invalid Date` → Prisma `where` ifadesinde patlar. Doğru
davranış 400 ("geçersiz tarih") ya da parametreyi yok saymak.

Etki düşük (oturumlu kullanıcı yalnız KENDİ isteğini bozar, veri sızmaz) **ama**:
- `GET /api/faturalar` `days`/`startDate`/`endDate` bozukken gövdede ham Prisma
  metnini döndürüyor: `Invalid prisma.incomingInvoice.findMany() invocation… where:{ companyId:"…", docDate:{ gte:…`. Şema/alan adları dışarı sızıyor.
  (Diğer 19 uç `{"error":"Internal server error"}` ile örtüyor — sızıntı yok, yine 500.)

Etkilenen uçlar (query anahtarı): `cari/ekstre` · `export/accountant` ·
`faturalar` (+sızıntı) · `finans/transactions` · `personel/payroll` ·
`personel/leaves/balance` · `raporlar/{ba-bs,bilanco,gelir-gider,harcamalar,
kar-zarar,kdv-beyanname,muhtasar,nakit-akisi,personel,satis-alis,stok-hareket}` ·
`restoran/{adisyonlar,rezervasyonlar}` · `teklif`.

**Önerilen düzeltme:** ortak `parseDateParam` / `parseIntParam` yardımcısı — geçersizse
400 (ya da parametreyi düşür). `withApiErrors`'a Prisma `PrismaClientValidationError`
→ 400 dalı eklemek `faturalar` sızıntısını da kapatır (tek satır, geniş etki).

## 3 — VIEWER kendine yeni hesap açabiliyor (düşük)

`POST /api/companies` "yeni hesap" yerleşiminde A'da yalnız **VIEWER** olan kullanıcı
201 aldı: kendi adına ayrı, bağımsız bir hesap/firma açtı (kendisi ADMIN). A firmasının
verisine dokunmuyor — bu, self-servis kayıt akışının aynısı (herkes kendi işletmesini
açabilir). Yine de "şirketimde salt-okur çalışan" ile "yeni müşteri" aynı uçtan geçtiği
için, kısıtlı bir çalışan beklenmedik biçimde yeni hesap üretebiliyor.

**Karar sizin:** kabul (self-signup davranışı) mı, yoksa "mevcut bir firmaya üye olan
kullanıcı yeni-hesap açamaz, yalnız hesap yöneticisi ek firma açar" kuralı mı? İkincisi
`lib/company/create-company.ts` içinde tek yerde eklenir.

## Performans (bilgi)

Olumlu (adminA, 2xx) 155 istekte medyan **2,17 sn**, p90 **3,1 sn**. Bu süre dev
değil üretim derlemesinden; ana sebep makinenin uzak Supabase'e (eu-central-1) **sıralı
sorgu** gidiş-dönüşü (~70 ms × N). En ağırları:

| ms | uç | not |
|---|---|---|
| 6130 | `GET cari/customers/[id]` | tek kayıt 6 sn — muhtemelen N+1 (ekstre/bakiye alt sorguları) |
| 6124 | `GET billing/catalog` | 2,5 KB için 6 sn — sıralı sorgu zinciri |
| 4956 | `GET export/[dataset]=invoices` | 320 KB, tek seferlik dışa aktarım |
| 4287 | `GET faturalar` | 404 KB gövde (641 fatura) — sayfalama yok |
| 3866 | `GET cari/ekstre` | 166 KB |

Süre ortamdan etkilendiği için gerçek gösterge **uç başına sorgu sayısıdır**;
`scripts/uctan-uca/sorgu-sayim.mjs` (sunucuyu `DEBUG=prisma:query` ile açıp) N+1'i
kesin sayar. Henüz koşmadı (ayrı sunucu başlatma ister) — istenirse çalıştırılır.

`faturalar` (404 KB) ve `raporlar/stok-hareket` (213 KB) gibi sayfasız listeler
[[liste-sinirlari-performans]] kapsamına girer.

## Elden geçirilen otomatik bulgular (gerçek DEĞİL)

Tarayıcının "kritik" işaretlediği ama incelemede tasarım gereği çıkanlar — düzeltme
yok, tarayıcı kuralı düzeltildi:

- **127 "sayfa-sizintisi":** adminB, A'nın sayfasını `?company=A` ile açınca HTML'de A
  id'si var sandı. O id URL'den link olarak yankılanıyor; **ad/VKN/kayıt sızmıyor**
  (elle doğrulandı: A ürün/cari adı 0, ekranda B firması). Tarayıcı artık id'yi işaret
  saymıyor.
- **4 "yetki-asimi":** `billing/packages`, `billing/pricing`, `kontor/packages`,
  `kontor/orders` GET'leri yönetici-olmayana 200 döndü. Hepsi **katalog / kendi-firma**
  okuması; süper kapısı yalnız `?all=1` (pasifleri gör) arkasında. Sınıflandırma metoda
  göre düzeltildi.
- **2 "firma-sizintisi":** `company/role-templates`, `e-donusum/templates/samples` —
  adminA ile adminB aynı gövdeyi aldı çünkü ikisi de **sisteme ait global katalog**
  (rol kalıpları, örnek tasarımlar), firma verisi değil.
- **1 "500" `pay/[token]`:** ödeme linkleri kapalı olduğu için 503 döndü — özellik
  bayrağı, hata değil ([[odeme-linki-pasif]]).

## Doğru bulunanlar (kayıt için)

- Oturumsuz istek her kapılı uçta 401/307; hiçbir yazma ucu anon/adminB/viewer'a açık
  değil; A'nın satır sayısı taramadan sonra bit-birebir aynı.
- Çapraz firma (`companyId=A`, B oturumu) her yerde 403 `FOREIGN_RECORD`/`Access denied`;
  export CSV'de A verisi 0 (elle doğrulandı).
- VIEWER yazma uçlarında 403 (`PAGE_FORBIDDEN`); cari görünürlüğü, modül ve sayfa
  kapıları çalışıyor.
- `adminB/idor` (B oturumu + A id'si) tümünde 403/404 — id sahipliği doğrulanıyor
  ([[genel-denetim-2026-09]] A1–A3 düzeltmesi tutmuş).

## Bu oturumda UYGULANAN düzeltmeler (onay öncesi — geri alınabilir)

Taramadan önce statik incelemede bulunan 6 madde; hepsi çalışma ağacında, commit yok:

1. `lib/integrations/e-invoice/constants.ts` (+`test-mysoft`, `companies/[id]`,
   `system-admin/companies/[id]`, `lib/api/errors.ts`, 4 test): Mysoft adresi yalnız iki
   bilinen ortam; yabancı adres 400 (`MysoftUrlError`). **En önemlisi** — eski hâlde
   `test-mysoft` firmanın kayıtlı şifresini gövdedeki serbest `apiUrl`e POST ediyordu.
2. `lib/personel/validation.ts` + `personel/documents`(+`/[id]/download`): `fileUrl`
   http(s) doğrulaması; geçersiz kayıtta 500 → 422.
3. `auth/forgot-password`: hesap başına 2 dk soğuma (e-posta bombalama).
4. `health/db`: pooler host/port/Prisma metni yalnız süper-admine.
5. `blog/upload`: boş MIME allowlist'i atlayamıyor.
6. `next.config.js`: güvenlik başlıkları (nosniff, X-Frame-Options, Referrer-Policy,
   HSTS, Permissions-Policy). CSP bilerek eklenmedi (önce Report-Only). **Yeni derleme
   gerektirir** — `next start` üzerinde henüz doğrulanmadı.

tsc temiz, 210 birim testi geçiyor.
