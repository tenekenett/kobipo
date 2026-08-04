# Restoran & Kafe — denetim boşlukları ve mantık temizliği

> Bağlam: [SATIS-EKRANI.md](./SATIS-EKRANI.md) (K2 ikram/zayi/iptal · K8 kontrol bütçesi) ·
> [ASAMA2.md](./ASAMA2.md) (adisyon) · [KROKI-EDITORU.md](./KROKI-EDITORU.md) (masa durumları,
> birleştirme) · [SADELESTIRME.md](./SADELESTIRME.md) (maliyet kapısı)
>
> **Tarih:** 2026-08-04 · Bu belge, v1 + Aşama 2 tamamlandıktan sonra yapılan kod taramasının
> bulgularını ve kapatma sırasını tutar.

## Neden

Modül uçtan uca çalışıyor. Tarama üç tür açık gösterdi:

1. **İz bırakmayan yollar.** K2 "kalem silinmez, işaretlenir" diyor ama silme yolu duruyor ve
   ekrandaki adet düşürme onu çağırıyor. Aynı şekilde kalem iptalinde sebep zorunlu, **adisyon**
   iptalinde değil. Ölçülemeyen kaçak, olmayan kaçaktır.
2. **Yazılıp hiç okunmayan veri.** `openedBy` / `closedBy` / `createdBy` dört yerde yazılıyor,
   hiçbir sorguda okunmuyor. İkram/zayi stok hareketi maliyetiyle birlikte yazılıyor, hiçbir
   raporda görünmüyor. `mergedIntoId` yazılıyor, raporlar hâlâ "iptal" sayıyor.
3. **Kapanış kırılganlığı.** Fiş kesilip adisyon kapanamazsa masa açık kalıyor ve **ikinci fiş**
   kesilebiliyor; eksik tahsilat sessizce "kimseye yazılmayan" açık hesap oluyor.

