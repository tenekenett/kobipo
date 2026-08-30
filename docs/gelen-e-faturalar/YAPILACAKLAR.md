# Gelen E-Faturalar — kalan işler

> **Tarih:** 2026-08-30 · Ekran: `app/(dashboard)/alis/gelen-e-faturalar/page.tsx` ·
> Uç: `app/api/e-donusum/inbox/route.ts`
>
> Bu belge, ekranın büyük onarımından sonra yapılan analizde çıkan ve **yapılmaya karar
> verilen** işleri tutar. Başka bir makinede devam edilecek; devralan için gereken bağlam
> ve tuzaklar burada.

## Nerede kalındı (bunlar TAMAM)

- **90 gün penceresi.** Mysoft dönem uçları 90 günü aşan aralığı tümden reddediyordu
  ("Başlangıç bitiş tarihi arasında 90 günden fazla zaman olamaz"), ekran ise 6 ay / 1 yıl
  sunuyordu. `listIncomingInvoices` artık aralığı ≤90 günlük pencerelere bölüyor; alınamayan
  pencere `warnings` ile yukarı taşınıyor. Test: `lib/integrations/e-invoice/incoming-inbox-window.test.ts`
- **`sentDate` kolonu.** Gönderilme tarihi ham JSON'dan kolona alındı, tarih aralığı bu
  eksende de sorgulanabiliyor (`dateField=docDate|sentDate`). İki migrasyon **canlıya
  uygulandı**: `20260830000001_incoming_invoice_sent_date.sql` ve
  `20260830000002_incoming_invoice_sent_date_tz_duzeltme.sql` (ikincisi 3 saatlik saat
  dilimi kaymasını düzeltiyor — offset'siz `createDate` Türkiye yerelidir).
- **Sunucu tarafı filtreleme + sayfalama + özet.** Gönderici, VKN, durum, profil,
  dönüştürme, tutar aralığı, genel arama; `page`/`pageSize`; özet kartlar filtrenin
  TAMAMINI sayar.
- **Kur çevrimi.** Özet tutarlar `currencyRate` ile ₺ karşılığına çevriliyor
  (`lib/integrations/e-invoice/incoming-amount.ts`).
- **Boş aralık ipucu**, **tutar kutusu doğrulaması**, **yarışan istek koruması**.

---

## 1 · Dışa aktarma (Excel / PDF / CSV) — en değerli

Projede tam bir dışa aktarma katmanı var (`lib/export/`, 18 veri kümesi) ama gelen
e-faturalar yok. Bu ekranın en sık işi listeyi muhasebeciye göndermek.

**Kural (repo geleneği): dışa aktarma KENDİ SORGUSUNU YAZMAZ**, listenin sorgusunu çağırır.
Şu an `where` kurulumu `app/api/e-donusum/inbox/route.ts` içinde satır içi duruyor.

Sıra:

1. **Ortak sorguyu ayır.** `lib/integrations/e-invoice/incoming-list-query.ts` (yeni):
   query paramlarından `where` + `orderBy` + `dateField` üreten saf fonksiyon
   (`buildIncomingInvoiceQuery`). Route'taki filtre mantığı buraya taşınır, route onu
   çağırır. Bu adım atlanırsa iki yerde iki farklı filtre doğar — katmanın var olma sebebi
   tam olarak bu.
2. **Dataset:** `lib/export/datasets/gelen-e-faturalar.ts` → `buildIncomingInvoicesDataset`.
   Model: `lib/export/types.ts` (`ExportDataset` / `ExportSection` / `ExportColumn`).
   Örnek alınacak dosya: `lib/export/datasets/invoices.ts`.
3. **Kayıt:** `lib/export/datasets/index.ts` içindeki `DATASETS`e
   `"gelen-e-faturalar": (companyId, params) => buildIncomingInvoicesDataset({...})` satırı.
   Route (`app/api/export/[dataset]/route.ts`) ve UI bileşeni **dokunulmadan** çalışır.
4. **Düğme:** ekrana `<ExportButton dataset="gelen-e-faturalar" companyId={companyId}
   params={{ ...ekrandaki filtreler }} />` (`components/export/export-button.tsx`).
   `ExportAction` ile sarmaya gerek yok — düğme salt-okunur yetkiyi kendi denetliyor.
   Param adları listenin query paramlarıyla **birebir aynı** olmalı (`dateField`,
   `startDate`, `endDate`, `q`, `sender`, `taxNumber`, `status`, `profile`, `linked`,
   `minAmount`, `maxAmount`).

**Kolon tasarımı — para birimi tuzağı.** Satır tutarları faturanın KENDİ birimindedir.
Excel'de tek bir "Tutar" kolonu koyup toplam aldırmak, 318 USD'yi 318 ₺ ile toplar — özet
kartlarda düzelttiğimiz hatanın aynısı. Kolonlar şöyle olmalı:

| Kolon | Tip | Not |
|---|---|---|
| Fatura Tarihi / Gönderilme Tarihi | `date` / `datetime` | ikisi de |
| Fatura No · Gönderen Ünvanı · VKN/TCKN | `text` | |
| Profil · Tip · Durum | `text` | |
| Net · KDV · Tutar | `money` | **kendi para biriminde**, `total: false` |
| Para Birimi · Kur | `text` / `number` | |
| **Tutar (₺)** | `money`, `total: true` | `toTryAmount()` ile; toplanabilir tek tutar kolonu |
| Alış Faturasına Bağlı | `boolean` | |

`filters` dizisine uygulanan filtrelerin okunur özeti yazılmalı (tarih ölçütü + aralık
dahil): kullanıcı altı ay sonra dosyanın hangi filtreyle üretildiğini görebilmeli.

**Sınır:** PDF'te 5.000 satır tavanı var (route sessizce kesmiyor, 413 + Excel'e yönlendiren
mesaj döndürüyor). Ayrıca `maxDuration = 60` zaten ayarlı.

