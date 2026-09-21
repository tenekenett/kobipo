# Menü Tarama — kafenin basılı menüsü satışa hazır ürüne

Kafe/restoran işletmesi elindeki menünün **fotoğrafını ya da PDF'ini** yükler;
okunan kalemler onaydan geçerek Restoran & Kafe satış ekranında satılabilir
ürüne (`Product`, `isSellable=true`) dönüşür. Reçete bu işin parçası DEĞİLDİR;
kullanıcı sonra kurar (§2, §3.6).

Kararlar §6'da; fazlar §4'te; uygulama sırasında verilen kararlar §6.1'de.
**Faz 0–3 koda girdi (2026-09-22).** Faz 4 ayrı karar.

---

## 1. Kapsam

### 1.1 Girenler

| girdi | neden |
|---|---|
| Menü FOTOĞRAFI (jpg/png/webp) | asıl kullanım: duvardaki/masadaki basılı menü, telefonla çekilir |
| Menü PDF'i (dijital ya da taranmış) | tasarımcıdan gelen menü; dijitalse metin katmanı okunur, ucuz ve hatasız |
| Aynı menünün BİRDEN ÇOK sayfası | 4 fotoğraf = 1 menü; tek oturumda birleşir (karar E) |

Okunan alanlar: **bölüm başlığı** (kategori), **ürün adı**, **fiyat(lar)**,
**açıklama metni**, para birimi, menü dibindeki KDV notu.

### 1.2 Kapsam dışı (bilerek)

- **Reçete/maliyet**: menüden bileşen çıkarılmaz. Açıklama metni saklanır ve
  ileride reçete sihirbazına ipucu olur (karar C), ama reçete kurulmaz.
- **Ürün görseli**: menüdeki fotoğraf kırpılıp `Product.imageUrl`a yazılmaz
  (karar F). Menü fotoğrafından kırpılan görsel düşük kaliteli olur ve belge
  taramadaki "dosya saklanmaz" kararının istisnası gerekirdi.
- **Alerjen, kalori, porsiyon gramajı**: okunmaz.
- **QR menü / dijital menü yayını**: ayrı iş.
- **Menü TASARLAMA** (ürünlerden PDF menü üretmek): ters yön, ayrı iş.

---

## 2. Değişmeyenler — koruma altındaki kararlar

Bu iş mevcut kafe modelinin ÜSTÜNE oturur; aşağıdakiler tartışmaya açık değil:

1. **Fiyat DB'de DAİMA NET saklanır** (`Product.salePrice`, Decimal(15,6)).
   Menüde yazan rakam KDV DAHİLDİR. `salePriceVatIncluded=true` yalnızca
   kullanıcının hangi modda girdiğini hatırlatır, hesabı değiştirmez.
2. **`ProductOption.priceDelta` KDV DAHİL saklanır** (Decimal(12,2)) — yani aynı
   ekranda iki ayrı konvansiyon var. Taşıyıcı kod bunları karıştırırsa büyük boy
   kahve sessizce yanlış fiyatlanır; dönüşüm tek yerde yapılır (§3.5).
3. **Ürün yazmanın kapısı `POST /api/stok/products`**, seçenek grubunun kapısı
   `POST /api/restoran/urun-secenekleri`. Menü tarama bu uçları ÇAĞIRIR; ürün
   oluşturma mantığının ikinci bir kopyası yazılmaz (fiş/belge taramadaki
   "kayıt yeni bir kapıdan geçmiyor" ilkesi).
4. **Eşleştirme Türkçe duyarsızdır**: `lib/text/tr-fold.ts` → `trFold`.
   "TÜRK KAHVESİ" ile "türk kahvesi" aynı üründür (CLAUDE.md).
5. **Reçetesi olmayan ürün satışta stoktan DÜŞMEZ** (`lib/stock/recipe-expand.ts`:
   "bileşenin aktif reçetesi VARSA açılır, YOKSA düşülür"). Menüden gelen ürün
   reçetesiz doğar; bu SESSİZ bir durumdur, ekran söylemek zorundadır (§3.7).
