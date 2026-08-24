# Kobipo satışlarının otomatik faturalandırılması

> Amaç: Kobipo'nun kendi sattığı **kontör** ve **paket/abonelik** siparişleri, ödeme
> onaylandığı anda satıcı firma (REYPO BİLİŞİM) adına e-Fatura/e-Arşiv olarak otomatik
> faturalansın; fatura sipariş kaydına bağlansın, cari/tahsilat kapansın.

Tarih: 2026-08-24 · Durum: **Faz 1–5 kodlandı, migrasyon canlıda**

| Faz | Durum |
|---|---|
| 1 — Şema + migrasyon | ✅ · migrasyon canlıya **uygulandı** (2026-08-24) |
| 2 — Ortak fatura servisi + kancalar | ✅ (yinelenen ödeme hariç — iskele, aşağıya bak) |
| 3 — İnternet satış alanları | ✅ |
| 4 — Ödeme öncesi fatura bilgisi | ✅ (kontör diyaloğu + abonelik ekranı) |
| 4.5 — Test siparişi kapıları | ✅ |
| 5 — İptal, tekrar deneme, izleme | ✅ |
| 6 — Kod dışı ön koşullar | ⛔ açık |

### Uygulamada plandan sapılan üç yer

1. **Kuruş farkı** birim fiyatın 6 ondalığına değil, `payableRoundingAmount`'a yazılıyor.
   Neden: 6 ondalık birim fiyat, provider'ın satır matematiğinde (`taxableAmt = round2`)
   yine 2 ondalığa iniyor ve fark KDV'ye karışıyordu. `payableRoundingAmount` tam bu iş
   için var (KDV'ye girmez, ödenecek tutara eklenir) ve Mysoft payload'ında zaten
   destekleniyor. Testte doğrulandı: ödenecek tutar = tahsil edilen tutar.
2. **Yinelenen ödemeye kanca takılmadı.** `chargeRecurringPayment` iskele (daima
   `NotImplemented` fırlatır) ve yenilemenin `PackageOrder` üretip üretmeyeceği belli
   değil — servis siparişe bağlanır. `lib/billing/jobs.ts` içindeki başarı dalına, ne
   yapılacağını söyleyen bir `TODO(faturalandırma)` bırakıldı.
3. **"Yükleme başarısızsa faturayı otomatik iptal et" kararı, "yükleme başarısızsa
   fatura HİÇ kesilmez"e dönüştü.** Uygulama sırasında iki sert kısıt çıktı:
   mevcut iptal yolu e-Arşiv için **24 saat** sınırı uyguluyor (araştırmadaki 8 gün
   GİB'in iptal/itiraz BİLDİRİM penceresidir, sağlayıcı iptali değil) ve e-Fatura hiç
   iptal ettirmiyor — iade faturası gerekiyor. Yani "önce kes, olmazsa iptal et"
   düzeninde, FAILED yüklemelerin çoğu geçici olduğu ve admin tekrar denediği için
   ya erken iptal edilmiş bir belge ya da penceresi kapanmış bir belge kalıyordu.
   Bunun yerine SIRA değiştirildi: hizmetin ifası (kontör yüklemesi) başarılıysa
   fatura kesilir. Yükleme başarısızsa belge hiç doğmaz — iptal edilecek bir şey de
   olmaz; sistem-admin ya tekrar yükler (o an faturalanır) ya iade eder.
   Otomatik iptal, siparişin **reddedilmesine** bağlandı (kesin karar anı).

---

## 0. Zemin — araştırmayla doğrulananlar

**Satıcı firma = REYPO BİLİŞİM SANAYİ VE TİCARET LİMİTED ŞİRKETİ**, VKN `7352344835`.
Mysoft'ta İş Ortağı (bayi) olarak görünen firma ile Kobipo DB'sindeki firma kaydı aynı:

| | |
|---|---|
| Kobipo firma id | `cmpi8qvfc0002p9ovzkar1hvm` (slug `reypo-bilisim-sanayi-ve-ticaret-limited-sirketi`) |
| Mysoft bayi kimliği | `MYSOFT_PARTNER_USERNAME` (canlı: `edocumentapi.mysoft.com.tr`) |
| Bayi havuzu | 5000 kontör, 790 kullanılmış, 4210 kalan · tarife `REYPO-001` |
| e-Fatura serisi | `REP` — PK `urn:mail:faturapk@reypobilisim.com.tr`, GB `faturagb@reypobilisim.com.tr` |
| e-Arşiv serisi | `EAR` · **internet satış serisi `INT`** (`isInternetSales: true`) |
| Aktivasyon | EInvoice / EArchive / arşivler → `gibServiceStatus 1300` "BAŞARIYLA TAMAMLANDI" |

Doğrulama: `getBusinessPartnerDocumentCreditList(type=1)` → `businessPartnerIdentifierNumber
7352344835`, `mainBusinessPartner = null` (ana bayi bizzat REYPO); `getTenant` ve
`getDocumentNumberList` aynı VKN'yi ve serileri döndürüyor.

**Maliyet uyarısı:** REYPO'nun kestiği her belge bayi havuzundan **1 kontör** tüketir
(`getCounterInfo`: E-Fatura 15 + E-Arşiv 5 kullanılmış). Otomatik faturalandırma satış
başına 1 kontör demektir; havuz tükenmeden yeniden yükleme gerekir.

### Mevzuat çerçevesi (2026)

- e-Fatura mükellefi olmayan alıcıya **tutar sınırı olmaksızın** e-Arşiv zorunlu; alıcı
  e-Fatura mükellefiyse e-Fatura zorunlu. Kod bunu zaten çözüyor: `send-invoice-helper.ts`
  gönderim öncesi `getGibAccount(vkn)` ile sorgulayıp `E_ARCHIVE → E_INVOICE` çeviriyor.
- Fatura, hizmetin ifasından itibaren **7 gün** içinde düzenlenmeli (VUK 231/5). Kontörde
  ifa = yükleme anı → ödeme günü kesmek güvenli taraf.
- **İnternet satışı**: ödeme fiziken karşılaşmadan alındığı için Kobipo satışları internet
  satışıdır. e-Arşiv'de ödeme şekli/tarihi ve internet satış ibaresi zorunlu; kargo/taşıyıcı
  alanları mal sevkine bağlı olduğundan dijital hizmette boş kalır.
- e-Arşiv iptali: GİB'in iptal/itiraz **bildirim** penceresi 8 gündür, ancak bu repodaki
  sağlayıcı iptal yolu **24 saat** uyguluyor (`app/api/e-donusum/invoices/[id]/cancel`) ve
  e-Fatura'yı hiç iptal ettirmiyor. Kod bu daha dar kurala göre yazıldı; aşan hâllerde
  çözüm iade faturasıdır ve sistem-admin'e talimat olarak düşer.
- KDV genel oran %20 (REYPO'nun mevcut 12 ürününün hepsi %20).

### Alınan kararlar

1. **KDV**: fiyatlar KDV **dahil**; pakete KDV alanı eklenir, iç yüzdeyle ayrıştırılır.
   Müşterinin ödediği tutar değişmez.
2. **Tetikleyici**: ödeme onaylanır onaylanmaz **otomatik**.
3. **Eksik bilgi**: satın alma öncesi **zorunlu fatura bilgisi formu**.
4. **Kapsam**: kontör **ve** paket/abonelik birlikte. Kontör yüklemesi başarısızsa
   fatura **hiç kesilmez** (uygulamada 3. sapma); otomatik iptal siparişin
   reddedilmesine bağlıdır.
5. E-posta ile fatura gönderimi **bu fazda yok** — alıcı faturasını panelden indirir.

---

## Faz 1 — Şema

Yeni tablo yok, yalnız kolon eklenir → migrasyonda `ENABLE ROW LEVEL SECURITY` gerekmez
(mevcut tablolar zaten kilitli).

```prisma
model KontorPackage {
  vatRate  Decimal? @db.Decimal(5,2)   // null → KOBIPO_DEFAULT_VAT_RATE (20)
}
model Plan {
  vatRate  Decimal? @db.Decimal(5,2)
}
// PricingItem (à la carte şube/firma kotası) sabit orana tabidir — alan eklenmez.

model KontorOrder {   // aynısı PackageOrder'a
  invoiceId       String?   @unique   // kesilen satış faturası
  invoicedAt      DateTime?
  invoiceError    String?   @db.Text
  invoiceAttempts Int       @default(0)
  // Satın alma anındaki fatura bilgisi SNAPSHOT'ı — firma kartı sonradan değişse de
  // belge, satışın yapıldığı andaki bilgiyle uyumlu kalır.
  billingName       String?
  billingTaxNumber  String?
  billingTaxOffice  String?
  billingAddress    String?  @db.Text
  billingCity       String?
  billingDistrict   String?
  billingEmail      String?
}

model Invoice {
  // İnternet satış bilgileri (Mysoft InvoiceDraftModel.internetShipmentInfo).
  // Şekli: lib/invoice/internet-sales.ts. Null → alanlar payload'a hiç eklenmez.
  internetSalesInfo Json?
}
```

`lib/billing/constants.ts`: `KOBIPO_DEFAULT_VAT_RATE = 20`,
`KOBIPO_PRICES_INCLUDE_VAT = true`, `KOBIPO_SELLER_COMPANY_ID` (env'den; yoksa VKN
`7352344835` ile çözülür ve loglanır).

---

## Faz 2 — Ortak fatura servisi

`lib/invoicing/issue-sales-invoice.ts` — **tek giriş noktası**, oturumsuz çağrılabilir
(PayTR callback'i oturumsuzdur):

```ts
issueSalesInvoiceForOrder({ kind: "KONTOR" | "PACKAGE", orderId }): Promise<IssueResult>
```

Akış:

1. **Idempotency**: `updateMany({ where: { id, invoiceId: null }, data: { invoiceAttempts: {increment:1} } })`
   ile kilitle; `count === 0` ise çık. PayTR aynı bildirimi tekrar gönderebiliyor
   (`lib/kontor/paytr-payment.ts`'teki `paidAt` claim deseninin aynısı).
2. **Satıcı**: `KOBIPO_SELLER_COMPANY_ID` firması. `isEDonusumEnabled` değilse hata.
3. **Alıcı cari**: satıcı firmada `Customer` bul/oluştur — VKN eşleşmesi, yoksa sipariş
   snapshot'ından oluştur. (`lib/cari/resolve-cari.ts` deseni.)
4. **Kalem**: 1 satır, `productId` = REYPO'daki "E-Belge Kontörü" / "Kobipo Abonelik"
   hizmet ürünü (`isService: true`; `productId` null olsa da stok işlemez).
   `unitPrice = brüt / (1 + vatRate/100)` (KDV dahil fiyat ayrıştırması), `quantity = 1`.
   Kuruş farkı `payableRoundingAmount`'a yazılır (yukarıdaki 1. sapma) — dip toplam
   tahsil edilen tutara birebir eşit olmalı.
5. **Fatura**: `generateInvoiceNumber(seller, "SALES")` → `SAT-2026-XXXX`,
   `invoiceType: "E_ARCHIVE"` (helper mükellefse E_INVOICE'a çevirir), `date = paidAt`,
   `status: "DRAFT"`, `internetSalesInfo` doldurulmuş.
6. **Gönderim**: `createGibDraft(invoiceId)` → `finalizeGibDraft(invoiceId)`.
   ⚠ `app/api/e-donusum/invoices/route.ts` içindeki satır içi doğrudan gönderim
   KULLANILMAZ: GİB mükellef sorgusu, geçmiş-tarih yedek serisi ve şablon çözümü
   yalnız helper yolunda var.
7. **Tahsilat**: `InvoicePayment` (`CREDIT_CARD` / `BANK_TRANSFER`, `accountId` = ayarlardan
   seçilen tahsilat hesabı) → cari ekstrede borç kapanır. PayTR komisyonu ayrı gider
   kaydıdır, faturaya girmez.
8. `SystemLog` (`action: "SALES_INVOICE"`) + siparişe `invoiceId`, `invoicedAt` yazılır.

**Hata**: `invoiceError` yazılır, sipariş ve kontör yüklemesi ETKİLENMEZ. Ödeme alınmış
sipariş faturasız kalabilir ama kontörsüz kalmaz.

### Kanca noktaları

| Kanal | Dosya | Yer |
|---|---|---|
| Kontör / kart | `lib/kontor/paytr-payment.ts` | `loadKontorOrderCredit()` sonrası |
| Kontör / havale | `app/api/kontor/orders/[id]/confirm/route.ts` | `approve` başarılıysa |
| Paket / kart | `lib/billing/paytr-payment.ts` | `handlePackageNotification` başarı dalı |
| Abonelik yenileme | `lib/billing/jobs.ts` → `runRecurring()` | başarılı çekim başına |

---

## Faz 3 — İnternet satış alanları (Mysoft)

`mysoft-provider.ts` payload'ında bu alanlar **hiç yok**; eklenecek:

```ts
isInternetSales: true,
internetShipmentInfo: {
  webSiteUrl: "https://kobipo.com",
  paymentType: "KREDIKARTI/BANKAKARTI" | "EFT/HAVALE",
  internetAccountName: "PayTR Ödeme ve Elektronik Para Kuruluşu A.Ş.", // yalnız kartta
  paymentDate: "YYYY-MM-DD",   // kartta ZORUNLU
}
```

`shippingDate / shippingAccountName / shippingAccountVknTckn` **gönderilmez** — mal sevki
yok. Enum sabittir: `KREDIKARTI/BANKAKARTI, EFT/HAVALE, KAPIDAODEME, ODEMEARACISI, DIGER`.

**Seri seçimi**: e-Arşiv + internet satışında REYPO'nun `INT` serisi kullanılmalı (`EAR`
internet satış serisi değil). `Company.eArchiveInternetPrefix` alanı eklenir; boşsa
`listNumerators()` içinden `isInternetSales && isDefault` olan numaratöre düşülür.

`send-invoice-helper.ts`, `invoice.internetSalesInfo` doluysa payload'a taşır ve e-Arşiv'de
internet serisini seçer.

---

## Faz 4 — Satın alma öncesi fatura bilgisi

Bugün satın alma diyaloğu yalnız paket + ödeme yöntemi soruyor; DB'deki 30 firmanın
23'ünde geçerli VKN, 22'sinde vergi dairesi, 19'unda adres var → ~1/3'üne fatura
kesilemez.

- Kontör (`components/e-donusum/kontor-purchase-dialog.tsx`) ve abonelik satın alma
  akışına **"Fatura Bilgileri"** adımı. Alanlar firma kartından ön-doldurulur.
- Zorunlu: ünvan, VKN/TCKN (10/11 hane, `^(\d)\1+$` placeholder reddedilir),
  vergi dairesi (VKN 10 haneliyse), adres, il, e-posta.
- Kaydet → hem `Company` kartına hem sipariş snapshot'ına yazılır.
- Sunucu kapısı: `POST /api/kontor/orders` ve paket sipariş ucu eksikte **412** döner
  (mevcut `ERR_NO_VERIFIED_VKN` deseni genişletilir). İstemci doğrulamasına güvenilmez.
- Şube/ek firma: alıcı = siparişi veren firma. Şube ana firmayla aynı VKN ve ünvanı
  taşır; ek firmanın kendi VKN'si vardır — ikisi de doğru sonuç verir.

---

## Faz 4.5 — Test siparişleri fatura DIŞINDA kalmalı

Bugün `PAYTR_TEST_MODE` varsayılanı `"1"`dir (`lib/integrations/paytr/client.ts:35` —
açıkça `"0"` yazılmadıkça test). Test ödemede PayTR **para çekmez**, ama callback
`status=success` ile gelir → `handleKontorNotification` siparişi ödenmiş sayar →
`loadKontorOrderCredit` **canlı** Mysoft'a gerçek `insertDocumentCredit` atar
(`MYSOFT_PARTNER_API_URL` boş → prod). Aktif "test" paketi de gerçek tarifeyi
(`REYPO-001`) kullanıyor. Yani tahsilatsız gerçek kontör dağıtılıyor — bu,
faturalandırmadan BAĞIMSIZ, hâlihazırda var olan bir sızıntıdır (DB'de 4 LOADED sipariş).

Buna fatura eklenirse belge sahte olmaz, **hukuken geçerli** olur: hasılat + hesaplanan
KDV doğar, KDV beyannamesine ve e-Arşiv raporuna girer, tahsilat olmadığı için cari açık
alacak kalır. Alıcı e-Fatura mükellefiyse belge onun gelen kutusuna düşer ve kabul
ederse kendi defterine girer — düzeltme tek taraflı olmaktan çıkar (TEMEL faturada iptal
yalnız noter/KEP itirazı ya da GİB'e dilekçe). Üstüne her belge 1 kontör yer.

### KAPSAM DIŞI (bilinçli karar, 2026-08-24)

**Test ödemesinde gerçek kontör yüklenmesi DEĞİŞTİRİLMEYECEK.** Çalışan bir akışa
dokunmak, test düzenini bozma riski taşıyor; sızıntının büyüklüğü (10'luk paket, iç
kullanım) bu riski karşılamıyor. Test siparişleri bugünkü gibi gerçek `insertDocumentCredit`
atmaya devam eder; `KontorPackage.isTestPackage` gibi bir bayrak **eklenmez**.

Kabul edilen sonuç: bayi havuzu iç testlerde erimeye devam eder — havuz takibi Faz 6'da.

### Kapı YALNIZ fatura tarafında (kalan kapsam)

Fatura kesilmemesi ayrı mesele: burada geri alınması zor olan şey bir DB satırı değil,
GİB'e gitmiş **gerçek bir belge**. Kapı, kontör akışına hiç dokunmadan, belge
oluşturulmadan önceki `if` olarak durur.

`PAYTR_TEST_MODE`e bakmak tek başına yetmez: havale akışında test modu kavramı YOKTUR
(admin "Onayla & Yükle" der) ve bayrak canlı için `"0"`a çekildiği anda o güne kadarki
tüm iç test siparişleri faturalanabilir hale gelir. Üç katman:

1. **Sipariş anında snapshot**: `KontorOrder.isTest` / `PackageOrder.isTest` (Boolean).
   Kart siparişinde `PAYTR_TEST_MODE === "1"` ise true yazılır; havale siparişinde false.
   Env sonradan değişse geçmiş siparişler etkilenmez. Tek kolon + sipariş oluşturmada
   tek satır.
2. **Global kapı**: `KOBIPO_AUTO_INVOICE_ENABLED` (varsayılan **kapalı**). Kapalıyken
   servis hiç fatura kesmez, sipariş "faturalandırma devre dışı" ile geçilir — hata değil.
3. **Geriye dönük kapı — ZORUNLU**: yalnız `paidAt > KOBIPO_AUTO_INVOICE_START_AT` olan
   siparişler faturalanır. Bu olmadan Faz 5'teki "faturasız ödenmiş siparişleri tekrar
   dene" cron'u, canlıya alındığı ilk gece geçmişteki test siparişlerine toplu fatura keser.

Canlıya alırken sıra: `KOBIPO_AUTO_INVOICE_START_AT` = açılış anı → `PAYTR_TEST_MODE=0`
→ `KOBIPO_AUTO_INVOICE_ENABLED=true`.

---

## Faz 5 — İptal, tekrar deneme, izleme

- **Kontör yüklemesi FAILED** → fatura 8 gün içindeyse `voidInvoice()` + Mysoft
  `cancelInvoice()`; 8 günü aşmışsa iade faturası (`type: "RETURN"`) görevi sistem-admin'e
  düşer. `voidInvoice` `status=CANCELLED` yazdığı için cari/rapor otomatik düşer.
- **Günlük iş**: `/api/billing/cron/daily` orkestratörüne dördüncü adım — faturasız kalan
  ödenmiş siparişleri tekrar dene, 7 günü aşmaya yakınları uyarı olarak bildir.
- **Sistem-admin**: kontör ve abonelik tablolarına "Fatura" kolonu (No / durum / hata) +
  "Tekrar dene" ve "Faturasız siparişler" filtresi.
- **Müşteri**: kontör/abonelik ekranında fatura no + PDF indirme. ⚠ Fatura satıcı
  firmanın `companyId`'sinde durur; alıcı kullanıcının o firmaya erişimi YOKTUR — mevcut
  `/api/e-donusum/invoices/[id]/pdf` kullanılamaz. Yeni uç:
  `GET /api/kontor/orders/[id]/invoice-pdf`, yetkilendirme **sipariş sahipliğiyle**.

---

## Faz 6 — Kod dışı ön koşullar

- [ ] `NEXT_PUBLIC_APP_URL` prod domaine çekilmeli — `webSiteUrl` olarak faturaya yazılıyor.
- [ ] Test siparişi kapıları (Faz 4.5): `isTest` snapshot'ı, `KOBIPO_AUTO_INVOICE_ENABLED`,
      `KOBIPO_AUTO_INVOICE_START_AT`. (Kontör yükleme davranışı değişmiyor — kapsam dışı.)
- [ ] Kurumsal sayfalara satıcı tüzel kişi bilgileri (REYPO ünvan / VKN / adres / MERSİS);
      şu an sitede satıcının kim olduğu hiçbir yerde yazmıyor.
- [ ] Mesafeli satış sözleşmesi + ön bilgilendirme + iade koşulları sayfası (`app/kurumsal`
      altında yok).
- [ ] Bayi kontör havuzu izleme: fatura başına 1 kontör; 4210 kalan.

---

## Sıra

1. Faz 1 (şema + migrasyon) → 2. Faz 3 (provider internet satış alanları, tek başına test
edilebilir) → 3. Faz 2 (servis + kancalar) → 4. Faz 4 (form) → 5. Faz 5 (iptal/izleme).

Faz 4 canlıya alınmadan Faz 2 açılırsa eksik bilgili firmaların siparişleri faturasız
kuyruğa düşer — sıralama bu yüzden önemli.

---

## Devreye alma (sırayla)

1. **Migrasyonu uygula** (komutu kullanıcı çalıştırır):

   ```bash
   node scripts/apply-migration.js supabase/migrations/20260824000001_otomatik_faturalandirma.sql
   ```

2. **Env değişkenleri** (Vercel + .env.local):

   | Değişken | Zorunlu | Açıklama |
   |---|---|---|
   | `KOBIPO_AUTO_INVOICE_ENABLED` | evet | `true` olmadan hiç fatura kesilmez |
   | `KOBIPO_AUTO_INVOICE_START_AT` | evet | ISO tarih; bundan önce ödenen sipariş faturalanmaz |
   | `KOBIPO_SELLER_COMPANY_ID` | hayır | Boşsa VKN 7352344835 ile çözülür |
   | `KOBIPO_CARD_ACCOUNT_ID` | önerilir | Kart tahsilat hesabı. REYPO'da açıldı: **PayTR Tahsilat** `cmt7cp2gr0001zwlfk9hjnm22` |
   | `KOBIPO_BANK_ACCOUNT_ID` | hayır | Havale tahsilat hesabı — **şimdilik bilinçli olarak BOŞ** (hangi hesap olduğu netleşmedi) |
   | `NEXT_PUBLIC_APP_URL` | evet | Belgeye `webSiteUrl` olarak yazılır (yerelse kobipo.com'a düşer) |

3. **Satıcı firmada internet satış serisi**: REYPO'nun `INT` numaratörü
   `Company.eArchiveInternetPrefix` alanına yazılmalı (ayarlar ekranına alan henüz
   eklenmedi — şimdilik DB'den). Boş bırakılırsa Mysoft varsayılan e-Arşiv serisini
   seçer; GİB internet satışını ayrı seride beklediği için bu tercih edilmez.

4. Sıra: `START_AT` = açılış anı → `PAYTR_TEST_MODE=0` → `KOBIPO_AUTO_INVOICE_ENABLED=true`.

## Kodlanan dosyalar

| Dosya | Rol |
|---|---|
| `lib/billing/vat.ts` | KDV dahil fiyat → matrah + KDV ayrıştırması |
| `lib/invoicing/config.ts` | Satıcı çözümü + üç kapı + `isTestPurchase` |
| `lib/invoicing/billing-info.ts` | Fatura bilgisi doğrulama/normalleştirme |
| `lib/invoicing/issue-sales-invoice.ts` | Ana servis + `issueInvoiceQuietly` |
| `lib/invoice/internet-sales.ts` | İnternet satış bilgisi tipi/kurucusu |
| `components/invoicing/billing-info-form.tsx` | Ortak form + `useBillingInfo` |
| `app/api/invoicing/billing-info/route.ts` | Formun ön doldurma kaynağı |

Değiştirilenler: `mysoft-provider.ts` (isInternetSales), `send-invoice-helper.ts`
(internet serisi + payload), `kontor/paytr-payment.ts`, `kontor/orders/[id]/confirm`,
`billing/paytr-payment.ts`, `kontor/orders` + `billing/orders` (kapı + snapshot),
kontör satın alma diyaloğu, abonelik ekranı, `prisma/schema.prisma`.

Testler: `lib/billing/vat.test.ts`, `lib/invoicing/billing-info.test.ts`,
`lib/invoice/internet-sales.test.ts` (22 test). Tüm paket: 415 test geçiyor.

---

## Faz 5 — kodlananlar

| Parça | Yer |
|---|---|
| Geri alma servisi | `lib/invoicing/void-sales-invoice.ts` — saf karar `planInvoiceVoid` + uygulama |
| Red → otomatik geri alma | `app/api/kontor/orders/[id]/confirm` (`action: "reject"`) |
| Sistem-admin fatura eylemi | `POST /api/kontor/orders/[id]/invoice` (`issue` \| `void`) |
| Alıcının PDF'i | `GET /api/kontor/orders/[id]/invoice-pdf` — yetki **sipariş sahipliğiyle** |
| Günlük toparlama | `lib/invoicing/retry-job.ts` → `/api/billing/cron/daily` 4. adım |
| Admin tablosu | `components/system-admin/kontor-admin.tsx` — Fatura sütunu + kes/geri al |
| Müşteri listesi | kontör satın alma diyaloğunda "Fatura" indirme bağlantısı |

`runInvoiceRetry`: faturasız + ödenmiş + test olmayan + `START_AT` sonrası siparişleri
(kontörde yalnız `LOADED`) koşu başına 25 taneye kadar dener; 7 günlük düzenleme süresine
2 gün ve altında kalanları `SALES_INVOICE_OVERDUE` (WARNING) olarak SystemLog'a yazar.

**Alıcının PDF ucu neden ayrı:** fatura satıcı firmanın `companyId`'sinde durur; genel
`/api/e-donusum/invoices/[id]/pdf` ucu `ensureCompanyExport(invoice.companyId)` ile
faturanın firmasına yetki arar ve alıcıyı DAİMA reddeder.

---

## Paket/abonelik eşitliği (kontör ile aynı yetenekler)

Faz 5 ilk turda yalnız kontör tarafına uygulanmıştı; kapsam kararı "kontör **ve**
paket/abonelik birlikte" olduğu için abonelik tarafı da eşitlendi:

| Yetenek | Kontör | Paket/abonelik |
|---|---|---|
| Admin "Faturayı kes / geri al" | `POST /api/kontor/orders/[id]/invoice` | `POST /api/billing/orders/[id]/invoice` |
| Alıcının PDF'i | `GET /api/kontor/orders/[id]/invoice-pdf` | `GET /api/billing/orders/[id]/invoice-pdf` |
| Admin tablosunda fatura sütunu | `kontor-admin.tsx` | `subscription-admin.tsx` |

Ayrıca `KontorPackage.vatRate` şemada vardı ama arayüzden erişilemiyordu — sistem-admin
paket formuna "KDV %" alanı ve paket tablosuna KDV sütunu eklendi (boş = %20).
Erişilemeyen bir alan, olmayan alandan kötüdür.

## REYPO tahsilat hesapları (env için)

| Hesap | id |
|---|---|
| AKBANK (BANK) | `cmqo8sv4x000110m51kfe0zfy` |
| KASA (CASH) | `cmrddw1rr000133a26i125aki` |
| KREDİ KARTI FAHR. (BANK) | `cms4gm32r000d103g1eco2xim` |

---

## Tahsilat hesapları — 2026-08-24 kararı

`KOBIPO_CARD_ACCOUNT_ID` = **PayTR Tahsilat** (`cmt7cp2gr0001zwlfk9hjnm22`, REYPO'da açıldı,
tip BANK, bankName `PayTR`). Kartlı satışta para önce PayTR'de bekler, bankaya hakedişle
(komisyon düşülmüş) geçer; brütü ara hesapta toplamak defterin gerçekle örtüşmesini sağlar.
Hakediş geldiğinde PayTR Tahsilat → banka transferi ve komisyon gideri ELLE yazılır.

`KOBIPO_BANK_ACCOUNT_ID` = **boş bırakıldı.** Havale tahsilatının hangi hesaba yazılacağı
netleşmedi. Bunun iki sonucu var ve ikisi de kodda karşılandı:

1. **Çapraz yedekleme kaldırıldı.** Önceki hâlde havale, kart hesabına düşüyordu — havale
   parası PayTR'ye hiç uğramadığı için bu, PayTR'de bekleyen tutarı olduğundan büyük
   gösterir ve hakediş mutabakatını bozardı. Artık her yöntem yalnız kendi hesabına yazar;
   hesap yoksa cari satırı hiç yazılmaz (eksik ama YANLIŞ olmayan kayıt).
2. **Kendini onarma eklendi.** Hesap tanımsızken kesilen faturada `InvoicePayment`
   `transactionId`siz yazılır. `KOBIPO_BANK_ACCOUNT_ID` sonradan girildiğinde günlük işin
   `reconcilePendingCollections` adımı eksik `Transaction`'ları tamamlar; fatura ve ödeme
   kaydı yeniden üretilmez, ikinci ödeme satırı oluşmaz. `reconcileOrderCollection`
   ayrı bir fonksiyondur: deneme sayacını artırmaz, `SALES_INVOICE` log'u yazmaz.

Yani havale hesabını sonradan belirlemek artık geri dönüşü olmayan bir eksiklik değil.