## 5 · Detay sayfasında gönderilme tarihi yok

`app/(dashboard)/alis/gelen-e-faturalar/[uuid]/page.tsx` — "Fatura Bilgileri" kartında
Fatura No / Tarih / Profil / Tip / Para Birimi / Durum / Zarf var, **gönderilme tarihi yok**.
Listede kolon olarak duruyor, detayda kayıp. Sayfa client component; kaydı
`/api/e-donusum/inbox/[uuid]` üzerinden çekiyor — o ucun yanıtına `sentDate` eklenip
karta bir satır konacak. Biçim listedeki `fmtDateTime` ile aynı olmalı.

## 6 · Listedeki "Bağlı" rozeti tıklanabilir olsun

Rozet şu an sadece etiket. Detay sayfasında (`[uuid]/page.tsx:336`) ilişkili faturaya
bağlantı var:

```
/faturalar/{linkedInvoiceId}/onizleme?company={companyId}
```

Aynı hedef rozete verilecek; bir tık kazandırır.

**Tuzak:** satırın tamamı bağlantı yüzeyi (`StyledTableRow href=...`). Hücrenin içindeki
bağlantının çalışması için o hücre `data-row-link-skip` taşımalı, yoksa kaplama üstüne
biner ve tıklanamaz (bkz. `components/ui/styled-table.tsx` başındaki not). Durum hücresi şu
an bu işareti taşımıyor — rozet link olurken hücreye eklenmeli.

## 7 · Özet kartlar tıklanabilir olsun

TOPLAM / KABUL / RED / BEKLEYEN kartlarına tıklayınca durum filtresi o değere geçsin
(TOPLAM → filtreyi temizle), aktif karta tekrar tıklayınca filtre kalksın. Aynı şekilde
"N fatura zaten alış faturasına dönüştürülmüş" bandı `linked` filtresini kursun.

Kartlar `<button>` olmalı (`aria-pressed`, odak halkası, `cursor-pointer`); `setPage(1)`
unutulmamalı. Aktif kart görsel olarak da belli olsun (kenarlık kalınlaşması yeter).

---

## Yapılmayacak (şimdilik) — kaybolmasın diye

- **Yanıt süresi (8 gün) göstergesi.** Ticari faturaya süresinde yanıt verilmezse fatura
  zımnen kabul edilmiş sayılır. Kodda bu kurala dair **hiçbir iz yok**; bekleyen faturalar
  ekranda süresiz duruyor. Finansal sonucu olan en değerli ikinci iş — sıraya alındı.
- **Toplu kabul/red.** 36 bekleyen fatura tek tek, her biri ayrı onay kutusuyla
  yanıtlanıyor. Uygulamada toplu seçim deseni var: `personel/vardiya`, `restoran/menu`,
  `stok`.
- **Filtrelerin URL'ye yazılması.** Yenilemede sıfırlanıyor, link paylaşılamıyor, geri
  tuşu çalışmıyor.
- **Kolon başlığından sıralama.** Uygulamada henüz böyle bir desen yok; yeni desen açmak
  gerekir.
