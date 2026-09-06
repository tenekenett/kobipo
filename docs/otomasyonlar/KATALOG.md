# Otomasyon kartları — katalog ve format

> Bu belge iki işi birden yapar:
> 1. Panoya düşecek **otomasyon kartlarının kataloğu** (ne, hangi veriden, hangi aksiyonla).
> 2. Bu kartların **kullanım verisini ilk günden toplayacak** kayıt formatı.
>
> İkinci madde birinciden ayrı düşünülemez: kart kodları bir kez dağıtıldıktan sonra
> DEĞİŞMEZ, çünkü ileride "bu kullanıcı hangi karta yanıt veriyor" sorusunu cevaplayacak
> olan şey bu kodlarla birikmiş geçmiştir. Kod şeması bu yüzden katalogla aynı belgede.

## 0. Durum — 2026-09-06

### Kodlanan kartlar

| Kod | Kart | Canlı veride |
|---|---|---|
| K-STK-09 | Negatif stok | 7 firmada ateşliyor |
| K-BLG-01 | İşlenmemiş gelen fatura | 8 firmada · ₺484K'ya varan KDV indirimi |
| K-BLG-04 | Taslak fatura | 8 firmada · ₺589K faturalanmamış |
| K-NKT-06 | Vadesi geçmiş çek/senet | 3 firmada · ₺480K'lık çek 89 gündür |
| K-STK-01 | Tükenme + tedarik süresi | sessiz — 61 üründen 43'ü negatif stoklu |
| K-MUS-04 | Aynı ürüne farklı fiyat | sessiz — bulguların tamamı hizmetti, elendi |

### Ölçüldü, YAZILMADI (sebepleriyle)

| Kod | Sebep |
|---|---|
| K-BLG-02 | Mükerrer tanımı çalışmıyor; kalem karşılaştırması gerekiyor (§4.8) |
| K-BLG-03 | Tüm veritabanında 4 irsaliye var |
| K-BLG-05 | `bank_statement_items` tablosu tamamen boş |
| K-OPR-04 | Hiç kasa sayımı kaydı yok |
| K-SIS-01 | 38 firmada kontör var ama kimse bitmeye yakın değil |
| K-TDR-01 | Tek üründe ateşliyor — alış verisi çok ince |

### Altyapı

- `automation_card_events` tablosu **uygulandı** (`db push`) ve **RLS açıldı**.
  `db push` migrasyon dosyasını ÇALIŞTIRMAZ; RLS ifadesi elle uygulandı. Yeni bir
  ortamda kurulurken `supabase/migrations/20260906000001_*.sql` koşulmalı.
- Pano bağlantısı: `app/(dashboard)/dashboard/page.tsx`, hero'nun altı.
- Nöbetçi test: `lib/otomasyon/kartlar.test.ts` — kod biçimi, kapı ve link
  doğruluğunu mekanik korur (mutasyonla doğrulandı).

### Sıradaki iş

1. **Panoyu gerçekten aç ve bak.** Veri katmanı altı kez ölçüldü; arayüz
   (SWR çağrısı, yazma kapısı, kart bileşeni) canlıda HİÇ çalışmadı.
2. Faz 2 — A motoru: çek/senet + maaş + tekrarlayan gider projeksiyona,
   günlük çözünürlük. K-NKT-01…05'i birden açar.
3. Faz 3 — B motoru: cari ödeme davranışı profili. K-THS grubunu açar.

### Çalışma yöntemi (bu iş boyunca izlendi)

**Kart yazmadan önce veriye sor.** Bu tur üç yanlış-pozitif sınıfı yayına
girmeden durduruldu: negatif stoklu ürünler (K-STK-01), hizmet kalemleri
(K-MUS-04), kombinatoryal mükerrer eşleşmesi (K-BLG-02). Bir kez haksız çıkan
kart, kartların tamamına olan güveni bitirir — anatominin 5. kuralı.

---

## 1. Amaç

İşletme sahibinin **fark etmediği** şeyleri, fark etmesi gereken anda, ne yapacağını da
söyleyerek önüne koymak. Ölçü şudur: kartı okuyan kişi ekranı terk etmeden karar
verebilmeli. "Stok 6 paket" bir bilgidir, karar değildir. "4 gün sonra bardaksız
kalacaksın, Ege Ambalaj 4 günde getiriyor, Murat Bey 0532…" karardır.

Kartların hemen tamamı **modelsizdir** — SQL, aritmetik ve eşik. Yapay zekâ bu katmanın
üstüne, bu katman biriktirdiği veriyle çalışacak biçimde sonra gelir (bkz. §6).

## 2. Kart anatomisi — altı kural

Her kart bu altısını taşır. Taşımayan kart katalogda yer almaz.

1. **Durum değil, sonuç.** ~~"Stok kritik seviyede"~~ → "4 gün sonra bardaksız kalacaksın."
2. **Son tarih.** Ne zamana kadar aksiyon alınmalı, alınmazsa ne olur.
3. **Karşı taraf, iletişimiyle.** Kimi arayacağı kartta yazsın (`Supplier.phone`,
   `contactPerson`; `Customer.phone`).