6. **Yeni tablo → RLS açılacak** (CLAUDE.md).

---

## 3. Mimari

### 3.1 Okuma yolu — menüde belirlilik merdiveni kısadır

Belge taramada dört kanal vardı (XML eki › karekod › metin katmanı › görsel).
Menüde ilk ikisi YOKTUR:

```
dijital PDF  →  metin katmanı (unpdf)          ← ucuz, hatasız, tercih edilen
taranmış PDF →  sayfa raster (pdfjs+canvas) → görsel
fotoğraf     →  görsel                          ← asıl kullanım
```

Altyapı hazır ve ölçülmüş: `lib/belge-ocr/girdi/pdf.ts` (metin + raster),
`girdi/gorsel.ts`, `saglayici.ts` (OpenRouter tek katman). Menü tarama bunları
İÇE AKTARIR, kopyalamaz.

**Sınıflandırıcı YOKTUR.** Kullanıcı zaten "menü yüklüyorum" diyor. Yerine tek
bir kabul denetimi: okunan şey menüye benzemiyorsa (fiyatsız, satırsız) uç
açıkça "bu bir menüye benzemiyor" der ve ürün üretmez.

### 3.2 Tek oturum, çok dosya (karar E)

```
menu-1.jpg · menu-2.jpg · menu-3.pdf
        ↓ sayfa sayfa okuma (her sayfa ayrı model çağrısı)
   ham satırlar (58)
        ↓ oturum içi tekilleştirme (trFold(ad) + fiyat)
   menü kalemleri (54)
        ↓ mevcut ürünlerle eşleştirme
   FARK LİSTESİ
```

Tekilleştirme oturum içindedir: aynı ürün iki sayfada geçerse teke iner. Bu
olmadan "menüde yok" hesabı (§3.8) da yanlış olurdu.

### 3.3 Çıkarım şeması (taslak)

```ts
type MenuKalem = {
  ad: string
  aciklama: string | null          // "espresso, süt, karamel" — ürüne YAZILMAZ (karar C)
  bolum: string | null             // menüdeki başlık → kategori adayı
  /** Menüde yazan fiyat(lar), KDV DAHİL. Tek fiyat → tek eleman. */
  fiyatlar: Array<{ etiket: string | null; fiyat: number }>  // etiket: "Küçük"/"Büyük"/null
  paraBirimi: string | null
  sayfa: number
}
type MenuOkuma = {
  bolumler: string[]               // başlıklar, sırayla
  kalemler: MenuKalem[]
  /** Menü dibindeki not: "Fiyatlarımıza KDV dahildir" → kdvDahil: true */
  kdvNotu: string | null
  guven: { kalemler: number; fiyatlar: number; bolumler: number }
}
```

### 3.4 Eşleştirme ve üç kova

Mevcut ürünler `trFold(ad)` ile eşlenir (kod/barkod menüde yoktur). Sonuç:

| kova | koşul | varsayılan eylem |
|---|---|---|
| **YENİ** | eşleşme yok | ürün oluştur |
| **FİYAT DEĞİŞMİŞ** | ad eşleşti, KDV dahil fiyat farklı | fiyatı güncelle |
| **AYNI** | ad ve fiyat eşleşti | dokunma (bilgi) |
| **MENÜDE YOK** | sistemde satılabilir ürün var, menüde yok | §3.8 |

Eşleştirme kuralı `lib/import/apply.ts` + `rows.ts` (`pickMatch`,
`trEqualsIds`) ile AYNI olmalı: Excel'den içe aktarımla menüden içe aktarım iki
farklı "aynı ürün mü" cevabı verirse aynı kafede iki kart açılır.

### 3.5 KDV ve fiyat çevrimi — işin en sessiz hata kaynağı

