# ÖKC — Aşama 1: Kobipo tarafı (cihazsız) — plan (2026-09-24)

Karar (kullanıcı): önce Kobipo tarafı — yazarkasa tanımı, Z no / EKÜ, Z raporu mutabakatı ve
**gerçek hesap bölme** — sonra POS (Aşama 2, `PLAN.md` Faz 0–7). Kullanıcı test cihazını getirecek.

Bu aşamanın ölçütü: POS geldiğinde yalnız **sürücü + webhook** yazılsın; kayıt yapısı, raporlar,
ekranlar ve bölme hazır olsun. Cihaz yokken de işe yarasın (Z raporu elle girilir).

---

## İlerleme

- **2026-09-24** — K1–K5 önerileri kullanıcı tarafından ONAYLANDI. A1–A3 kodu yazıldı
  (tip kontrolü + birim testleri geçti; canlı doğrulama migrasyon sonrası):
  - Migrasyon `supabase/migrations/20260924000002_okc_asama1.sql` (canlıya henüz UYGULANMADI)
  - `lib/okc/`: `devices.ts`, `z-report.ts`, `z-mutabakat.ts` (saf kural), `z-mutabakat-query.ts`,
    `receipt-okc.ts`, `access.ts` + testler
  - Uçlar: `/api/okc/devices[/id]`, `/api/okc/z-raporlari[/id]`, `/api/fisler/[id]/okc`;
    gün sonu ucuna `okc` özeti
  - Ekranlar: `/ayarlar/yazarkasa`, `/satis/z-raporlari`, fiş detayında "Yazarkasa" alanı,
    fiş listesinde ÖKC/Z no, gün sonunda Z kartı
  - Uygulanan küçük kararlar: `okcSource` = DEVICE | USER (numaraların Kobipo'ya nasıl girdiği);
    gün sonu listelemesinde 06:00 kesimi (mutabakat gerçek Z penceresini kullanır); Z'ye fişler
    DAMGALANMAZ, pencere her seferinde hesaplanır; fiş listesine ayrı süzgeç eklenmedi (Z detayı
    fişleri listeliyor).
- **2026-09-24 (devam)** — migrasyon canlıya uygulandı (kullanıcı), `check:rls` temiz.
  - **A1–A3 canlıda doğrulandı:** `node scripts/test-okc-asama1.mjs` → 52/52 (cihaz, Z1→fişler→Z2
    penceresi, birebir tutma, bilerek 1 kuruş fark doğru eksende, yazım hatası ayrı, fiş ÖKC no,
    kasiyer girer/düzeltemez, pasif cihaz, gün sonu kartı).
  - **A4 yapıldı:** `lib/restoran/split.ts` (+13 test), `POST /api/restoran/adisyonlar/[id]/bol`,
    adisyon ekranında "Ayrı hesaplara ayır" + hesap sekmeleri, masa planında "N hesap",
    sürükle-bırak koruması, kapanışta masa damgası son hesapta. `node scripts/test-hesap-bolme.mjs`
    → 34/34; mevcut `test-restoran-adisyon.mjs` → 160/160 (regresyon yok).
  - **A5 yapıldı:** üç ucun gövdesi MEKANİK taşındı (birebirlik betikle doğrulandı):
    `lib/invoice/create-invoice.ts`, `lib/finans/create-invoice-payment.ts`,
    `lib/restoran/close-ticket.ts`; `WriteActor` (`lib/api/write-actor.ts`, oturumsuz) +
    `lib/api/session-actor.ts` (uçlar). Sunucu kapanışı `lib/restoran/close-with-receipt.ts`;
    kanal kuralı ortak (`defaultPaymentAccounts`). `npx tsx scripts/test-sunucu-kapanis.ts` → 18/18.
    Taşımadan sonra adisyon 160 / ÖKC 52 / bölme 34 yeniden geçti.
  - **A6:** API düzeyinde uçtan uca tamam. Ekranlar (yazarkasa ayarı, Z raporları, bölme penceresi,
    hesap sekmeleri) TARAYICIDA GÖZLE doğrulanmadı — tip kontrolü + uç testleri var.
  - Not (bu işten bağımsız, önceden bozuk): `scripts/test-receipt-sale.mjs` `@/lib/format`
    takma adını çözemiyor (`payment.ts` importu 708c91d'den).
- **2026-09-24 (tarayıcı turu)** — A6 ekranları tarayıcıda gözle doğrulandı (yazarkasa ayarı,
  Z girişi + mutabakat, bölme penceresi, hesap sekmeleri, masa planı/listesi, fiş ÖKC alanı,
  gün sonu Z kartı). Çıkanlar düzeltildi: Z sayfası cihaz listesi gelmeden "yazarkasa
  tanımlayın" basıyordu; masa planında "N hesap" 2×2 masada kırılıyordu; ÖKC'li / Z'si
  girilmiş fiş serbestçe iptal edilebiliyordu → `receiptCancelVerdict` + `findCoveringZNo`
  (test-okc-asama1 → 58/58). `scripts/test-receipt-sale.mjs` alias sorunu giderildi (23/23).
  Yavaşlık ölçüldü: yerelden Supabase'e `SELECT 1` 400–850 ms (ağ); fiş POST ~30 sorgu →
  ~16 sn. Kod kaynaklı değil; POS hız ölçümü (Faz 0) canlı ortamda yapılmalı.
- **Sırada: Aşama 2 (POS).** Kullanıcı test cihazını getirecek; önce `PLAN.md` B (Token başvurusu).

## Kararlar (2026-09-24'te onaylandı)

| # | Soru | Öneri |
|---|---|---|
| K1 | Z raporu nasıl girer? | **Elle**, gün sonunda Z fişinden: toplam, KDV kırılımı, ödeme kırılımı, fiş adedi, iptal. Alanlar POS gelince gerçek Z fişine göre kesinleşir. Fotoğraftan okuma (belge tarama) sonra |
| K2 | Her fişe ÖKC fiş no elle girilsin mi? | **Hayır, zorunlu değil** — kasiyeri yavaşlatır. Fiş detayında isteğe bağlı alan; Aşama 2'de cihazdan otomatik gelir |
| K3 | Yazarkasa + Z raporu hangi firmalarda? | **Fiş kesen herkes** (kahveci, hızlı satış, market) — ÖKC restoranla sınırlı değil. Z raporları kendi sayfasında; restoran gün sonu raporu özetini gösterir |
| K4 | Bölmede adet bölünsün mü (3 çaydan 1'i)? | **Evet** — "herkes kendi aldığını" durumunda şart |
| K5 | Fiş kesmeyi sunucuya taşıma (`PLAN.md` Faz 3) bu aşamaya alınsın mı? | **Evet, en sona** — cihazdan bağımsız ve en riskli iş; POS geldiğinde bitmiş olmalı |

---

## Kapsam

### A1 — Veri modeli (migrasyon + RLS)

```
OkcDevice (okc_devices)          yazarkasa tanımı — ŞUBE bazlı (companyId)
  name, brand, model, serialNo   serialNo = cihazın mali sicil/seri no; @@unique(companyId, serialNo)
  ekuNo                          GÜNCEL EKÜ — EKÜ dolunca değişir, geçmişi Z kaydı taşır
  provider   "MANUAL"            Aşama 2: TOKEN | PAVO | ODEAL
  mode       null                Aşama 2: INSTANT (kasa) | LIST (masa)
  isActive                       Z kaydı olan cihaz silinmez, pasife alınır

OkcZReport (okc_z_reports)       Z raporu kaydı; @@unique(deviceId, zNo)
  deviceId, zNo, takenAt         takenAt = Z'nin alındığı TARİH-SAAT (gün sınırı budur, takvim günü değil)
  ekuNo                          o anki EKÜ (anlık kopya)
  receiptCount, grossTotal
  vatLines     Json              [{ rate, base, vat }]
  paymentLines Json              [{ method, provider?, amount }]
  cancelCount, cancelTotal
  source "MANUAL"                Aşama 2: DEVICE · sonra: SCAN
  note, createdBy

Invoice (+ kolon)                fişin mali kimliği FİŞİN ÜSTÜNDE durur (sepet yalnız taşıma)
  okcDeviceId  FK SetNull
  okcReceiptNo, okcZNo
  okcSource    null | DEVICE | MANUAL      MANUAL = "cihaza elle girildi"
  @@index([companyId, okcDeviceId, okcZNo])

RestaurantTicket (+ kolon)
  splitFromId  self FK SetNull   "ADS-0012'den bölündü" izi (mergedIntoId deseninin tersi)
```

Migrasyon: `supabase/migrations/2026092X_okc_asama1.sql`, sonuna yeni tablolar için
`ENABLE ROW LEVEL SECURITY`; `npm run check:rls`. Canlıya `scripts/apply-migration.js` (kullanıcı).

### A2 — Yazarkasa ayarları

- Sayfa: **Ayarlar → Yazarkasa** (`/ayarlar/yazarkasa`) — şube bazlı, `?company=` kuralı.
  Cihaz ekle / düzenle / pasife al; EKÜ güncelle.
- API: `GET/POST /api/okc/devices`, `PATCH/DELETE /api/okc/devices/[id]`
  (Z kaydı varsa DELETE → 409 "pasife alın").
- Sayfa kaydı: `lib/nav/pages.ts`, sayfa başlığı çözücü, rol: ADMIN + BRANCH_MANAGER yönetir.

### A3 — Z raporu + mutabakat

- Sayfa: **Satış → Z Raporları** (`/satis/z-raporlari`): liste (cihaz, Z no, tarih, toplam, fark) +
  "Z raporu gir" formu. KDV satırları firmanın kullandığı oranlarla önceden dolu; EKÜ cihazdan gelir.
  Rol: ADMIN, BRANCH_MANAGER, ACCOUNTANT girer/düzeltir; kasiyer girer (düzeltemez) — onaylanacak.
- **Karşılaştırma — tek saf fonksiyon** `lib/okc/z-mutabakat.ts` (testli). Kobipo tarafındaki fişler:
  1. fişin `okcZNo`su varsa → o Z (Aşama 2'de otomatik)
  2. yoksa → **zaman penceresi**: aynı şubede önceki Z'nin `takenAt`inden bu Z'ninkine kadar
     kesilen fişler. Gece yarısını aşan kafe de doğru çıkar (takvim günü değil Z günü).
     Şubede birden çok cihaz varsa cihaz ayırt edilemez → şube toplamı karşılaştırılır, ekran bunu YAZAR.
  - Üç eksen: **toplam**, **KDV oranı bazında** matrah + KDV, **ödeme tipi bazında**.
    Ödeme ekseni fişe bağlı tahsilattır (gün sonu raporunun tahsilat-tarihi ekseni DEĞİL).
  - Fark ≥ 0,01 → kırmızı satır + tutar. Sessiz geçilmez.
- Gün sonu raporuna (`/restoran/raporlar?rapor=gun-sonu`) Z özeti + "Z girilmemiş gün" uyarısı.
- Fiş listesi (`/satis/fisler`) + fiş detayı: ÖKC fiş no / Z no sütunu ve süzgeci; detayda isteğe
  bağlı elle giriş (K2). Dışa aktarım aynı list-query'den (export katmanı kuralı).
- **Açık nokta:** veresiye (açık hesap) fişin Z'de hangi ödeme tipinde göründüğü cihaza göre değişir
  → POS gelince netleşir; o güne kadar mutabakatta ayrı satır.

### A4 — Gerçek hesap bölme (SATIS-EKRANI.md F4)

- **Kural:** "masada tek açık adisyon" YENİ adisyon açarken AYNEN kalır (iki garson yanlışlıkla ayrı
  açmasın). Masada birden çok açık hesap **yalnız bölmeyle** doğar.
- API `POST /api/restoran/adisyonlar/[id]/bol` — gövde: `parts: [{ items: [{ itemId, quantity }] }]`
  - Kalemler **taşınır**, kopyalanmaz (birleştirmeyle aynı gerekçe). Adet bölünürse kaynak satır
    azalır, yeni satır açılır (seçenek, not, fiyat, `createdBy` kopyalanır).
  - Yalnız ödenecek (NORMAL) kalemler taşınır; ikram/zayi/iptal kaynakta kalır (stoğu kaynağın
    kapanışında düşer — bugünkü kural).
  - Kaynakta en az bir kalem kalmalı; kaynak `OPEN` olmalı; tek işlem (transaction).
  - İskonto: yüzde → her parçaya aynı yüzde; tutar → brüt oranında dağıtılır, kuruş farkı son
    parçaya (saf fonksiyon + test). Tavan kapanışta zaten yeniden ölçülüyor.
  - Yeni parça: aynı masa, `splitFromId` = kaynak, müşteri (cari) kaynakta kalır.
- Tek-adisyon varsayımının kırılacağı yerler (tarandı):
  - `app/api/restoran/masalar/route.ts` — `openTicket` (tek) → `openTickets[]` + masa toplamı
  - `components/restoran/floor-plan-canvas.tsx`, `floor-plan-screen.tsx` — rozet "2 hesap",
    toplam kardeşlerin toplamı, masaya dokununca hesap seçici
  - `app/api/restoran/adisyonlar/[id]/route.ts:99` — masa taşıma: hedefte açık hesap → 409 kalır;
    bölünmüş kardeşlerden biri başka masaya taşınabilir
  - `masalar/[id]` sayım kontrolleri zaten `count` — değişmez
  - Birleştirme ucu kardeşleri geri birleştirir (aynı masada iki açık adisyon) — test edilecek
- Ekran: "Hesabı böl" penceresi iki seçenekli olur:
  **"Tek fiş, ödemeyi böl"** (bugünkü) / **"Ayrı hesaplara ayır"** (yeni). Kalem atama aynı ekran
  (Loyverse deseni, "Buraya taşı"), adet için +/−. Adisyon ekranında kardeş hesaplar sekme olarak.
- Raporlar: ciro fiş bazlı olduğu için değişmez; adisyon listesi/denetim bölme izini gösterir.
- Aşama 2 notu: listeye gönderilmiş sepeti olan adisyon bölünürse sepet silinip parçalar gönderilir.

### A5 — Fiş kesmeyi sunucuya taşı (K5 onaylanırsa; `PLAN.md` Faz 3)

`/api/e-donusum/invoices` POST'undaki fiş yolu `lib/invoice/create-receipt.ts`e çıkarılır (oturum
yerine açık `actor`); tahsilat parçaları ve adisyon kapanışı aynı sunucu çağrısında. Mevcut ekranlar
aynı fonksiyondan geçer, davranış değişmez. Önce mevcut akışın uçtan uca testi yazılır, sonra taşınır.

### A6 — Uçtan uca doğrulama + belgeler

- Demo firmada: cihaz tanımla → kahveci satışı + adisyon + bölünmüş adisyon (adet bölmeli, iskontolu)
  → Z raporu gir (bilerek 1 kuruş farklı) → mutabakat farkı gösteriyor mu; gece yarısını aşan pencere.
- `docs/restoran/PLAN.md` "Açık riskler 1" ve `SATIS-EKRANI.md` F4 kapanır; gerekirse CLAUDE.md'ye kısa
  kural (fişin mali kimliği Invoice'ta; Z karşılaştırması tek fonksiyondan).

---

## Sıra

```
A1 model ──► A2 cihaz ayarı ──► A3 Z raporu + mutabakat
      └────► A4 hesap bölme (A1'deki splitFromId dışında bağımsız)
A5 sunucuya taşıma (en son, en riskli) ──► A6 uçtan uca
```

A3 ile A4 birbirinden bağımsız; kullanıcı önceliğine göre yer değiştirebilir.

## Kapsam dışı (Aşama 2 — POS gelince)

Cihaza sepet gönderme, webhook, sağlayıcı sürücüsü, "Cihaza elle girdim" düğmesinin cihaz akışı,
fatura bilgi fişi + e-Arşiv referansı, iade/iptal akışı. Ayrıntı: `PLAN.md`.