4. **Tek tıkla aksiyon.** Sipariş oluştur / ara / hatırlatma gönder / ilgili ekrana git.
5. **Gerekçe görünür.** "50/gün × 4 gün tedarik". Kart bir kez haksız çıkarsa güven biter;
   hesabı göstermek onu onarır.
6. **Susma kuralı.** Aksiyon alınınca kapanır; "yok say" denince N gün geri gelmez.

### Veri girişi kuralı

Kartlar kullanıcı formu doldurmadığı için ölmemeli. Üç basamak, bu sırayla:

1. **Türet.** Sayı, işletmenin zaten yaptığı işlemden çıkarılabiliyor mu? Tüketim hızı,
   tedarikçi tercihi, ödeme davranışı, alım ritmi, zam geçmişi — hepsi çıkarılabilir.
   Ayarlar ekranına konan alan, doldurulmayan alandır.
2. **Anın içinde ve doldurulmuş sor.** Türetilemiyorsa kartın kendisi sorsun:
   *"Ege Ambalaj bardağı kaç günde getiriyor? `[4]` gün — son 3 alışın arasına göre tahmin
   ettim."* Kullanıcı o an ihtiyaç duyduğu için cevaplar.
3. **Bilmiyorsan sus değil, söyle.** *"Tedarik süresini bilmiyorum; son 3 alışın arası
   ortalama 11 gün. Buna göre 3 gün içinde sipariş verin."* Zayıf öneri, öneri
   yokluğundan iyidir.

Reçete gibi gerçekten girilmesi gereken veride bile türetme çalışır: satış adedi ile
hammadde düşümü arasındaki oran birkaç haftada reçeteyi tahmin eder, kullanıcıya
onaylatılır — boş forma reçete girdirmekten çok daha yüksek tamamlanma verir.

## 3. Kart formatı

Katalogdaki her kart bu alanları doldurur. Alanlar aynı zamanda §5'teki kayıt modelinin
karşılığıdır.

| Alan | Açıklama |
|---|---|
| `kod` | `K-<ALAN>-<NN>` — **asla değişmez**, kayıtta birincil ayrımdır |
| `ad` | İnsan okur adı |
| `motor` | A nakit takvimi · B davranış profili · C akış hızı · D sapma ölçeri |
| `hazırlık` | ◆ bugün yapılabilir · ▲ küçük şema eki · ○ müşteri verisine bağlı |
| `tetik` | Hesaplanabilir koşul, tek cümle |
| `girdi` | Okunan tablo/alanlar |
| `özne` | Kartın hakkında olduğu kayıt (`product`/`customer`/`supplier`/`check`/…) |
| `kart` | Şablon metni, yuvalarıyla |
| `aksiyon` | Butonlar (`actionKey` değerleri) |
| `karşı taraf` | İletişim bilgisi eklenecek kayıt |
| `önem` | KRİTİK / YÜKSEK / ORTA / DÜŞÜK — sıralama ve gürültü bütçesi için |
| `susma` | Aksiyon ve "yok say" sonrası davranış |

### Kod şeması

| Önek | Alan |
|---|---|
| `K-STK` | Stok ve tükenme |
| `K-TDR` | Tedarikçi ve alış |
| `K-NKT` | Nakit takvimi |
| `K-THS` | Tahsilat |
| `K-MUS` | Müşteri ve satış |
| `K-MRJ` | Fiyat ve marj |
| `K-OPR` | Operasyon ve personel |
| `K-BLG` | Belge ve uyum |
| `K-SIS` | Sistem, abonelik, kontör |

Eşik veya metin değişirse kod korunur, `cardVersion` artar. Kodu yeniden kullanmak
geçmiş veriyi bozar; emekliye ayrılan kart kodu boşta bırakılır.

---

## 4. Katalog

### 4.1 Stok ve tükenme — `K-STK`

