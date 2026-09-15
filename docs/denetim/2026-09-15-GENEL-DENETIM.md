# Genel denetim — 2026-09-15

Kapsam: kod akışı (proxy → `ensureCompanyAccess` → uç), 283 API ucu, para/stok/cari
akışları, raporlar. Yöntem: kod okuma + canlı DB'de **salt-okunur** tutarlılık
sorguları (ilk parti çalıştı; ikinci parti izin gerektirdi, aşağıda "ölçülemedi").

Test paketi: 98 dosya / 1139 test geçiyor. Kapı katmanı (modül, sayfa, rol, arşiv,
süper-admin) sağlam; kapsama testleri (`route-owner-coverage`, `write-guard-coverage`,
`page-api-coverage`) var. Auth (signup, davet, sıfırlama, brute-force kilidi, JWT'de
yalnız kimlik, yetkiler DB'den) temiz. Billing/PayTR akışı tutar doğrulamalı ve
idempotent.

Aşağıdakiler bunun DIŞINDA kalan bulgular. Sıra: önem.

## Durum (2026-09-15, aynı gün)

| bulgu | durum | doğrulama |
|---|---|---|
| A1–A3 sahiplik | **düzeltildi** — `lib/company/owned.ts` (`assertOwned`) + `adjustWarehouseStock`/`transferWarehouseStock` içinde ikinci duvar; fatura POST/PUT, sipariş, teklif, irsaliye, çek/senet, muhasebe fişi, depo transferi | tarayıcı (Reypo): yabancı müşteri/ürün/depo → 403 `FOREIGN_RECORD` |
| A2 bakiye | **düzeltildi** — kaynak depoda yeterli stok yoksa 400 | tarayıcı: 999999 → "mevcut: 1059" |
| B1 KDV | **düzeltildi** — CONVERTED dışlanır, iadeler netlenir; ölü `/api/raporlar/kdv` kaldırıldı | tarayıcı: Tem 2026 hesaplanan 59.920,83 (eski 68.536,83) |
| B2 PUT fişi | **düzeltildi** — `lib/invoice/auto-entries.ts` (`syncInvoiceAutoEntries`) POST/PUT/dönüşümler | tarayıcı: 1000/200 → PUT → 800/160 |
| B3 dönüşüm stoğu | **düzeltildi** — sipariş/teklif dönüşümü `prepareInvoiceStockOps` + muhasebe fişi | tarayıcı: hizmet 0 hareket, stok 50→48 |
| B4 adisyon | **düzeltildi** — fiş toplamı ≠ hesap toplamı → 409 `TICKET_INVOICE_MISMATCH`; iptal fişe bağlanamaz | tarayıcı: 1,20 ₺ fiş → 409, 360 ₺ fiş → kapandı |
| B5 kasa yarışı | **düzeltildi** — POST/DELETE `increment`/`decrement`; tip doğrulaması | (yarış tarayıcıdan ölçülmez) |
| B6 iade yönü | **düzeltildi** — `isPurchaseReturn` → INCOME; CANCELLED/CONVERTED faturaya ödeme yok | tarayıcı: alış iadesi tahsilatı INCOME, kasa +120 |
| C3 fiş no | **düzeltildi** — `nextAutoEntryNo` (en büyük sayısal + 1) | tarayıcı: "YEV-001" sonrası 000003 |
| C4 fatura no yarışı | **düzeltildi** — otomatik numarada 5 deneme | — |
| C7 DELETE 403 | **düzeltildi** | — |
| C8 ölü uç | **kaldırıldı** | — |
| C2 çek tahsili | **düzeltildi** — `lib/cek-senet/tahsil.ts`: TAHSİL_EDİLDİ → seçilen kasaya INCOME/EXPENSE (`reference CEK:/SENET:`), cari taşımaz; durum geri alınınca/silinince geri sarılır; kâr-zarar/gelir-gider/harcamalar bu hareketi gelir saymaz; hareket Finans'tan silinemez (409) | tarayıcı: kasa +1500 → geri alınca eski; kâr/zarar "diğer gelir" 0 kaldı; formda hesap alanı |
| C5 izin | **düzeltildi** — `lib/personel/izin.ts`: çakışan bekleyen/onaylı izin 409 `LEAVE_OVERLAP`; yıllık bakiye aşımı 409 `ANNUAL_BALANCE_EXCEEDED` (ekran sorar, `allowOverdraft`); `days` sunucudan | tarayıcı: days=99 gönderildi → 3; çakışma 409; 2 kalanken 3 gün → 409, onayla → 201 |
| C9 şube VKN | **düzeltildi** — `lib/company/branch-identity.ts`: şubede VKN/vergi dairesi/e-Dönüşüm alanları 400 `BRANCH_IDENTITY_LOCKED`; ana firmada değişince şubelere yayılır; Firma Bilgileri'nde alanlar kilitli, e-Dönüşüm sayfası ana firmaya yönlendirir | tarayıcı: şube VKN PUT → 400; arayüz kilitli |
| C1 faturasız tahsilat = gelir | **karar bekliyor** | — |
| C6 bordro 2026 parametreleri | **kullanıcıya bırakıldı** (rakamlar bilinmiyor) | — |

Test verisi Reypo Medya Ajansı'nda oluşturulup silindi; kalan tek iz: 120/600/391
hesap planı satırları (standart hesaplar, bilerek bırakıldı).

---

## A. KRİTİK — çapraz firma yazma (IDOR)

`ensureCompanyAccess` firmaya erişimi doğrular; ama gövdedeki **yabancı anahtarların o
firmaya ait olup olmadığına** bazı uçlar hiç bakmıyor. cuid tahmin edilemez, ama id'ler
URL'de, paylaşılan PDF/linklerde, dışa aktarımlarda dolaşır; aynı kullanıcı iki hesapta
üye olabilir.

### A1. Fatura oluşturma/düzenleme — `app/api/e-donusum/invoices/route.ts`, `[id]/route.ts`
`customerId`, `supplierId`, `items[].productId`, `returnOfInvoiceId` firma süzgeçsiz.
- `product: { connect: { id } }` başka firmanın ürününü bağlar.
- Stok: `adjustWarehouseStock` → `product.update({ where: { id } })` → **başka firmanın
  ürün stoğu değişir**; `WarehouseStock` satırı bizim depomuz + onların ürünüyle açılır.
- Alışta `salePrice` güncellemesi (`prisma.product.update({ where: { id: item.productId } })`)
  → başka firmanın satış fiyatı ezilir.
- Yanıt `include: { customer: true, supplier: true }` → başka firmanın cari kartı (VKN,
  adres, telefon, e-posta) döner. PDF'e de basılır.
- `lib/cari/list-query.ts` CTE'leri (`invoice_totals`, `income_totals`…) `invoices` ve
  `transactions`ı **firma süzgeci olmadan** `customerId` üzerinden birleştirir → yabancı
  fatura o carinin bakiyesini bozar.

### A2. Depo transferi — `app/api/depolar/transfer/route.ts` → `transferWarehouseStock`
`fromWarehouseId`, `toWarehouseId`, `productId` doğrulanmıyor. Başka firmanın deposundan
kendi deponuza mal "taşınabilir". Ayrıca **bakiye kontrolü yok**: kaynak depo eksiye
düşer (`stok/movements` ucu ikisini de yapıyor — tutarsız).

### A3. Aynı sınıf, daha düşük etki
| uç | doğrulanmayan alan | etki |
|---|---|---|
| `siparis` POST/PUT | customerId, supplierId, items.productId | yabancı cari/ürün bağlanır; dönüşümde A1'e düşer |
| `teklif` POST/PUT | aynı | aynı |
| `irsaliye` POST | customerId, supplierId, items.productId, **invoiceId** | yabancı faturaya irsaliye bağlanır; `waybillOwnsStock` kararı bozulur |
| `cek-senet` POST/PATCH | customerId, supplierId, invoiceId | yabancı cariye çek yazılır; bakiyesi değişir |
| `muhasebe/fisler` POST | debitAccountId, creditAccountId | yabancı hesap planı satırı `include` ile döner |

Karşıt (doğru) örnekler: `faturalar/odemeler` (fatura+hesap), `finans/transactions`
(hesap), `stok/movements` (ürün+depo), `restoran/adisyonlar` (masa+müşteri+ürün),
`restoran/.../kalemler` (ürün+seçenek). Kalıp var, yayılmamış.

**Ölçüm (canlı, salt-okunur):** bugün çapraz kayıt **0** (fatura↔müşteri, fatura↔tedarikçi,
kalem↔ürün, stok hareketi↔ürün, depo stoğu↔ürün). Açık henüz vurulmamış.

**Öneri:** tek yardımcı — `assertOwned(tx, { companyId, productIds, customerId, supplierId,
warehouseIds, invoiceId })` — ve `adjustWarehouseStock`/`transferWarehouseStock` içine
ikinci duvar (`product.updateMany({ where: { id, companyId } })`, 0 satır → hata).

---

## B. YÜKSEK — hesap hatası / tutarsız davranış

### B1. KDV beyannamesi çift sayıyor — `lib/raporlar/vergiler.ts` → `computeVatDeclaration`
Süzgeç `status: { not: "CANCELLED" }`; **CONVERTED** dışlanmıyor. Faturaya dönüştürülen
fiş `CONVERTED` kalır, kalemleri yeni faturaya kopyalanır → KDV **iki kez**. Diğer tüm
raporlar `notIn: ["CANCELLED","CONVERTED"]` kullanıyor; Ba/Bs `isReceipt:false` ile
kurtuluyor. Ayrıca **iade faturaları (RETURN) hiç düşülmüyor**.
Canlı: Reypo Medya Ajansı — 6 CONVERTED fiş, **8.616 TL KDV** fazladan.

### B2. Fatura düzenleme muhasebe fişini güncellemiyor — `invoices/[id]/route.ts` PUT
Toplamlar yeniden hesaplanır, stok mutabakatı yapılır; `INVOICE_AUTO` / `INVOICE_AUTO_VAT`
fişlerine dokunulmaz. Yevmiye/kebir faturadan sapar. (DELETE siliyor, PUT güncellemiyor.)

### B3. Sipariş/teklif → fatura dönüşümü ayrı stok yolu kullanıyor
`siparis/[id]/faturaya-donustur`, `teklif/[id]/faturaya-donustur` doğrudan
`adjustWarehouseStock` çağırır; `prepareInvoiceStockOps` atlanır:
- **hizmet ürünü stoğa düşer** (irsaliye ve fatura yolu eliyor),
- reçete genişletilmez (kafede mamül kendi stoğundan düşer, hammadde düşmez),
- iskonto maliyete girmez (liste fiyatı yazılır),
- otomatik muhasebe fişi oluşmaz (doğrudan fatura ve fiş dönüşümünde oluşuyor).

### B4. Adisyon kapatma fiş tutarına bakmıyor — `restoran/adisyonlar/[id]/kapat` POST
Bağlanan fiş için yalnız "bu firmanın, satış, fiş, başka adisyona bağlı değil" kontrol
edilir. **Tutar/kalem eşleşmesi yok**: 1 TL'lik fişle 500 TL'lik adisyon kapanır. İskonto
tavanı ve ikram/iptal gerekçesi (K2) bu yoldan atlanır — kasiyer sahtekârlığı vektörü.
Öneri: fişin `totalAmount` ≈ adisyon `totals.net` (kuruş toleransı), kalem sayısı eşit.

### B5. Kasa hareketi bakiyesi oku-topla-yaz — `finans/transactions` POST/DELETE
Bakiye `newBalance = Number(account.balance) + …` ile yazılıyor — aynı kasaya
eşzamanlı iki işlem birini kaybeder. `faturalar/odemeler` aynı sebeple `increment`e
geçmiş; burası eski hâlde. (Tutar pozitifliği zaten kontrol ediliyordu — denetim
sırasında gözden kaçtı, tarayıcıda ölçülünce görüldü.)

### B6. Alış iadesi tahsilatı ters işaretli — `faturalar/odemeler` POST
`isSales = invoice.type === "SALES"`; `RETURN + returnKind=PURCHASE` (tedarikçiye iade,
para BİZE gelir) `EXPENSE` yazılır ve kasa **azalır**. Tedarikçi bakiyesi de iki kez
düşer. Ayrıca `CANCELLED`/`DRAFT` faturaya ödeme yazılabiliyor (`transactions` ucu
CANCELLED'ı reddediyor — tutarsız).

---

## C. ORTA

- **C1. Faturasız tahsilat gelir sayılıyor** — `kar-zarar.ts`, `gelir-gider.ts`:
  `customerId`li ama faturaya bağlı olmayan INCOME "diğer gelir". Aynı satış için sonra
  fatura kesilince satış da sayılır → **çift gelir**. Avans kavramı yok; en azından
  cari bağlı işlemler "diğer gelir"den dışlanmalı ya da ekranda ayrı satır.
- **C2. Çek/senet tahsili kasaya girmiyor** — `TAHSİL_EDİLDİ`ye geçiş `Transaction`
  yazmaz; banka bakiyesi çeki görmez. Kullanıcı elle yazarsa (cari seçerek) cariye
  ikinci alacak düşer (çek zaten PORTFÖYDE'yken düşmüştü). `status` serbest metin,
  `amount` pozitif kontrolü yok.
- **C3. Otomatik fiş numarası** — `Number(lastEntry.entryNo) + 1`: elle "YEV-001"
  girilmişse sonraki otomatik fiş `"000NaN"`. Sıra `createdAt`e dayanır, unique yok.
- **C4. Fatura numarası yarışı** — eşzamanlı iki otomatik numara → ikincisi 409 "Bu
  Fatura No zaten kayıtlı" (kullanıcı numara girmedi). `siparis` ucu 5 kez yeniden
  üretiyor; fatura ucu denemiyor. Kafede iki kasiyer aynı saniyede kesince olur.
- **C5. İzin kayıtları** — `personel/leaves` POST: çakışan izin kontrolü yok (aynı gün
  iki onaylı izin → bordroda iki kesinti), bakiye aşımı kontrolü yok, `days` istemciden
  gelip takvim aralığından bağımsız olabilir (bakiye `days`, puantaj tarih aralığı okur).
- **C6. Bordro parametreleri 2025'te kaldı** — `BORDRO_PARAMS` tek satır (2025). 2026
  hesapları 2025 asgari ücret/tarifeyle; ekran yılı yazıyor ama rakam yanlış.
- **C7. Fatura DELETE** — `Access denied` 403'e maplenmiyor (500 döner). SENT fatura
  fiziksel silinebiliyor (bilinçli, uyarılı — ama KDV/Ba-Bs GİB'den sapar; not).
- **C8. `/api/raporlar/kdv`** — kullanılmıyor ama açık: tip süzgeci yok (satış+alış+iade
  aynı toplama), matrah `qty×fiyat` (iskonto düşülmüyor). Kaldırılmalı.
- **C9. Şube VKN'si düzenlenebiliyor** — `companies/[id]` PUT `taxNumber`ı şubede de
  yazar; CLAUDE.md "VKN ana firmadan devralınır" der. Şube VKN'si ana firmadan ayrışırsa
  e-belge yanlış mükelleften gider.

---

## D. Ölçülemedi (izin gerekti)

Kasa/banka `balance` = Σ(hareket) + Σ(bağlantısız fatura ödemesi) eşitliği canlıda
sorgulanamadı (sınıflandırıcı "production read" dedi). B5'teki yarış ve C2 yüzünden
sapma bekliyorum; `scripts/` altına salt-okunur bir kontrol betiği koyup çalıştırmak
kullanıcı kararı.

Tarayıcı testi yapılmadı: dev sunucu kapalıydı ve `.env.local` canlı DB'ye bağlı —
yazma yapan senaryolar (A1/A2/B4) canlıda kirlilik bırakırdı.

---

## Doğru bulunan (kayıt için)
- Stok değişmezi Σ(WarehouseStock) = Product.stockQuantity: canlıda **0 sapma**.
- Genel iskontosuz faturada `totalAmount = Σ kalem`: **0 sapma**.
- Ödeme > kalan tutar kontrolü Decimal ile; fatura düzenleme tahsilatın altına inemez.
- Virman bacakları tüm raporlardan dışlanıyor (`NOT_TRANSFER_WHERE`).
- İade işaretleri cari liste/ekstre/yaşlandırmada tutarlı.
- Ödeme linki bayrakla kapalı; PayTR hash + tutar doğrulaması; süper-admin uçlarının
  tamamı kapılı; davet/sıfırlama jetonları tek kullanımlık.
