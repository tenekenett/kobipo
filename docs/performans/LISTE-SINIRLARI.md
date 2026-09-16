# Liste sınırları — "sayı artınca kasma"

Şikâyet (2026-09-16): ürün listesi, fatura listeleri ve tablolarda sınır yok; kayıt
sayısı büyüdükçe ekranlar kasıyor. İnceleme üç ayrı katman buldu; ilk ikisi bu
turda kapatıldı, üçüncüsü plan olarak aşağıda.

## Ölçüm (canlı DB, salt okur — uçlarla birebir aynı sorgu şekli)

Bugünkü en büyük firmalar: 749 ürün / 516 hareket (HİDROEREN), 304 fatura / 835
gelen fatura (Reypo), 1.323 stok hareketi (Demo). Yani kasma bu boyutta **satır
sayısından çok satır başına taşınan yükten** geliyordu.

| Uç | Satır | Önce | Sonra |
|---|---|---|---|
| `/api/e-donusum/invoices` | 304 | 880 KB (1,4 s) | 178 KB (0,8 s) |
| `/api/teklif` | 21 | 41 KB | 12 KB |
| `/api/stok/movements` | 1.323 | 1,2 MB | 636 KB |
| `ayarlar/sube-bilgileri` açılışı | — | 906 KB (3 tam liste) | 2 KB (özet ucu) |
| `/api/stok/products` | 749 | 448 KB | 448 KB (değişmedi, aşağıya bak) |

Ölçüm yöntemi: `scripts/` altında geçici bir `.mjs` ile aynı `findMany` şekli
çalıştırılıp `JSON.stringify` boyutu alındı (`node --env-file=.env.local`).

## 1. Include şişmesi (KAPANDI)

Liste uçları ekranın hiç okumadığı ilişkileri taşıyordu:

- `app/api/e-donusum/invoices` GET: her faturaya tüm kalemler + her kalemin TAM
  ürün kaydı + tam cari kaydı + ödemeler. Liste ekranı 10 skalar alan + cari adı
  okuyor. Artık açık `select` (Invoice'un 47 sütunundan ~20'si). Yeni alan
  gerekirse listeye eklenir — `include: true`ya geri dönülmez. Ayrıca
  `customerId`/`supplierId` süzgeci eklendi; irsaliye→fatura eşleştirme penceresi
  tüm alışları çekip istemcide süzmüyor.
- `app/api/teklif`, `app/api/e-irsaliye`: `items { product }` düştü, `_count.items`
  kaldı; cari/fatura yalnız `{ id, name }`.
- `app/api/stok/movements`: ürün `{ id, name, code, unit }`.
- `ayarlar/sube-bilgileri`: üç tam listeyi (kalemli fatura + cari + ürün) yalnız
  `.length` için çekiyordu → `GET /api/companies/[id]/ozet` (aggregate + count +
  son 8 fatura). `/api/companies` sayfa kuralı kapsıyor.

Kural: **liste ucu kalem taşımaz.** Kalem gereken tek yer detay/düzenleme ekranı,
o `[id]` ucundan okur. İstisna irsaliyedeki `withItems=1` opt-in deseni.

## 2. Tablo sayfalaması (KAPANDI)

`components/ui/table-pagination.tsx` → `usePagedRows(rows, { pageSize, resetKey })`
+ `<TablePagination {...paged} />`. Süzgeçlere DOKUNMAZ: arama/sekme/kategori
eskisi gibi tüm kayıt üzerinde çalışır, yalnız DOM'a giden dilim (50) sınırlanır.
`resetKey` süzgeç durumunun özeti; değişince 1. sayfaya dönülür, veri yeniden
çekildiğinde sayfa korunur. Hook erken dönüşlerin (`if (!companyId) return`)
ÜSTÜNDE çağrılır — lint `rules-of-hooks` bunu zorlar.

Uygulandı: `/stok`, `/e-donusum`, `/satis|alis/siparis`, `/teklif`, `/alis/teklif`,
`/satis|alis/irsaliye`, `/e-irsaliye`, `/cek-senet` (çek + senet), `/finans`
(İşlemler), `/finans/hareketler`, `/muhasebe/yevmiye`, `/faturalar` (500 satır tek
seferde çiziliyordu), `/fisler`.

`/fisler`'de "Tümünü seç" GÖRÜNEN sayfayı seçer: yüklenen 500 satırın tamamını
seçseydi kullanıcı 50 satır görürken toplu dönüştürme görmediği fişlere işlerdi.

Zaten sayfalı olanlar (dokunulmadı): `/cari` (sunucu, 50), `/personel` (istemci,
20), gelen kutusu (sunucu), adisyonlar (100–200).