> **ÖLÇÜM — 2026-09-06, canlı veri.** K-STK-01 kodlandı ve gerçek veride koşuldu.
> Son 28 günde stok çıkışı olan 61 üründen:
>
> | | adet | sonuç |
> |---|---|---|
> | negatif stoklu | **43** | elendi — tedarik sorunu değil, KAYIT HATASI |
> | 28 günde < 3 hareket | 11 | elendi — tek satış eğilim değildir |
> | aday | 7 | en yakını 12 gün, eşik 4 → **kart çıkmadı** |
>
> Kod doğru çalışıyor; sıfır kart bu verinin doğru cevabı. Ama üç şey açığa çıktı:
>
> 1. **Alışlar sisteme girilmiyor.** 43 üründe stok eksi — açılış stoğu ya da alış
>    faturası yok, satış var. Bu düzelmeden K-STK-01 anlamlı çalışamaz.
> 2. **`Order.deliveryDate` yolu ölü.** Tüm veritabanında **1** alış siparişi var ve
>    onun da teslim tarihi boş. Tedarik süresi pratikte hep varsayılana düşer.
> 3. **Tedarikçi türetmesi ancak alış faturası olan üründe çalışır.** EREN FORKLİFT'te
>    15 kalem `productId`+`supplierId` dolu, ama hareket eden 44 ürün onlar değil.
>
> **Sonuç: K-STK-09 (negatif stok), K-STK-01'den ÖNCE gelmeli.** Stok kayıtları
> tutarlı hâle gelmeden tükenme kartının çıkacağı bir zemin yok. Faz sırası (§8)
> buna göre güncellendi.
>
> **K-STK-09 aynı gün kodlandı ve ölçüldü.** 7 firmada ateşliyor; teşhis satırı
> kök sebebi doğruluyor:
>
> | firma | eksi stoklu ürün | hiç alış faturası olmayan |
> |---|---|---|
> | EREN FORKLİFT | 35 | **35** |
> | Reypo Medya Ajansı | 11 | 9 |
> | ASDOĞUŞ PAZ. | 2 | 2 |
> | diğer 4 firma | 1–2 | hepsi |
>
> Yani sorun "alış eksik girilmiş" değil, **alış hiç girilmemiş**. Kart bunu
> ayırt edip söylüyor.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-STK-01 | Tükenme + tedarik süresi | `stok ÷ günlük hız` < `tedarik süresi + pay`; stok ≥ 0 ve pencerede ≥3 hareket | ◆ **kodlandı** |
| K-STK-02 | Sipariş ritmi kaçtı | Alışın gün örüntüsü kırıldı ve stok penceresi daralıyor | ◆ |
| K-STK-03 | Siparişleri birleştir | Aynı tedarikçide ≥2 ürün 7 gün içinde bitiyor | ◆ |
| K-STK-04 | Sipariş gecikti | `Order.deliveryDate` geçti, stok girişi yok | ◆ |
| K-STK-05 | Ölü stok, aksiyonlu | 90 gün hareketsiz + bağlı sermaye tutarı | ◆ |
| K-STK-06 | Yeni ürün hiç satılmadı | Eklendi + 30 gün, satış 0 | ◆ |
| K-STK-07 | Tatil öncesi hazırlık | `CompanyHoliday` + geçen yılki aynı dönem hızı | ◆ |
| K-STK-08 | Mevsimsel yükseliş | Geçen yıl aynı haftada hız ≥ %40 arttı | ◆ |
| K-STK-09 | Negatif stok | `stockQuantity < 0` — kayıt hatası | ◆ **kodlandı** |
| K-STK-10 | Sayım ile kayıt farkı | Fiziksel sayım ≠ sistem | ○ |

**K-STK-01 · Tükenme + tedarik süresi** *(referans kart — format örneği)*

```
motor        C
hazırlık     ◆
tetik        (stok ÷ son 28 günün günlük ortalama OUT hareketi) < (tedarik süresi + 1 gün)
girdi        StockMovement(type=OUT, createdAt, quantity) · Product.stockQuantity
             Order(date → deliveryDate) · InvoiceItem.productId → Invoice.supplierId
             Supplier(name, contactPerson, phone)
türetme      tamamı türetilir. Tedarik süresi yoksa: son 3 alış faturası arası ortalama
             fallback, kart içinde "kaç günde getiriyor?" sorusu doldurulmuş gelir
özne         product
kart         "Bugün {ürün} siparişi vermezsen {n} gün sonra {ürün}sız kalacaksın.
              Günde {hız} {birim} gidiyor, elde {stok} {birim} var, {tedarikçi}
              ortalama {tedarik} günde teslim ediyor. Önerilen miktar {miktar}
              ({kapsam} günlük ihtiyaç).
              {tedarikçi} — {yetkili} · {telefon}"
aksiyon      siparis_olustur · tedarikciyi_ara · miktari_duzenle
karşı taraf  Supplier
önem         stoksuz gün ≤ 1 → KRİTİK · ≤ 3 → YÜKSEK · değilse ORTA
susma        sipariş oluşturulunca kapanır · yok say → 3 gün · miktar düzenlenirse kapanır
```

**K-STK-03 · Siparişleri birleştir**

```
tetik        aynı tedarikçiden ≥2 ürün 7 gün içinde tükeniyor
kart         "{ürün1} {n1} gün, {ürün2} {n2} gün sonra bitiyor. İkisi de {tedarikçi} —
              tek siparişte birleştirirsen ikinci nakliyeyi ödemezsin."
aksiyon      birlesik_siparis_olustur · tedarikciyi_ara
önem         ORTA
```