Menüde **120 ₺** yazıyorsa müşteri 120 ₺ öder. DB'ye net yazılır:
`net = 120 / (1 + oran/100)`.

Oran nereden gelir (karar B):

```
YENİ ürün    → oturumun GENEL ORANI (varsayılan %10; kategori sözlüğü
                alkollü içecek başlıklarında %20 önerir)
MEVCUT ürün  → ÜRÜNÜN KENDİ vatRate'i (oturumun oranı DEĞİL)
her ikisi de → kullanıcı satır bazında değiştirebilir
```

**Mevcut üründe ürünün kendi oranının kullanılması bir karardır:** zam menüsü
yüklendiğinde ürünün KDV oranı değişmiş olmaz; oturum oranıyla hesaplamak
%20'lik bir birayı %10 ile net'e çevirip fiyatı sessizce bozardı.

Firma geneli KDV ayarı YOKTUR (ölçüldü: oran yalnız `Product.vatRate`,
varsayılan 20). Oturum oranı ekranda seçilir, kalıcı bir ayar açılmaz.

Ekranda gösterilen rakam **KDV DAHİL** fiyattır (menüyle aynı); net yalnız
kayıtta kullanılır ve kartta küçük puntoyla yazar.

### 3.6 Varyant → seçenek grubu (karar A)

Menüdeki çok fiyatlı satır ayrı ürün açmaz:

```
Latte   ₺90 / ₺110 / ₺130
  → Product "Latte", salePrice = en düşük fiyatın NET'i
  → ProductOptionGroup "Boy" (isRequired=true)
       Küçük  priceDelta 0   isDefault
       Orta   priceDelta 20   (KDV DAHİL fark)
       Büyük  priceDelta 40
```

Sebep tek cümle: reçete etkisi (`ProductOption.recipeFactor`, SWAP/ADD) ve satış
ekranı bu yapı üzerine kurulu; üç ayrı ürün açmak reçeteyi de üçe bölerdi.
Grup adı fiyat etiketlerinden türetilir (boy sözlüğü: küçük/orta/büyük/S/M/L →
"Boy"; sıcak/soğuk → "Servis"); tanınmayan etiket kümesinde grup adı "Seçenek"
olur ve kullanıcı düzeltir. **Reçete çarpanı bu fazda YAZILMAZ** (boş bırakılır).

### 3.7 Denetimler (saf, `menu/validate.ts`)

Hiçbiri "doğru" demez; "insana sor" der.

- **başlık ürün sanılmış**: fiyatsız ya da ₺0 satır ("TATLILAR") → kalem değil
- **fiyat aralığı**: aynı menüde medyanın 20 katı / 20'de biri olan fiyat OCR
  hatasıdır (₺5 kahve, ₺5.000 çay)
- **sütun kayması**: iki kolonlu menüde ad ile fiyatın eşleşmesi bozulabilir —
  aynı fiyatın arka arkaya tekrarı ve artan/azalan bozulma şüphe işaretidir
- **tekrar eden ad**: oturum içinde aynı ad iki farklı fiyatla
- **para birimi**: TRY dışı okunduysa söylenir (`Product.currency`)
- **reçetesiz ürün**: oluşturulacak ürünlerin hiçbiri stoktan düşmeyecek — kart
  bunu YAZAR ve `/restoran/menu` reçete sekmesine bağlantı verir (§2/5)

### 3.8 "Menüde yok" olanlar (karar H)

Kart, yüklemeden önce **"bu yüklenenler menünün TAMAMI mı?"** diye sorar.

- **Tamamı değilse**: bu kova HİÇ gösterilmez. Yarım menü yüzünden çalışan bir
  ürünü kapatmak gerçek hasardır.
- **Tamamıysa**: eksik ürünler listelenir, satır satır "menüden kaldır"
  onaylanır → `isSellable=false`. Ürün SİLİNMEZ: stok, geçmiş satış ve reçete
  yerinde kalır, yalnız satış ızgarasından düşer.

### 3.9 Kayıt hedefleri

