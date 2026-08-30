# Gelen E-Faturalar — durum ve kalan işler

> **Son güncelleme:** 2026-08-30 · Ekran: `app/(dashboard)/alis/gelen-e-faturalar/` ·
> Uçlar: `app/api/e-donusum/inbox/**` · Ortak sorgu:
> `lib/integrations/e-invoice/incoming-list-query.ts`

## Tamamlananlar

**Mysoft 90 gün penceresi.** Dönem uçları 90 günü aşan aralığı tümden reddediyordu
("Başlangıç bitiş tarihi arasında 90 günden fazla zaman olamaz"), ekran ise 6 ay / 1 yıl
sunuyordu — yani seçenek vardı, karşılığı yoktu. `listIncomingInvoices` aralığı ≤90 günlük
ardışık pencerelere bölüyor, sonuçları ETTN ile tekilleştiriyor; alınamayan pencere
`warnings` ile yukarı taşınıyor (kısmî başarı sessiz geçilmez). Sınır gerçek API'ye karşı
ölçüldü: 89 ✓ · 90 ✓ · 91 ✗. Test: `incoming-inbox-window.test.ts`

**`sentDate` kolonu.** Gönderilme tarihi ham JSON'dan kolona alındı; tarih aralığı
`dateField=docDate|sentDate` ile iki eksende de sorgulanabiliyor. Mysoft'un dönem filtresi
zaten gönderim tarihine göre çalıştığı için, belge tarihine göre süzülen listede kayıtlar
kayboluyordu (ölçüldü: son 30 günde gönderime göre 116, belgeye göre 96 fatura).

> **Saat dilimi tuzağı:** Mysoft aynı kayıtta `docDate`i offset'li
> (`2026-07-28T00:00:00+03:00`), gönderim tarihinin geldiği `createDate`i offset'siz
> (`2026-08-28 14:52:03`) gönderiyor. Offset'siz değer **Türkiye yerelidir** — 1.421 kaydın
> saat dağılımı %81 oranıyla 08:00–19:00 arasında toplanıyor. UTC sayılırsa değer 3 saat
> ileri kayar ve gece yarısına yakın gönderim ertesi güne taşar. Kural
> `incoming-sent-date.ts` içinde, migrasyon da aynı offset'i uygular.

Uygulanan migrasyonlar: `20260830000001_incoming_invoice_sent_date.sql` ve
`20260830000002_incoming_invoice_sent_date_tz_duzeltme.sql`.

**Sunucu tarafı filtreleme + sayfalama + özet.** Gönderici, VKN, durum, profil, dönüştürme
durumu, tutar aralığı, genel arama; `page`/`pageSize`; özet kartlar sayfayı değil filtrenin
TAMAMINI sayar. Sorgu kurulumu `incoming-list-query.ts` içinde — liste ucu ve dışa aktarma
aynı modülü çağırır.

> "Beklemede" filtresi eskiden düz eşitlikti ve **0 sonuç** döndürüyordu: DB'deki gerçek
> değerler `YANIT_BEKLENIYOR` / `KABUL_KUYRUGUNDA`. Artık "terminal olmayan her durum".

**Kur çevrimi.** Özet tutarlar `currencyRate` ile ₺ karşılığına çevriliyor
(`incoming-amount.ts`). Kuru olmayan döviz faturası toplama 1 kurundan katılmaz, sayısı
ekranda söylenir. Tek firmada 2,7 milyon ₺ eksik toplam düzeldi.

**Dışa aktarma.** `lib/export/datasets/gelen-e-faturalar.ts` + `DATASETS` kaydı +
`ExportButton`. Modül kapısı: `lib/module-access.ts` içinde
`/api/export/gelen-e-faturalar → SALES_PURCHASE` (repo'daki koruma testi kuralsız dataset'e
izin vermiyor). Satır tavanı 20.000; PDF'in kendi 5.000 tavanı route'ta.

> **Para birimi tuzağı:** satır tutarları faturanın KENDİ birimindedir. Belge tutarı kolonu
> `total: false`; toplanabilir olan yalnız kur uygulanmış **"Tutar (₺)"** kolonudur. Aksi
> halde Excel 318 USD'yi 318 ₺ ile toplar.

**Diğer:** boş aralık ipucu (aralık dışında kayıt varsa sayısı + en dar yeterli döneme
götüren düğme), tutar kutusu doğrulaması (harf girilemiyor, geçersizde uç 400 döner),
yarışan istek koruması, detay sayfasında gönderilme tarihi, listedeki "Bağlı" rozeti
ilişkili faturaya link, özet kartlar tıklanınca durum filtresi.

---

## Kalan işler

### 1 · Yanıt süresi (8 gün) göstergesi — en değerli

Ticari faturaya 8 gün içinde yanıt verilmezse fatura **zımnen kabul edilmiş** sayılır.
Kodda bu kurala dair hiçbir iz yok; bekleyen faturalar ekranda süresiz duruyor.

Yapılacak: satırda kalan süre rozeti ("3 gün kaldı" / "süresi doldu"), süresi dolmak
üzere olanların öne çıkması, muhtemelen bir de "yanıt bekleyenler" için varsayılan sıralama.
Süre `sentDate` üzerinden hesaplanabilir (kolon artık var). Yalnız TİCARİ faturada geçerli —
temel faturaya yanıt verilmez.

### 2 · Toplu kabul/red

36 bekleyen faturayı tek tek, her biri ayrı onay kutusuyla yanıtlamak gerekiyor.
Uygulamada toplu seçim deseni var: `personel/vardiya`, `restoran/menu`, `stok`.
Dikkat: kabul/red GİB'e gider, geri alınamaz — toplu işlemde onay ekranı tek tek işlemden
daha açık olmalı (kaç fatura, hangi tutar).

### 3 · Filtrelerin URL'ye yazılması

Yenilemede sıfırlanıyor, link paylaşılamıyor, tarayıcı geri tuşu çalışmıyor. CLAUDE.md
zaten şube bağlamı için URL'yi tek kaynak sayıyor; filtreler de oraya yazılabilir.
`?company=` parametresinin korunması şart.

### 4 · Kolon başlığından sıralama

Uygulamada henüz böyle bir desen yok; yeni desen açmak gerekir. Sıralama sunucuya gitmeli
(sayfalama var), yani `incoming-list-query.ts` içindeki `incomingOrderBy` parametrik olmalı.