### 4.2 Tedarikçi ve alış — `K-TDR`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-TDR-01 | Alış fiyatı zamlandı | Son alış birim fiyatı önceki ortalamanın %10+ üstünde | ◆ |
| K-TDR-02 | Başka tedarikçide daha ucuz | Aynı `productId`, başka `supplierId`, son 6 ay, düşük birim fiyat | ◆ |
| K-TDR-03 | Teslim süresi uzuyor | Son 3 teslim ortalaması, önceki 6 teslimin %50+ üstünde | ◆ |
| K-TDR-04 | Tek tedarikçiye bağımlılık | Bir ürünün son 12 ay alımının %100'ü tek tedarikçide, tutar yüksek | ◆ |
| K-TDR-05 | Tedarikçiye fazla ödeme | Tedarikçi bakiyesi lehinize döndü | ◆ |

**K-TDR-02 · Başka tedarikçide daha ucuz** — kimsenin elle yapmadığı karşılaştırma
olduğu için değeri yüksek.

```
girdi        InvoiceItem(productId, unitPrice, quantity) → Invoice(type=PURCHASE, supplierId, date)
kart         "{ürün} birim fiyatı son faturada %{artış} arttı ({eski} → {yeni}).
              Aynı ürünü {ay} ay önce {alt tedarikçi}'den {alt fiyat}'a almışsın.
              Aylık {adet} {birim} alıyorsun — fark aylık {tasarruf}.
              {alt tedarikçi} — {yetkili} · {telefon}"
aksiyon      alternatifi_ara · fiyat_gecmisini_gor
önem         aylık fark > eşik → YÜKSEK
```

### 4.3 Nakit takvimi — `K-NKT`

> Bu grubun tamamı **A motoruna** bağlı. A motoru bugün eksik: `nakit-projeksiyon.ts`
> yalnız açık faturaları okuyor; çek/senet, maaş ve tekrarlayan gider takvime girmiyor,
> çözünürlük hafta/ay. Önce A tamamlanmalı (bkz. §7 Faz 1).

> **K-NKT-06 kodlandı** — 3 firmada ateşliyor. EREN VİNÇ'te ₺480.000'lik çek 89,
> ₺402.926'lık çek 45 gündür vadesi geçtiği hâlde portföyde.
>
> **Kart TOPLAM TUTAR YAZMAZ, evrakları tek tek listeler.** Bir firmada
> ₺3.213.123.123.123 tutarlı bir çek var; toplansaydı kart "₺3,2 trilyon"
> diyecekti. Tek tek listelenince saçma rakam kendi satırında kalıyor,
> yanındaki ₺123.680 ve ₺1.233.321 okunabilir duruyor.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-NKT-01 | Ödeme günü önerisi | Planlanan çıkış, o günkü projeksiyonu eşiğin altına indiriyor | ▲ |
| K-NKT-02 | Nakit eşiğin altına iniyor | Projeksiyonda ilk eşik altı gün ≤ 30 gün | ▲ |
| K-NKT-03 | Maaş günü açığı | Maaş çıkışı > o günkü beklenen bakiye | ▲ |
| K-NKT-04 | Aynı güne yığılma | Tek günde ≥3 büyük çıkış üst üste | ▲ |
| K-NKT-05 | Atıl nakit | Bakiye − 30 günlük net çıkış > eşik | ▲ |
| K-NKT-06 | Vadesi geçmiş çek/senet portföyde | `dueDate < bugün` ve `status = PORTFÖYDE` | ◆ **kodlandı** |
| K-NKT-07 | Vade tatile denk geliyor | Vade `CompanyHoliday` veya hafta sonunda | ◆ |
| K-NKT-08 | Eksi bakiyeli hesap | `FinancialAccount.balance < 0` | ◆ *(sinyal var)* |

**K-NKT-01 · Ödeme günü önerisi** *(çek örneği)*

```
motor        A
tetik        kullanıcı bir çıkış planlıyor (çek/ödeme) ve o gün bakiye < eşik
girdi        projeksiyon (günlük) · Check/PromissoryNote(dueDate, direction, status)
             PayrollRecord(PENDING) · tekrarlayan gider · cari yaşlandırma + davranış profili
özne         check
kart         "{tarih}'e {tutar} çek kesme: o gün bakiye {bakiye} kalıyor, açık {açık}.
              {öneri tarihi}'ni öner — o tarihe kadar {cari}'den {tahsilat} ve
              {n} fatura tahsilatı bekleniyor, bakiye {yeni bakiye}."
aksiyon      onerilen_tarihi_uygula · odeme_takvimini_gor · senaryo_calistir
önem         KRİTİK
susma        tarih değiştirilirse kapanır · yok say → o çek için kalıcı
```

### 4.4 Tahsilat — `K-THS`