| kova | uç | gövde |
|---|---|---|
| YENİ | `POST /api/stok/products` | name, category, unit "ADET", vatRate, salePrice (NET), salePriceVatIncluded=true, isSellable=true, isActive=true |
| YENİ + varyant | `POST /api/restoran/urun-secenekleri` | productId, name ("Boy"), isRequired, options[{name, priceDelta, isDefault}] |
| FİYAT DEĞİŞMİŞ | §3.9.1'e bak | salePrice (ürünün kendi vatRate'iyle net'lenmiş) |
| MENÜDE YOK | `PATCH /api/stok/products/[id]` | isSellable=false |

**Onay satır satırdır** (kullanıcı kararı): "hepsini seç" kolaylığı vardır ama
yazma her satır için ayrı isteğe gider ve ekran "n/N yazıldı" ilerlemesi gösterir
(dekont kartındaki desen).

#### 3.9.1 Fiyat güncellemesinin ucu — TUZAK

Bugün ürün güncellemenin iki kapısı var ve İKİSİ DE bu iş için uygun değil
(ölçüldü, `app/api/stok/products/[id]/route.ts`):

- **`PUT`** tam gövde bekler: *"gövdesinde gelmeyen fiyat/stok alanlarını
  SIFIRLAR"* (kodun kendi yorumu). Yalnız `salePrice` göndermek alış fiyatını,
  stoğu, KDV oranını silerdi.
- **`PATCH`** yalnız `barcode`, `isService`/`isSellable`/`isIngredient` ve
  `imageUrl` kabul eder — fiyat alanı YOK. (Zaten "fiyat/stok alanlarına
  dokunulmaz" diye yazılmış: fotoğraf değiştirmek fiyat silmesin diye.)

İki yol var, Faz 3'te seçilecek:

1. **`PATCH`'e `salePrice` (+ `salePriceVatIncluded`) ekle** — tercih edilen.
   Küçük, kapsamı dar, "kısmi güncelleme" sözünü bozmaz; menü ekranının toplu
   zam ihtiyacı da aynı kapıdan geçer.
2. **`PUT`'u tam gövdeyle çağır**: ürünü oku, yalnız fiyatı değiştir, hepsini
   geri gönder. Kod değişmez ama iki istek eder ve yarış durumunda (aynı anda
   menü ekranından düzenleme) alanları geri sarar.

Kararı Faz 3'e bırakmak planlıdır; Faz 2'ye kadar fiyat güncellemesi yazılmaz.

### 3.10 Ekran

`/restoran/menu-tarama` — Restoran & Kafe modülü, menüde "Menü Tarama".

```
[ dosyaları seç: jpg/png/pdf, en çok 10 ]   ☐ Bu yüklenenler menünün TAMAMI
[ Oku ]            genel KDV oranı: (%10 ▾)

Menü okundu — 3 dosya, 5 sayfa, 54 kalem
  ▸ 12 YENİ                     [ hepsini seç ]
      Latte · Sıcak İçecekler · ₺110 (net 100,00 · %10)  [Boy: K/O/B]
  ▸ 43 FİYAT DEĞİŞMİŞ           [ hepsini seç ]
      Türk Kahvesi  ₺90 → ₺110   (kendi oranı %10 · net 100,00)
  ▸  3 AYNI
  ▸  5 MENÜDE YOK (yalnız "tamamı" işaretliyse)
[ Seçilenleri kaydet ]
```

Gelen kutusu belge taramadakiyle aynı mantıkta: okunmuş ama onaylanmamış oturum
KAYBOLMAZ.

### 3.11 Veri modeli

`document_scans` tablosu YENİDEN KULLANILIR, iki kolon eklenir:

```sql
ALTER TABLE public.document_scans ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BELGE';  -- BELGE | MENU
ALTER TABLE public.document_scans ADD COLUMN "sessionId" TEXT;                       -- çok dosyalı oturum
CREATE INDEX ... ON public.document_scans ("companyId", "kind", "createdAt" DESC);
```

Neden yeni tablo değil: satırın taşıdığı her şey aynı (dosya izi, durum,
çıkarım, hedefler, model/maliyet/süre) ve gelen kutusu kodu tek yerde kalır.
`kind` olmadan menü taramaları alış gelen kutusunda görünürdü.

`sessionId` aynı menünün dosyalarını bağlar; fark listesi oturum bazında kurulur.

### 3.12 Maliyet, kapı ve sayaç

- **Beyaz liste** (karar G): `MENU_TARAMA_COMPANIES` env, fail-closed, belge
  taramanın `lib/fis-ocr/access.ts` deseniyle birebir. Belge taramadan AYRI
  liste: kafe müşterisi ile e-fatura müşterisi aynı küme değil.
- **Modül kapısı**: Restoran & Kafe. İki kapı da geçilmeden sayfa görünmez.
- **Sayaç**: `ensureUsageLimit(companyId, "menu_tarama_sayfa_monthly", sayfa)` —
  varsayılan tavan 1000/ay (`lib/middleware/usage.ts`). Sayfa bazlıdır: 10
  sayfalık PDF 10 sayar.
- **Page-access**: `/api/stok/products` ve `/api/restoran/urun-secenekleri`
  write listelerine `/restoran/menu-tarama` eklenir (yoksa kısıtlı üye 403 yer).

### 3.13 Geri alma

Oturumun `targets` dizisi oluşturulan ürün id'lerini tutar. "Bu taramayı geri
al" yalnız **hiç satılmamış** ürünleri siler (adisyon/fatura kalemi varsa ürün
silinmez, `isSellable=false` yapılır). Fiyat güncellemesi geri alınmaz — eski
fiyat saklanmıyor; kullanıcı menü ekranından düzeltir.

