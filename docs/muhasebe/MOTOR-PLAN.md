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
| Bu oturumda | Yalnız plan; 2. faza geçilmedi. |

## Durum

**1. faz — temel (yapıldı, commitlenmedi, migrasyon UYGULANMADI):**

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
   (`lib/cari/bakiye-asof.ts` — bilançoyla aynı kaynak, müşteri 120 / tedarikçi 320, ters
   bakiye avans 340/159), kasa-banka (`cashBalanceBefore`), portföydeki çek/senet (101/121,
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
| Bordro | B 770/720/740 (brüt) · A 335 (net), 360 (gelir + damga), 361 (SGK işçi) |

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

- Şubede muhasebe modülü: defter ana firmada tutulduğuna göre modül yalnız ana firmada mı
  satın alınır, şubeler kapsanır mı? (Abonelik firma bazında; defter tüzel kişi bazında.)
- Luca/Zirve aktarım formatı: müşavirden örnek dosya.
- Modül fiyatı.