> B motoru (cari ödeme davranışı profili) bu grubun tamamının önkoşulu:
> cari başına `AVG(ödeme tarihi − vade)`, hatırlatmaya yanıt süresi, süreklilik.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-THS-01 | Bugünkü arama listesi | Açık alacaklar `tutar × tahsil olasılığı` ile sıralı ilk 3 | ▲ |
| K-THS-02 | Vadesi gelmeden hatırlat | Vadeye ≤3 gün + carinin ortalama gecikmesi > 7 gün | ▲ |
| K-THS-03 | Ödeme davranışı bozuldu | Son 3 faturanın gecikmesi, önceki 12 ayın belirgin üstünde | ▲ |
| K-THS-04 | Hiç hatırlatılmamış alacak | Vade geçti + hiç hatırlatma kaydı yok | ◆ |
| K-THS-05 | Açık bakiye limiti aştı | Cari açık bakiye, geçen yıl aynı dönemin belirgin üstünde | ◆ |
| K-THS-06 | Ödeme linki ödenmedi | `PaymentLink.status = ACTIVE` + oluşturma üstünden N gün | ◆ |

**K-THS-02 · Vadesi gelmeden hatırlat** — tahsilat takibini reaktiften proaktife çeviren
tek kart.

```
kart         "{cari}'nin {tutar} faturası {n} gün sonra vadesinde. Son {m} faturayı
              ortalama {gecikme} gün geç ödedi — şimdi hatırlatırsan vadesinde ödeme
              olasılığı yüksek. {cari} — {yetkili} · {telefon}"
aksiyon      hatirlatma_gonder · odeme_linki_olustur · cari_ekstresi
önem         tutar × gecikme eğilimi
```

### 4.5 Müşteri ve satış — `K-MUS`

> **ÖLÇÜM — K-MUS-04 kodlandı ama bu veride SESSİZ, ve sessiz olması doğru.**
>
> İlk sürüm üç firmada ateşliyordu ve bulguların **tamamı yanlıştı**:
> *"VİNÇ ÇALIŞMA BEDELİ: ALİ ÖNAL ₺2.000 ↔ YİĞİTALP ₺45.000, %2150 fark."*
> Kalemlerin hepsi `isService = true` çıktı — hizmette `unitPrice` işin TOPLAM
> bedelidir, iki saatlik vinç işiyle bir haftalık iş arasında yirmi kat fark
> normaldir. `isService = false` süzgeci eklenince 10 firmanın hiçbirinde kart
> kalmadı.
>
> Kart doğru; veri fiziksel ürün satan bir müşteride ateşleyecek. Süzgeçsiz
> yayına almak, vinç kiralayan bir firmaya "%2150 fiyat farkı" göstermek olurdu.
>
> Net fiyat tanımı `lib/stock/sale-price.ts`teki `LINE_NET`ten gelir — o dosya
> için dışa açıldı. İkinci bir kopya, aynı ürünün kartta ve ürün ekranında farklı
> fiyatla görünmesi demek olurdu.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-MUS-01 | Susan müşteri + sebep | Son alım > 2× kendi ritmi | ◆ *(sinyal var)* |
| K-MUS-02 | Çapraz satış, isim isim | A alan müşterilerin çoğu B de alıyor, bu üçü almıyor | ◆ |
| K-MUS-03 | Yanıtsız teklif | `Quote.status = SENT` + `validUntil` yaklaşıyor | ◆ |
| K-MUS-04 | Aynı ürüne farklı fiyat | Aynı `productId`, ÜRÜN (hizmet değil), müşteri başına EN SON net fiyat, %25+ fark | ◆ **kodlandı** |
| K-MUS-05 | En kârlı müşteride ritim bozulması | Ciro ilk %10 + ritim kırılması | ◆ |
| K-MUS-06 | İkinci sipariş gelmedi | İlk siparişten sonra ritim oluşmadan sessizlik | ◆ |

**K-MUS-04 · Aynı ürüne farklı müşteriye farklı fiyat**

```
kart         "{ürün}'ü {müşteri A}'ya {fiyat A}, {müşteri B}'ye {fiyat B} satıyorsun
              (%{fark} fark). {müşteri B} son 12 ayda {ciro} ciro yaptı."
aksiyon      fiyat_listesini_gor · musteriyi_ara
önem         ORTA
```

### 4.6 Fiyat ve marj — `K-MRJ`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-MRJ-01 | Marj hedefin altına indi | Güncel marj < hedef marj | ▲ *(hedef alanı yok)* |
| K-MRJ-02 | Zararına satış | Satış fiyatı < güncel maliyet | ◆ *(sinyal var)* |
| K-MRJ-03 | Fiyat aylardır sabit, maliyet arttı | Fiyat N aydır sabit + maliyet %X arttı | ◆ |
| K-MRJ-04 | Çok satan, düşük marjlı | Adette ilk %20, marjda son %20 | ◆ |
| K-MRJ-05 | İskonto marjı yiyor | İskonto sonrası efektif marj hedefin altında | ◆ |