---

## 4. Fazlar

### Faz 0 — Zemin ✅ 2026-09-22
- [x] `lib/menu-ocr/` iskeleti; `saglayici`/`girdi` belge-ocr'dan İÇE AKTARILIR
      (`girdi/pdf.ts`e hafif `pdfMetinOku` eklendi: menüde karekod/ek aranmaz)
- [x] `document_scans` migrasyonu `20260922000001_document_scans_menu_kind.sql`
      (`kind`, `sessionId`, iki indeks; RLS zaten açık). Belge tarama uçları
      `kind='BELGE'` süzer.
- [x] Beyaz liste `lib/menu-ocr/access.ts` (`MENU_TARAMA_COMPANIES`); üç deneme
      listesinin ortak kuralı `lib/deneme/beyaz-liste.ts`e alındı. Nav
      `/restoran/menu-tarama`, `DENEME_PAGE_FLAG` (sayfa → bayrak), page-access
      kuralları (`/api/restoran/menu-tarama`; `/api/stok` ve
      `/api/restoran/urun-secenekleri` write listesine sayfa eklendi).
- [x] Ölçüm tezgâhı `scripts/ai-menu-test.ts` (uygulama modülünü import eder;
      `dogru.json` ile kalem+fiyat doğruluğu)

### Faz 1 — Okuma ✅ 2026-09-22
- [x] `schema.ts` + prompt (bölüm/kalem/fiyat(lar)/açıklama/KDV notu/para birimi)
- [x] `boru.ts`: dosya → sayfa parçaları → sayfa başına model çağrısı (3 eşzamanlı)
- [x] `tekillestir.ts`: çok dosyalı oturum, `trFold(ad)` tekilleştirme, bölüm devri
- [x] `validate.ts` (§3.7) + birim testleri (normalize, tekillestir, validate — 36 test)