## Tarayıcı ölçümü (Chrome, dev sunucu, aynı oturum; eski kod `git stash` ile)

| | Eski | Yeni |
|---|---|---|
| `/stok` HİDROEREN (749 ürün) — `tbody tr` | 749 | 50 |
| DOM düğümü | 52.063 | 3.895 |
| JS heap | 126 MB | 29 MB |
| Tür süzgeci tıklaması (Event Timing `duration`) | 912 / 824 / 176 / 1.176 ms | 112 / 112 / 40 / 136 ms |
| En uzun long task | 1.031 ms | 105 ms |
| `/e-donusum` Reypo (304 fatura) — API gövdesi | 880 KB | 178 KB |
| DOM düğümü / heap | 9.406 / 131 MB | 1.783 / 24 MB |
| `sube-bilgileri` API gövdesi | ~906 KB (3 istek) | 1,7 KB |

Dev kipi (unminified React) mutlak süreleri şişirir; oran anlamlıdır (~8×).
Süzgeç → 1. sayfa, "Sonraki", fiş "Tümünü seç" (sayfa kapsamı) ve özet rakamları
(259 satış, 14 müşteri, 32 ürün = DB) tarayıcıda doğrulandı; konsolda hata yok.

Testin yakaladığı hata: sayfa en alta kaydırılınca sabit **Asistan düğmesi
"Sonraki"nin üstüne biniyordu** (tıklama asistanı açtı). İçerik kabının alt
boşluğu 24 px, düğme 68 px kaplıyor; `/cari`'nin mevcut sayfalaması da aynı
köşedeydi. Düzeltme layout'ta: `app/(dashboard)/layout.tsx` içerik kabına
`pb-24`.

## 3. Sunucu sayfalaması + uzak arama (YAPILMADI — plan)

Bugünkü boyutta gerekmiyor; 3–5 bin belge/ürüne ulaşan firmada gerekecek. İki iş:

### 3a. Belge listelerine `page/pageSize`

Tavansız uçlar: `/api/e-donusum/invoices`, `/api/siparis`, `/api/teklif`,
`/api/irsaliye`, `/api/e-irsaliye`, `/api/cek-senet`, `/api/finans/transactions`,
`/api/muhasebe/fisler`, `/api/faturalar/odemeler`, `/api/depolar/stok`.

Ev içi desen hazır: `lib/cari/list-query.ts` (`page` param'ı gelirse
`{ items, totalCount, page, pageSize }`, gelmezse dizi — geriye uyumlu) ve
`/api/faturalar` (500 tavan + `truncated` uyarısı + 90 gün penceresi). Tuzaklar:

- Ekranların süzgeçleri (arama, durum) İSTEMCİDE. Sunucu sayfalamasına geçen ekranın
  süzgeçleri de sunucuya taşınmalı; yoksa arama yalnız o sayfada arar. Arama
  `trContainsIds` ile (Türkçe duyarsız — bkz. CLAUDE.md).
- Özet kartlar (`openAmount`, `convertedAmount`, `pendingCount`…) tam liste üzerinden
  hesaplanıyor. Sayfalanınca bunlar `aggregate`/`groupBy` ile sunucudan gelmeli —
  gelen kutusundaki gibi ("özet SAYFAYA değil süzgecin tamamına bakar").
- `/stok` ayrıca: tür rozet sayıları, depo süzgeci ve düşük stok istemcide;
  hepsi sunucuya taşınmadan sayfalanamaz.

### 3b. Seçiciler uzak aramaya

Belge ekranları (fatura editörü, sipariş, teklif, irsaliye, e-irsaliye, çek-senet,
ekstre) mount'ta TÜM müşteri + tedarikçi + ürün listesini çekiyor;
`ProductCombobox`/`SearchSelect` bellek içi dizi alıyor. 749 ürünlü firmada her
fatura açılışı 448 KB. Çözüm: combobox `search=&limit=20` ile sunucudan çeksin;
`useProducts`/`useCustomers` (lib/swr) tam liste yerine ilk N + arama döndürsün.
Ölçüldü: cari listesindeki bakiye CTE'leri 113 caride belirleyici değil (485 ms vs
332 ms yalın kart; ikisi de ağ gecikmesi), o yüzden "yalın kart" modu tek başına
yeterli kazanç vermez — asıl kazanç tam listeyi hiç çekmemekte.

## Kayıt

- Ürün kaydı ~600 B (24 alan, hepsi küçük); `select` ile %30'dan fazla küçülmez.
  Ürün listesinde kazanç ancak 3a/3b ile gelir.
- `resolveAllUnitCosts` (AVCO) tek GROUP BY; ürün listesi her çağrıda çalıştırıyor,
  şimdilik sorun değil.