### 4.7 Operasyon ve personel — `K-OPR`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-OPR-01 | Fire / reçete sapması | Beklenen tüketim ile gerçek arasında %X üstü fark | ○ *(reçeteye bağlı)* |
| K-OPR-02 | İskonto yoğunlaşması | İskonto tutarı normalin N katı + kişi/saat kümelenmesi | ◆ |
| K-OPR-03 | Çalışma saati dışı işlem | Mesai dışı satış/iptal/iskonto | ◆ |
| K-OPR-04 | Kasa sayım farkı | `CashCount.difference` eşiğin üstünde, tekrarlıyor | ◆ |
| K-OPR-05 | Gün sonu kasa kapatılmadı | Gün bitti, sayım kaydı yok | ◆ |
| K-OPR-06 | Açık kalan adisyon | `RestaurantTicket` gün devrederek açık | ◆ |
| K-OPR-07 | Fazla mesai birikiyor | Dönem mesai toplamı geçen dönemin belirgin üstünde | ◆ |
| K-OPR-08 | Yoğun güne izin çakışması | Talep yüksek gün + onaylı izin | ○ |
| K-OPR-09 | Talep–personel uyumsuzluğu | Beklenen işlem, vardiya kapasitesinin üstünde | ○ |

### 4.8 Belge ve uyum — `K-BLG`

> **ÖLÇÜM — 2026-09-06.** K-BLG-01 kodlandı; **8 firmada** ateşliyor ve şu ana kadarki
> en yüksek parasal karşılığa sahip kart:
>
> | firma | aktarılmamış fatura | KDV indirimi | gider |
> |---|---|---|---|
> | HİDROEREN | 145 | **₺484.442** | ₺3.271.120 |
> | EREN FORKLİFT PNÖMATİK | 117 | ₺453.796 | ₺2.905.927 |
> | Reypo Medya Ajansı | 517 | ₺372.974 | ₺3.816.857 |
> | EREN FORKLİFT | 113 | ₺231.573 | ₺1.856.620 |
> | diğer 4 firma | 4–41 | ₺11K–214K | — |
>
> Üç süzgeç de ölçümden doğdu ve gerekçeleri `lib/otomasyon/veri/islenmemis-fatura.ts`
> başlığında:
>
> 1. **`status = 'KABUL'`** — veride 48 RED, 66 YANIT_BEKLENIYOR var; reddedilmiş
>    faturayı "aktarmadın" diye hatırlatmak yanlış.
> 2. **Tutar yalnız TRY'den** — 62 USD + 1 EUR + 1 CAD fatura var. Döviz faturalar
>    SAYILIR ama toplama girmez ve kart bunu söyler.
> 3. **7–90 gün penceresi** — bugün gelen fatura geç değildir; 1789 gün önceki kuyruk
>    da aksiyon değildir. Penceresiz ilk sürüm "₺78 milyar gider kayıtlarda yok"
>    diyordu (altı adet ₺24,5 milyarlık çöp kayıt yüzünden).

> **K-BLG-04 de kodlandı** — 8 firmada ateşliyor. Reypo Medya Ajansı: **167 satış
> faturası taslakta**, ₺589.436 hiç faturalanmamış, en eskisi 128 gün. K-BLG-01'in
> aynası: o gideni kaçırır, bu GELİRİ.
>
> **K-BLG-05 (banka) yazılmadı:** veritabanında tek bir `bank_statement_items`
> satırı yok. Ateşlemeyecek kart yazmak yerine, ekstre girişi kullanılmaya
> başlayınca eklenecek.

> **K-BLG-02 YAZILMADI — tanım çalışmıyor.** Üç ayrı mükerrer tanımı ölçüldü:
>
> | tanım | sonuç |
> |---|---|
> | aynı gönderen + aynı tutar + ±3 gün | Reypo'da **6.376 çift** — kombinatoryal patlama |
> | aynı gönderen + aynı tutar + aynı gün | 84 grup, ama örnekler FARKLI fatura numaraları |
> | aynı gönderen + **aynı fatura no** | **sıfır** — gerçek mükerrer belge yok |
>
> Aynı tutarlı çok sayıda fatura ikişerli eşleşince sayı patlıyor; aynı gün + aynı
> tutar da yetmiyor, çünkü örneklerin hepsi ayrı belge numarası taşıyor (yani ayrı
> faturalar). Güvenilir tek ölçüt olan "aynı fatura no" hiç eşleşme vermiyor —
> `@@unique([companyId, uuid])` zaten yeniden çekimi eliyor.
>
> **Doğru sürüm KALEM İÇERİĞİNİ karşılaştırmalı** (sunumun kendi örneği de bunu
> diyor: *"Kalem içerikleri birebir aynı"*). Kalemler `IncomingInvoice.raw` içinde;
> ayrıştırma gerektirir, yani bu bir "ucuz kazanç" değil. Faz 4'ten çıkarıldı.
>
> Yanlış sürümü yayına almak, kart anatomisinin 5. kuralını ihlal ederdi: bir kez
> haksız çıkan kart, kartların tamamına olan güveni bitirir. 84 ayrı faturayı
> "mükerrer" diye göstermek tam olarak budur.

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-BLG-01 | İşlenmemiş gelen fatura | `isLinkedToPurchase=false` + `status=KABUL` + yaş 7–90 gün | ◆ **kodlandı** |
| K-BLG-02 | Aynı içerikli ikinci fatura | **kalem karşılaştırması gerekiyor** — aşağıya bak | ○ *(ertelendi)* |
| K-BLG-03 | Faturalanmamış irsaliye | `Waybill.invoiceId = null` + tarih yaşı | ◆ *(ertelendi: tüm veritabanında 4 irsaliye)* |
| K-BLG-04 | Bekleyen taslak fatura | SATIŞ + `status IN (DRAFT, GIB_DRAFT)` + ≥3 gün | ◆ **kodlandı** |
| K-BLG-05 | Eşleşmemiş banka hareketi | `BankStatementItem.isMatched = false` | ◆ *(veri yok: hiç ekstre kalemi girilmemiş)* |
| K-BLG-06 | Vergi bilgisi eksik cari | VKN/TCKN yok — e-fatura kesilemez | ◆ |
| K-BLG-07 | Beyan dönemi yaklaşıyor | KDV dönemi + tahmini tutar | ◆ |