### Faz 2 — Eşleştirme ve fark listesi ✅ 2026-09-22
- [x] `eslestir.ts`: `pickMatch` + `trFold` (lib/import kuralıyla AYNI)
- [x] Dört kova; "menüde yok" yalnız `tamMenu`; hizmet/pasif/gizli ürün sayılmaz
- [x] `fiyat.ts`: net↔brüt, alkol sözlüğü, varyant → seçenek grubu + testler
- [x] `GET /api/restoran/menu-tarama/oturum/[sessionId]` fark listesini
      O ANKİ ürünlere karşı kurar (`?kdv=&tamami=` ile yeniden)

### Faz 3 — Kayıt ✅ 2026-09-22
- [x] Ekran `/restoran/menu-tarama` (`components/restoran/menu-tarama/*`):
      yükleme kartı, oturum kutusu, fark listesi; satır satır kayıt, n/N ilerleme
- [x] Ürün oluşturma `POST /api/stok/products` (KDV dahil + `salePriceVatIncluded`)
- [x] Fiyat güncelleme: §3.9.1'de 1. yol seçildi — `PATCH /api/stok/products/[id]`
      artık `salePrice` (+`salePriceVatIncluded`) ve `vatRate` kabul ediyor
- [x] Varyant → `POST /api/restoran/urun-secenekleri` (grup/şık adları kartta düzenlenir)
- [x] "Menüden kaldır" (`isSellable=false`), varsayılan SEÇİLİ DEĞİL
- [x] Reçetesizlik uyarısı + Menü & Reçeteler bağlantısı (CompanyLink)
- [x] Geri alma `POST .../oturum/[sessionId]/geri-al` (§3.13)

### Faz 4 — Sonrası (ayrı karar)
- [ ] Menüden ürün görseli kırpma (karar F: şimdilik hayır)
- [ ] Reçete sihirbazı: saklanan açıklama metninden bileşen önerisi
- [ ] `Product.description` alanı + QR menü (karar C: şimdilik tarama kaydında)

---

## 5. Riskler

- **Sütun kayması.** İki kolonlu menüde ad–fiyat eşleşmesi bozulursa hata
  SESSİZDİR: fiyatlar makul görünür, ürünler yanlış fiyatlanır. En önemli
  denetim budur; korpus gelene kadar güven aralığı düşük tutulur.
- **KDV oranı.** Yanlış oran net fiyatı bozar ve beyannameye kadar görünmez (§3.5).
- **Mükerrer ürün.** Eşleştirme zayıf kalırsa kafenin menüsü ikizlenir; satış
  ekranı kullanılamaz hâle gelir. Geri alma bu yüzden Faz 3'te, sonraya kalmaz.
- **Maliyet.** Fotoğraf yolu token pahalıdır; 10 sayfalık menü tek taramada
  sayacı yer. Sayfa tavanı ve beyaz liste şart.
- **El yazısı/tahta menü.** Kapsamda ama başarı oranı düşük olacak; denetimler
  kullanıcıyı uyarır, sessiz yanlış üretmez.
- **Güncelleme ucunun sıfırlama tuzağı** (§3.9.1): `PUT` eksik alanları siler,
  `PATCH` fiyatı kabul etmez. Bilmeden `PUT` ile "yalnız fiyat" göndermek
  kafenin alış fiyatlarını ve stoklarını sıfırlardı.

---

## 6. Kararlar — 2026-09-21'de verildi

| # | Soru | Karar | Sonuç |
|---|---|---|---|
| A | Boy/varyant sütunları | **Seçenek grubu** | tek ürün + "Boy" grubu; priceDelta KDV dahil (§3.6) |
| B | KDV oranı kaynağı | **Kategori/oturum varsayılanı** | yeni üründe oturum oranı, mevcut üründe ürünün kendi oranı; kullanıcı değiştirir (§3.5) |
| C | Menü açıklaması | **Tarama kaydında kalsın** | `Product` değişmez; metin `extraction`da durur, reçete sihirbazına ipucu |
| D | İlk faz | **İkisi tek ekranda** | yeni ürün + fiyat güncelleme aynı fark listesinde (§3.4) |
| E | Çok dosyalı menü | **Tek oturum** | `sessionId`, oturum içi tekilleştirme (§3.2) |
| F | Menüden ürün görseli | **Hayır** | kapsam dışı; Storage kararı açılmaz (§1.2) |
| G | Erişim kapısı | **Ayrı beyaz liste** | `MENU_TARAMA_COMPANIES`, fail-closed (§3.12) |
| H | Menüde olmayan ürünler | **Sor + listele** | "tamamı mı?" sorusu; satır satır `isSellable=false` (§3.8) |
| — | Reçete | **kapsam dışı** | menüden gelen ürün reçetesiz doğar; kart bunu söyler |