Ayrıca üç küçük ama gerçek hata: v1'in altı ucunda sunucu tarafı modül kapısı yok (ücretli
özellik baypası), rezervasyon çakışma uyarısı sunucunun saat dilimini yazıyor (Vercel'de UTC),
seçenekli kalemler fiyat eşitliği tutmadığı için birleşmeyip ikiye bölünüyor.

---

## Sıra ve gerekçesi

Riski düşükten yükseğe **ve** bağımlılık sırasına göre: Faz 2 sebep kodlarını üretmeden Faz 4
raporu boş kalırdı; Faz 3 ekran akışını değiştirdiği için şema işlerinden sonra geliyor.

| Faz | İş | Dokunulan | Şema |
|---|---|---|---|
| **1** | 1 modül kapısı · 2 rezervasyon saati · 3 fiyat yuvarlama | 8 dosya | — |
| **2** | 4 kalem silme → VOID · 5 adisyon iptal sebebi · 6 kahveci ikram/zayi | API + 2 ekran | + 2 kolon |
| **3** | 7 çift fiş koruması · 8 eksik tahsilat uyarısı | kapanış akışı | — |
| **4** | 9-11 denetim raporu · 12 rezervasyon no-show | yeni uç + sekme | — |
| **5** | mutfak ekranı (KDS) · yetki kademesi · vardiya/kasa devri | *(ayrı planlar)* | + |

---

## Faz 1 — Riski sıfır düzeltmeler

**İş 1 — Modül kapısı.** `assertRestaurantModule` Aşama 2'de yazıldı ve yeni uçların hepsi ondan
geçiyor; v1'in dört rapor + iki reçete ucu hâlâ korumasız (`grep` ile doğrulandı: 0 kullanım).
`restaurant` kapalı bir firmanın kullanıcısı bunları çağırabiliyor.

**İş 2 — Rezervasyon çakışma saati.** `reservations.ts` çakışma etiketini
`toLocaleTimeString("tr-TR")` ile üretiyor; sunucu saat diliminde. Raporlarda titizlikle yapılan
`AT TIME ZONE 'Europe/Istanbul'` dönüşümü burada atlanmış — kullanıcı "09:46" görürken kayıt
TSİ 12:46.

**İş 3 — Kalem birleştirme.** Seçenek farkı net'e çevrilince (`grossDelta / (1 + vat/100)`)
fiyat 6 haneyi aşabiliyor; kolon `Decimal(15,6)`. Yazılan değer yuvarlanıyor, aranan değer
yuvarlanmıyor → aynı kalem birleşmiyor, adisyonda iki satır görünüyor.

## Faz 2 — Denetim bütünlüğü

**İş 4 — Silme yerine VOID.** Sunucu tarafı asıl savunmadır: `DELETE /kalemler/[itemId]` artık
kalemi silmiyor, `VOID` + `MISENTRY` işaretliyor. Ekranda adet düşürücünün alt sınırı adisyonda
1 oluyor; "hiç girilmemeliydi" durumu ⋮ menüsündeki **İptal** ile ve sebebiyle kaydediliyor.
Kahveci sepeti sunucuda yaşamadığı için (istemci state'i) bu kuraldan etkilenmiyor — orada
satırı silmek hâlâ serbest, çünkü henüz hiçbir şey olmamıştır.

**İş 5 — Adisyon iptal sebebi.** Kalemde zorunlu olan sebep, 12 kalemlik dolu bir adisyonu
iptal ederken sorulmuyordu. `cancelReasonCode` / `cancelReason` eklendi (eklemeli migration).
Kalemi olmayan adisyon eskisi gibi gerçekten siliniyor — yanlış açılmış boş kayıt için sebep
sormak gürültüdür.

**İş 6 — Kahveci ekranında ikram/zayi.** Bugün tezgâhta verilen personel kahvesi ya hiç
girilmiyor (malzeme stokta kalıyor) ya da tam fiyattan satılmış görünüyor. K2'nin masada çözdüğü
problemin tezgâh karşılığı yok. Sepet satırı ⋮ menüsünden `COMP`/`WASTE` işaretlenebiliyor;
fişe yalnız `NORMAL` satırlar giriyor, işaretli satırların malzemesi `writeCompWasteStock` ile
düşüyor. Yeni görünür kontrol eklenmiyor (⋮ zaten vardı) — K8 bütçesi korunuyor.

## Faz 3 — Kapanış dayanıklılığı

**İş 7 — Çift fiş.** Fiş kesilip `POST /kapat` başarısız olursa masa açık kalıyor ve ikinci
deneme **ikinci fiş** kesiyor (stok iki kez düşer). Fişin notundaki `ADS-…` damgası zaten var,
kimse okumuyordu: `GET /kapat` aynı damgayı taşıyan iptal edilmemiş fişi bulup döndürüyor, ekran
"mevcut fişe bağla / yeni fiş kes" diye soruyor.

**İş 8 — Eksik tahsilat.** Bölmede parçalar toplamı toplamı tutmayabiliyor; kalan tutar sessizce
açık hesap oluyor ve cari seçili değilse **kimseye** yazılmıyor. Veresiyede bu uyarı vardı,
bölmede yoktu.

## Faz 4 — Ölçüm

**İş 9-11 — Denetim raporu.** Yeni sekme, üç soruyu tek yerde cevaplıyor ve **hiç yeni veri
yazmıyor** — hepsi bugün DB'de duran ama okunmayan alanlar:

| Bölüm | Kaynak |
|---|---|
| İkram / zayi tutarı, sebep ve ürün kırılımı | `ADJUSTMENT` hareketleri (maliyet satış anında donmuş) |
| İptal: VOID kalemler + iptal edilen adisyonlar sebebiyle | `RestaurantTicketItem.status` · `cancelReasonCode` |
| **Birleştirilenler ayrı** | `mergedIntoId` — cirosu kaybolmadı, hedefe geçti |
| Personel kırılımı (adisyon, ciro, ort. sepet, ikram/iptal) | `openedBy` / `closedBy` / `createdBy` |

**İş 12 — Rezervasyon.** Süresi geçmiş `PENDING` kayıtlar sonsuza kadar bekliyor; listelemede
`NOSHOW`'a düşüyor ve denetim sekmesinde "gelmeme oranı" ile rezervasyondan doğan ciro
(`ticketId` bağı) görünüyor.

## Faz 5 — Ayrı plan gerektirenler

- **Mutfak / bar ekranı (KDS).** Sipariş mutfağa hiç düşmüyor. Kalemde `createdAt` ve `order`
  var; "hazırlanıyor / hazır" durumu eklendiğinde İş 4'ün kuralı da kalıcı temelini bulur
  (servis edilmiş kalem iptal edilemez, ancak zayi/ikram olur).
- **Yetki kademesi.** İskonto, ikram, adisyon iptali bugün write yetkisi olan herkeste.
- **Vardiya / kasa devri.** Gün sonu takvim gününe bakıyor; iki vardiyalı işletmede mutabakat yok.
- **Menü performansında seçenek etkisi** → `stock_movements.sourceProductId` (ilerleme.md'de de
  açık duran iş).

---

## Doğrulama yöntemi

Her fazın sonunda: `npx tsc --noEmit` · `npx eslint <değişen dosyalar>` · ilgili betikler
(`test-restoran-adisyon.mjs` gerçek uçlar · `test-ticket-totals.mjs` · `test-comp-waste-stock.ts`
· `test-payment.mjs` · `test-receipt-sale.mjs` · `test-recipe-expand.mjs` · `test-avco-revert.js`).
Değişen davranışların testi **eklenir**, mevcut beklentiler körlemesine güncellenmez.

`prisma db push` KULLANILMAZ (canlı müşteri verisi): eklemeli, idempotent SQL migration.

---

## Uygulama kaydı

### ⚠️ Başka bir makinede devam ederken ÖNCE

```bash
git pull
npm install
npm run db:generate   # ŞART — şemaya cancelReasonCode/cancelReason eklendi.
                      # Atlanırsa "Unknown argument cancelReasonCode" hatası gelir.
npm run dev
```

**`db:push` GEREKMİYOR.** `supabase/migrations/20260804000001_ticket_cancel_reason.sql`
2026-08-04'te canlı Supabase'e uygulandı (`npx prisma db execute`); iki makine aynı DB'ye
bağlandığı için şema hazır — yalnız Prisma client üretmek yeterli.

> Windows'ta `prisma generate` dev sunucusu AÇIKKEN `EPERM` verir (DLL kilidi):
> önce dev'i durdur, üret, sonra başlat.

**İlk iş:** `node scripts/test-restoran-adisyon.mjs` temiz koşuyla tekrarlanmalı (aşağıdaki
"Doğrulama durumu"na bak).

---

### Faz 1 ✅ (2026-08-04)

| İş | Değişen | Not |
|---|---|---|
| 1 — Modül kapısı | `raporlar/{karlilik,tuketim,menu-performans,gun-sonu}`, `recipes`, `recipes/[id]` | Altısı da `assertRestaurantModule`; GET **ve** POST/DELETE |
| 2 — Rezervasyon saati | `lib/restoran/reservations.ts` | `timeZone: "Europe/Istanbul"` — sunucu TZ'si (Vercel UTC) yanlış saat yazıyordu |
| 3 — Fiyat yuvarlama | `adisyonlar/[id]/kalemler` | `round6`; yazılan ve aranan değer artık aynı, seçenekli kalem birleşiyor |

### Faz 2 ✅ (2026-08-04)

| İş | Değişen | Karar |
|---|---|---|
| 4 — Silme yerine VOID | `kalemler/[itemId]` DELETE · `ticket-panel.tsx` | Uç kalemi SİLMİYOR, `VOID`+`MISENTRY` işaretliyor. Panelde yeni `allowDelete` prop'u: adisyonda adet alt sınırı **1**, kahveci sepetinde 0 (sepet tarayıcıda yaşar, silmek iz kaybettirmez) |
| 5 — İptal sebebi | şema + migration · `adisyonlar/[id]` DELETE · `ticket-screen` | Kalemi olan adisyonda `?reasonCode=` ZORUNLU (400). Boş adisyon eskisi gibi sorusuz silinir. `TICKET_CANCEL_REASONS` dört kod |
| 6 — Tezgâhta ikram/zayi | **yeni** `app/api/restoran/ikram/route.ts` · `cafe-sale-screen` | Sepet satırı ⋮'den `COMP`/`WASTE` işaretlenir; fişe yalnız `NORMAL` girer. Referans **fişin id'si** → fiş iptali ikramı da geri alır. Sepetin tamamı ikramsa fiş kesilmez, düğme "İkramı Kaydet" olur |

`writeCompWasteStock` artık `{ written, failed }` döndürüyor (fiş kesmeden çağıran kullanıcıya
hata gösterebilsin; adisyon kapanışı eskisi gibi yok sayıyor).

### Faz 3 — kod tamam, doğrulaması yarım (2026-08-04)

| İş | Değişen | Durum |
|---|---|---|
| 7 — Çift fiş koruması | `kapat` GET → `existingInvoice` · `ticket-screen` diyaloğu | ✅ e2e'de doğrulandı (8d bölümü) |
| 8 — Eksik tahsilat uyarısı | `ticket-screen` + `cafe-sale-screen` | ⏳ **e2e yok** — ikisi de saf ekran akışı; elle ya da tarayıcıda bakılmalı |

`GET /kapat` artık adisyonun damgasını taşıyan, **başka adisyona bağlı olmayan**, iptal
edilmemiş fişi arıyor (`restaurantTicket: { is: null }`). Ekran "mevcut fişe bağla / yine de
yeni fiş kes" diye soruyor; birincisi yeni fiş KESMEZ, tahsilat da denemez.

### Doğrulama durumu

| Betik | Sonuç |
|---|---|
| `test-restoran-adisyon.mjs` | **131 geçti / 5 kaldı** — kalan 5'i **sayfa render'ı** (`HTTP 500`), Faz 3 dosyaları kaydedilirken Turbopack yeniden derliyordu. Aynı sayfalar hemen ardından elle çağrıldığında **200** döndü. Temiz koşu tekrarlanmadı (oturum kesildi) — **yeni makinede ilk iş bu** |
| `test-ticket-totals` · `test-payment` · `test-receipt-sale` | 38/38 · 34/34 · 23/23 |
| `test-recipe-expand` · `test-avco-revert` · `test-comp-waste-stock` | 84/84 · 15/15 · 13/13 |
| `tsc --noEmit` | ✅ (kalan tek hata `.next/types/validator.ts` — ESKİ, ilgisiz) |
| `eslint` (değişen dosyalar) | ✅ temiz |

Yeni eklenen e2e bölümleri: **8c** (tezgâh ikramı: sebep zorunlu, ADJUSTMENT hareketi,
maliyetin donması, fiş iptalinde geri alınması), **8d** (yarıda kalan kapanış), **5b** (iptal
sebebi), modül kapısında 6 uç, seçenekli kalem birleşmesi.

### Sırada — Faz 4

- **İş 9-11 denetim raporu:** yeni `GET /api/restoran/raporlar/denetim` +
  `components/restoran/reports/denetim.tsx` + `?rapor=denetim` sekmesi. Kaynaklar hazır:
  ikram/zayi `ADJUSTMENT` hareketleri (`description LIKE '%İkram:%' / '%Zayi:%'`), VOID
  kalemler, `cancelReasonCode`, `mergedIntoId` (iptalden AYRI sayılmalı), personel için
  `openedBy`/`closedBy`/`createdBy` → `users` join. Gün sonu raporundaki iptal sayacı da
  birleştirmeyi ayırmalı.
- **İş 12 rezervasyon:** süresi geçmiş `PENDING` → `NOSHOW` (listelemede, grace ile) +
  denetim sekmesinde rezervasyon özeti.

Faz 5 (mutfak ekranı, yetki kademesi, vardiya/kasa devri) her biri kendi planını istiyor.