**K-BLG-01 · İşlenmemiş gelen fatura** — doğrudan para kaybı, en ucuz kartlardan biri.

```
kart         "{n} gün önce gelen {adet} fatura hâlâ aktarılmadı: {tutar} gider ve
              {kdv} KDV indirimi kayıtlarda yok."
aksiyon      gelen_kutusunu_ac · toplu_aktar
önem         YÜKSEK
```

### 4.9 Sistem, abonelik, kontör — `K-SIS`

| Kod | Ad | Tetik | Hazırlık |
|---|---|---|---|
| K-SIS-01 | Kontör bitiyor | `UsageLimit` tüketim hızı × kalan → N gün | ◆ |
| K-SIS-02 | Abonelik bitiyor | `Subscription` bitişine N gün | ◆ *(var)* |
| K-SIS-03 | e-Dönüşüm bağlantısı koptu | Entegratör yetkilendirmesi geçersiz | ◆ |
| K-SIS-04 | Kilitli modül tanıtımı | Kapalı ücretli modül + kullanım sinyali | ◆ *(banner var)* |

**K-SIS-01 · Kontör bitiyor** — hem müşteri için kritik (fatura kesilemez) hem Kobipo
için gelir kartı.

```
kart         "Kontörün {kalan} belge. Ayda ortalama {hız} belge kesiyorsun —
              yaklaşık {gün} gün sonra biter ve fatura kesemezsin."
aksiyon      kontor_satin_al · kullanim_gecmisi
önem         gün ≤ 5 → KRİTİK
```

---

## 5. Etkileşim günlüğü

Kartlar yayına girdiği andan itibaren her gösterim bir **etiketli veri noktasıdır**.
Bu kayıt tutulmazsa yapay zekâ fazı sıfırdan başlar ve geriye dönük telafisi olmaz.

### Model

```prisma
/// Otomasyon kartlarının gösterim ve karar günlüğü.
///
/// AMACI SADECE ÖLÇÜM DEĞİL: ileride "bu kullanıcı hangi karta yanıt veriyor,
/// hangi eşikte umursuyor" sorusunun eğitim verisi buradan çıkacak. Bu yüzden
/// `cardKey` ASLA değişmez ve `payload` karta basılan rakamları saklar — sonradan
/// "kart haklı çıktı mı" denetimi ancak o rakamlarla yapılabilir.
model AutomationCardEvent {
  id          String    @id @default(cuid())
  companyId   String
  userId      String?   // kartı gören kişi; rol bazlı fark için
  cardKey     String    // K-STK-01 — kod şeması docs/otomasyonlar/KATALOG.md
  cardVersion Int       @default(1) // eşik/metin değişince artar, kod korunur
  severity    String    // KRITIK | YUKSEK | ORTA | DUSUK

  // Kartın HAKKINDA olduğu kayıt — kişiselleştirme bu eksende yapılacak.
  subjectType String?   // product | customer | supplier | check | invoice | ...
  subjectId   String?

  // Karta basılan rakamlar. Eşik değişse bile geçmiş kart yeniden üretilebilsin
  // ve "önerdiği şey doğru muydu" sonradan ölçülebilsin diye saklanır.
  payload     Json

  shownAt     DateTime  @default(now())

  // ACTED | DISMISSED | SNOOZED | EXPIRED · null = henüz karar verilmedi
  decision    String?
  decidedAt   DateTime?
  actionKey   String?   // hangi butona basıldı: siparis_olustur, tedarikciyi_ara ...

  // SONUÇ ÖLÇÜMÜ — asıl değerli alan. Kart "sipariş ver" dedi, sipariş verildi mi?
  // Bu olmadan yalnız ilgi ölçülür, İSABET ölçülemez.
  outcomeAt   DateTime?
  outcomeType String?   // order | payment | price_change | none
  outcomeRef  String?   // ilgili kaydın id'si

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, cardKey, shownAt])
  @@index([companyId, decision])
  @@index([cardKey, shownAt])
  @@index([subjectType, subjectId])
  @@map("automation_card_events")
}
```

Migrasyonun sonuna, proje kuralı gereği:

```sql
ALTER TABLE public.automation_card_events ENABLE ROW LEVEL SECURITY;
```

### Kayıt kuralları

- **Gösterim de yazılır, karar da.** Yalnız tıklananı kaydetmek, "hangi kart görülüp
  umursanmadı" sorusunu ölçülemez kılar — asıl sinyal odur.
- **Aynı kart aynı özne için günde bir kez** yazılır. Sayfa her açılışta yeni satır
  atarsa gösterim sayısı ilgiyle karışır.
- **`payload` kartın gövdesidir, özeti değil.** Hangi rakamla ne dendiği durmalı.
- **`outcomeAt` ayrı bir işle doldurulur** (kart aksiyonundan doğan sipariş/tahsilat
  kaydı bağlanır). Bu alan, ileride "hangi öneri gerçekten sonuç verdi" sorusunun tek
  cevabıdır ve sonradan üretilemez.
- **`cardVersion`** eşik değişiminde artırılır; eski ve yeni eşiğin verisi karışmaz.

### Bir yıl sonra bu veri neyi cevaplar

- Bu kullanıcı hangi kart türüne yanıt veriyor, hangilerini hep kapatıyor?
- Hangi eşikte umursuyor — ₺5.000 açıkta hareket etmiyor, ₺20.000'de ediyor mu?
- Hangi kart hangi işletme tipinde tıklanıyor (sektöre göre kart seçimi)?
- Hangi öneriler sonuç verdi — yani kart **haklı** mıydı?
- Bir kullanıcıya günde kaç kart gösterilirse yanıt oranı düşmeye başlıyor?

Bunlar "kullanıcı davranışını analiz edip kişiselleştirme"nin girdisidir. Kart
kataloğunun bugün stabil kodlarla yazılmasının sebebi budur.

## 6. Yapay zekâ nereye girer

Bu katalogun tamamı modelsizdir. Model, bu katman kurulduktan sonra üç yerde işe yarar:

1. **Sıralama ve kişiselleştirme** — §5'teki günlük yeterince biriktiğinde: "bu firmaya
   bugün hangi 3 kartı göster". Kural değil, öğrenilmiş tercih.
2. **Serbest metin** — gelen fatura kaleminin ilk kez eşleştirilmesi, fiş okuma.
3. **Asistan** — soruyu sorguya çevirme (`lib/asistan/sohbet.ts`, zaten var). Her yeni
   kart, asistana bir araç olarak da eklenir.

Kural değişmez: **rakam modelden geçmez** (`lib/asistan/sinyaller.ts`). Model kartı
sıralayabilir, seslendirebilir; içindeki sayıyı üretemez.

## 7. Gürültü bütçesi

Kartların amacı işletmeyi fark etmediği şeylerle doldurmak; ama günde 20 kart gösteren
ekran birkaç haftada okunmaz olur ve o noktada §5'teki veri de değersizleşir (herkesin
her kartı kapattığı bir günlük hiçbir şey öğretmez).

Çözüm kart sayısını azaltmak değil, **gösterim bütçesi** koymak:

- Panoda **en fazla 3 kart** — `önem × parasal etki` ile sıralanır. Gerisi "Tümü"nde.
- Aynı kart peş peşe 3 kez yok sayılırsa **30 gün susar**.
- Bir kart tüm firmalarda %90+ yok sayılıyorsa **kart yanlıştır** — düzeltilir veya
  emekliye ayrılır. Bu ölçüm §5 olmadan yapılamaz.

## 8. Sıra

| Faz | İş | Açtığı kartlar |
|---|---|---|
| 0 | **Etkileşim günlüğü** (§5) + kart bileşeni + gürültü bütçesi | altyapı |
| 1 | **K-STK-01** referans kart *(kodlandı)* | iskeleti ve formatı kurdu |
| 1b | **K-STK-09** negatif stok *(kodlandı)* — K-STK-01'in önkoşulu | 7 firmada ateşliyor |
| 2 | **A motoru**: çek/senet + maaş + tekrarlayan gider + günlük çözünürlük | K-NKT-01…05 |
| 3 | **B motoru**: cari ödeme davranışı profili | K-THS-01…03, K-NKT-01'in gerçekçiliği |
| 4 | Ucuz kazançlar: **K-BLG-01 *(kodlandı)***, K-BLG-02…05, K-SIS-01, K-TDR-01/02, K-MUS-03 | tek sorgu + şablon |
| 5 | **C motoru** genişleme: K-STK-02…08, K-TDR-03 | akış hızı |
| 6 | **D motoru** ortak sapma ölçeri: K-MRJ, K-OPR-02…04 | sapma |
| 7 | Reçeteye bağlı: K-OPR-01 (önce reçete doluluğunu ölç) | fire |
| 8 | Talep tahmini: K-OPR-08/09 | gerçek tahmin modeli, en son |

**Faz 0 atlanmamalı.** Kartlar günlük olmadan yayına girerse, geçen her ay geri
kazanılamayan veridir.