### 6.1 Uygulama sırasında verilen kararlar — 2026-09-22

| Konu | Karar | Neden |
|---|---|---|
| Hedef izi anahtarı | `trFold(ad)` (menüde-yok için `urun:<id>`), İNDEKS DEĞİL | Oturuma sonradan dosya eklenirse birleşik liste yeniden sıralanır; ad anahtarı değişmez |
| Hedef izlerinin yeri | Oturumun BAŞ satırı (`createdAt`, sonra `id`) | Oturum düzeyi bilgi tek yerde; `kayit.ts → oturumBasi` |
| Fark listesi nerede kurulur | SUNUCUDA, her `GET oturum`da | Ürünler değişmiş olabilir; kaydedilenler bir sonraki açılışta AYNI kovasına düşer |
| Bölüm devri | Başlıksız başlayan sayfa önceki sayfanın son bölümünü alır | Model sayfayı tek görür; "SICAK İÇECEKLER" 2. sayfaya taşar (ölçüldü) |
| Etiketsiz varyant | Şık adı fiyattan ("110 ₺"), "Orta" UYDURULMAZ; kart "adları düzeltin" der | Veri uydurmayan taraf güvenli taraftır |
| Sütun kayması sinyali | Aynı fiyat ≥8 ardışık → `olcelemedi` (patlamaz) | Tüm çaylar 40 ₺ de olabilir; zayıf sinyal, insan bakar |
| "Menüde yok" varsayılanı | SEÇİLİ DEĞİL; yeni/fiyat SEÇİLİ | Kapatmak gerçek hasar, açmak/güncellemek geri alınabilir |
| Geri almada "kullanılmış" | fatura/adisyon/teklif/sipariş/irsaliye kalemi, stok hareketi, reçete bileşeni | Biri varsa silmek geçmişi koparır; `isSellable=false` yeter |
| Fiyat güncelleme ucu | §3.9.1 **1. yol**: PATCH'e `salePrice` + `vatRate` | PUT sıfırlıyordu; oran yalnız kullanıcı DEĞİŞTİRDİYSE gider (karar B) |
| Beyaz liste kodu | `lib/deneme/beyaz-liste.ts` ortak; fiş/asistan/menü env adını bağlar | Üçüncü kopya yazmak yerine kural teke indi; testler yerinde |

## 7. İlerleme Günlüğü

- **2026-09-21** — Kapsam analizi ve plan yazıldı. Kod yok. Mevcut yapı okundu:
  `Product` (fiyat NET, `salePriceVatIncluded`), `ProductOptionGroup/Option`
  (priceDelta KDV DAHİL, `recipeFactor`/SWAP/ADD), `lib/import/apply.ts`
  (ürün eşleştirme kuralı), `lib/belge-ocr/*` (okuma katmanı), `document_scans`,
  `ensureUsageLimit`. Firma geneli KDV ayarı OLMADIĞI doğrulandı. §6 kararları
  alındı. Plan yazılırken bulunan tuzak: ürün güncellemenin `PUT`'u eksik
  alanları sıfırlıyor, `PATCH`'i fiyatı kabul etmiyor (§3.9.1) — fiyat
  güncellemesinin ucu Faz 3'te seçilecek.

- **2026-09-22** — Faz 0–3 koda girdi (tek oturumda). Ölçüm (`scripts/ai-menu-test.ts`,
  sentetik 2 sayfalık kafe menüsü, Gemini 3.7 Flash): **15/15 kalem+fiyat doğru**,
  $0,009, 8,6 sn. Boy grubu (Küçük/Orta/Büyük, 33cl/50cl), alkolde %20 önerisi,
  sayfalar arası "Çay" tekilleştirmesi, iki kolonlu sayfa ve "120.-"/"₺95"/"180,00"
  fiyat biçimleri doğru okundu. Bölüm devri ölçüldü: başlıksız 2. sayfa 1. sayfanın
  son bölümünü aldı (kullanıcı kartta düzeltir). 36 birim testi + guardrail testleri
  (page-access, write-guard, route-owner, page-api-coverage) geçti. **Canlıya çıkmadan
  ÖNCE migrasyon uygulanmalı**: `document_scans.kind/sessionId` olmadan belge
  taramanın `findUnique`i "column does not exist" ile düşer (Prisma tüm kolonları
  seçer). Gerçek fotoğraf korpusu (eğik/yansımalı/tahta menü) henüz ölçülmedi.
- **2026-09-22 (gece)** — Migrasyon canlıya uygulandı. Uçlar dev sunucuda GERÇEK DB'ye
  karşı uçtan uca sınandı (`scripts/test-menu-tarama.mjs --kaydet --geri-al`, reypo):
  2 dosya → tek oturum, alış kutusuna sızmıyor, 15 YENİ → 15 ürün + 4 Boy grubu
  (Küçük/Orta/Büyük, 33cl/50cl), net çevrimler ±0,000002, mükerrer hedef 409,
  tamamla → SAVED, ikinci okumada 15 AYNI, geri-al 15 sildi. Fiyatı bozulan iki
  ürünle ikinci tur: Latte 77→90 (%10), Çay ürünün KENDİ %20'siyle net 33,33
  (karar B), geri-al PRICE'a dokunmadı. **Bulunan hata:** oturum GET'te ve POST'ta
  `Number(sp.get("kdv"))` — param yokken `Number(null)`=0 ve 0 geçerli oran →
  tüm yeni ürünler %0 ile net=brüt kuruluyordu. `kdvOraniOku` (fiyat.ts) ile
  düzeltildi, regresyon testi eklendi. Ekran (Chrome) henüz gezilmedi.
- **2026-09-22 (Chrome turu)** — Ekran gerçek tarayıcıda gezildi (reypo, dev sunucu):
  menü + sidebar bayrağı, yükleme kartı, mükerrer dosya ("daha önce okunmuş · aç ·
  yine de oku"), 2 dosya → tek oturum, kart (denetim rozetleri, KDV/tamamı, kova
  bölümleri, seçenek grubu düzenleme), satır satır kayıt n/N, kaydedilen satırların
  AYNI kovasına düşüp "Ürün oluşturuldu + Seçenek grubu" rozeti alması, "menüde
  yok" → isSellable=false, geri alma (ürün silme + menüye geri açma). Kartta yapılan
  düzenlemeler DB'de doğrulandı: şık adı "Orta Boy", satır bazlı %1 (net 94,059406),
  işareti kaldırılan Kola yazılmadı. **İki ekran hatası bulunup düzeltildi:**
  (1) "yine de oku" dosyayı kutudan açık ESKİ oturuma ekliyordu → kuyruğun kendi
  oturumu (`kuyrukOturumu`) ayrıldı, "listeyi temizle · yeni menü" eklendi;
  (2) aynı oturuma 2. dosya eklenince açık kart yenilenmiyordu (id aynı) →
  `yenilemeAnahtari`. Ölçüm notu: dev'de her uç ~2–3 sn (TR → eu-central Supabase);
  satır başına 2–4 istek olduğu için 14 satır ~80 sn sürdü; canlıda (aynı bölge)
  beklenen çok daha kısa. Satır başına hedef izi kasıtlı (yarıda kesilirse iz kalır).
