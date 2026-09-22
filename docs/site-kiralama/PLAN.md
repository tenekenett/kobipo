# Site & Kiralama modülleri: plan

> 2026-09-22 planlama konuşmasının kaydı. Kod henüz yazılmadı.
> Tahmin olan her rakam "tahmin" diye işaretli. Kalanlar kullanıcının söyledikleri ya da koddan ölçülenler.

## 1. Neden

Mevcut ve yakın müşterilerimizin bir kısmı Apsiyon kullanıyor ama tam kullanamıyor:

- **Arayüz karışık.** Özelliklerin çoğu kullanılmıyor, belgelerin çoğu hâlâ Excel'de.
- **Muhasebe elle.** Raporlar elle hazırlanıyor.
- **Apsiyon'un ön muhasebe modülü pahalı.** Kullanıcılar geçmek istemiyor.

**Kobipo'nun vaadi:** iki modülle site/kiralama yönetimi ve ön muhasebe tek yerde, yalnız ihtiyacın olan menüyle. "Kullanıcıya gereksiz şeyi göstermemek" öne çıkaracağımız özelliklerden biri. Apsiyon'u bütünüyle kopyalamıyoruz.

## 2. Sahadan

**22 Eylül: bir apart yöneticisiyle görüşme.** Odalar ve kullanıcı ekranları birlikte incelendi. Apsiyon'da beğendikleri:
- toplu borçlandırma,
- listelerdeki filtreler,
- kişi verisiyle kendiliğinden dolan ihtar taslağını kişiye ve avukata göndermek,
- banka hesabıyla entegre çalışma.

**Görüştüğümüz müşterilerin ortak istekleri:**
- Ödemeler ortak banka hesabına düşüyor ve Apsiyon'da oradan işleniyor. **Banka bağlantısı ilk günden şart.**
- Hesaba para düşünce ödeyen kişiye fatura hazırlansın, onlar yalnız onaylasın. Bunu isteyen müşteri var.
- Sade arayüz.
- Kiracılar ve sakinler için mobil uygulama.

## 3. Kimin için

| Segment | Durum | Not |
|---|---|---|
| Apart firmaları | **Şimdi** | Normal ev kiralaması gibi: malik–kiracı kira sözleşmesi. Tek fark, internet gibi bazı giderlerin ortak olması. Kiracının kimlik bilgileri tutuluyor. |
| Site yönetim firması | **Şimdi** | Şehirdeki sitelerin aidatı, güvenliği ve personeli. Her site ayrı bir tüzel kişi, kendi vergi numarası var. |
| Oteller | Sonra | Ayrı bir iş (bkz. §11). |
| Yurt kurumu | **Kapsam dışı** | Genel merkez → il → ilçe → yurt hiyerarşisi. Kullanıcıyla birlikte ayrı bir ürün gerektirdiğine karar verildi. Kobipo'nun hesap yapısı (hesap kökü → firma → şube) bu hiyerarşiyi taşımıyor. |

## 4. Üç ayrı iş

| | Site yönetimi | Apart / kiralama | Otel |
|---|---|---|---|
| Para kimin? | Sitenin (firma yalnız yönetir) | Firmanın (*malik kim, açık soru, §13*) | Firmanın |
| Birim | Daire, dükkân | Daire | Oda, gecelik |
| Kişi | Malik, kiracı | Malik, kiracı | Misafir |
| Borcun kaynağı | Aidat (bütçe, arsa payı, m²) | Kira sözleşmesi, depozito | Rezervasyon |
| Gecikme | Kanunla aylık %5 (KMK md. 20) | Sözleşme cezası | — |
| Belge | Makbuz; fatura kesilmez | e-Arşiv fatura | e-Arşiv, konaklama vergisi |
| Kendine özgü | İşletme projesi, genel kurul/hazirun, sayaç paylaşımı, noter onaylı işletme defteri, icra | Doluluk, depozito iadesi, ortak internet | Kanal yönetimi, KBS bildirimi, kat hizmetleri |

## 5. Yapı: bir ortak çekirdek + iki modül

```
┌───────────────────────────┬───────────────────────────┬ ─ ─ ─ ─ ┐
│ Site & Apartman Yönetimi  │ Kiralama (Apart)          │  Otel
│ (Modül 1)                 │ (Modül 2)                 │  (sonra)
├───────────────────────────┴───────────────────────────┴ ─ ─ ─ ─ ┤
│ Ortak çekirdek: birim · kişi · toplu borçlandırma · tahsilat ve  │
│ banka eşleştirme · ihtar ve toplu gönderim · kişiye özel sayfa   │
├──────────────────────────────────────────────────────────────────┤
│ Kobipo bugün: cari · kasa/banka · fatura ve e-arşiv · çek-senet · │
│ personel/bordro · belge tarama · raporlar · otomasyon kartları   │
└──────────────────────────────────────────────────────────────────┘
```

**Neden iki modül, tek değil:** alıcılar, dil (aidat/malik ile kira sözleşmesi), fiyat birimi ve yasal kurallar farklı. Site yöneticisi depozito görmez, apart yöneticisi genel kurul görmez. Tahmin: kodun %60–70'i ortak.

Kobipo'da emsali var:
- `lib/modules.ts` içinde `requires` bağımlılığı: Restoran modülü Stok'a bağlı.
- Menüyü değiştiren çalışma düzeni seçimi: `Company.workScheduleMode` → `lib/nav/pages.ts`.
- Kurulumda sektör seçtirip alakasız menüleri (Stok, Restoran, e-İrsaliye…) baştan kapatmak mümkün.

**Kod notu:** `lib/modules.ts` bir **RED listesi**. Yeni modül anahtarı eklendiğinde mevcut firmalarda o anahtar kayıtlı olmadığı için modül herkese **açık düşer**. Yeni modül eklerken mevcut satırları kapatan bir migrasyon yazılmalı; kural dosyanın başında yazıyor.

## 6. Ortak çekirdek

| Parça | Ne yapar |
|---|---|
| Birimler | Bina → blok → daire/dükkân |
| Kişi ve birim bağı | Giriş ve çıkış tarihli. Çıkışta bakiye başkasına aktarılır ya da tahsil edilir. Geçmiş silinmez. |
| Toplu borçlandırma | Eşit, birime göre ya da Excel'den. Her ay kendiliğinden çalışır. Yanlışsa işlem geçmişinden geri alınır. |
| Banka eşleştirme | Kişiye özel ödeme kodu havale açıklamasında geçerse ödeme kendiliğinden eşleşir. |
| İhtar ve toplu gönderim | Borç aralığı, gecikenler, blok gibi filtrelerle kişiler seçilir. Şablon kişi verisiyle dolar, kişiye ve avukata gider. |
| Kişiye özel sayfa | Borç, ekstre, IBAN ve ödeme tek sayfada, uygulama gerektirmeden bağlantıyla açılır. |

## 7. İki modül

**Modül 1: Site & Apartman Yönetimi.** Para sitenin, firma yalnız yönetir.
- Malik ve kiracı.
- Aidat ve işletme projesi (bütçe).
- %5 gecikme tazminatı (KMK).
- Genel kurul ve hazirun listesi.
- Sayaç paylaşımı.
- İşletme defteri, denetim raporu.
- İcra takibi.
- **Çoklu site tek ekranda.** Her site ayrı firma (ek firma) olarak açılır, yönetim firması hepsini tek panelden görür. Apsiyon'daki karşılığı "Kurumsal Ekran".

**Modül 2: Kiralama (Apart).** Normal ev kiralaması gibi; yalnız internet gibi bazı giderler ortak.
- Daire listesi ve doluluk panosu.
- Malik–kiracı kira sözleşmesi.
- Kiracı kimlik bilgileri. KVKK kapsamında; saklama ve gösterim kurallı olmalı.
- Kira taksitleri ve depozito. **Depozito faturalanmaz.**
- Ortak giderler (internet vb.) ve paylaştırma.
- Sözleşme yenileme.
- e-Arşiv kira faturası. Kimlik bilgileri tutulduğu için e-arşivde gereken TCKN de elde.
- Ödeme gelince taslak fatura.

## 8. Kobipo'dan hazır gelenler (koddan ölçüldü)

Apsiyon'un ayrı ve pahalı sattığı muhasebe ve personel tarafı Kobipo'da zaten var: cari, kasa/banka, gider faturası/fiş, çek-senet, personel/vardiya/puantaj/bordro, fotoğraftan belge okuma, e-fatura/e-arşiv, raporlar, otomasyon kartları.

Doğrudan işe yarayacak mevcut parçalar:

| Parça | Nerede | Durum |
|---|---|---|
| Banka ekstresi iskeleti | `prisma/schema.prisma` → `BankStatement`, `BankStatementItem`; ekran `app/(dashboard)/banka/mutabakat` | Var ama kullanılmıyor (otomasyon kataloğuna göre 7 Eylül'de tablo boştu) |
| Belge şablon editörü (ihtar için temel) | `components/personel/belge-sablon-editoru.tsx`, `lib/personel/belge-alanlari` | "Otomatik alan / elle doldurulan alan" ayrımı var |
| e-Arşiv gönderimi, taslak önizleme, dip toplam | `lib/integrations/e-invoice/`, `lib/invoice/document-totals.ts` | Hazır |
| E-posta | `lib/email/resend.ts` | Hazır |
| SMS / WhatsApp | — | **Yok**, sağlayıcı seçilmeli |
| Ödeme linki | `lib/faturalar/payment-links.ts`, `PAYMENT_LINKS_ENABLED` | Bilerek kapalı (sahte "ödendi" açığı); sanal POS kararına bağlı |
| Kota ve kontör satışı (yapay zekâ kredisi için) | `UsageLimit` modeli, kontör paketleri | Hazır |

## 9. Kritik akış: para düşer → fatura hazırlanır → onaylanır

1. **Para düşer:** banka bağlantısı.
2. **Kim ödedi:** ödeme koduyla kesin eşleşme (kural); isim benzerliği (Türkçe katlama `trFold`); belirsiz kalanlar öneri olarak düşer.
3. **Neye sayılsın:** kira taksiti ya da aidat.
4. **Taslak fatura;** sitede makbuz.
5. **Onay:** tek dokunuşla, toplu.

Apsiyon'da bu yok; **en güçlü farkımız.** Yan kazanç: her fatura kontör harcar.

Baştan çözülmesi gerekenler:
- **Depozito:** gelir değil, iade edilecek para; faturalanmaz.
- **Ödeyen farklı olabilir:** kirayı arkadaş ya da aile yatırır, fatura kiracıya kesilir. "Ödeyen → fatura muhatabı" eşleşmesi bir kez kaydedilir, sonraki aylarda kendiliğinden kullanılır.
- **Kısmi ödeme ya da tek havaleyle iki daire:** tutar bölünür.
- **Site aidatı:** fatura kesilmez, aynı akış makbuz üretir.

## 10. İlk sürüm

| Özellik | Öncelik | Not |
|---|---|---|
| Banka bağlantısı ve otomatik eşleştirme | Must | İlk günden. Sağlayıcı hazır olana kadar ekstre yüklemeyle çalışır. |
| Apsiyon'dan geçiş (Excel ile içe aktarma) | Must | Geçişin önündeki en büyük engel veri taşımak. Apsiyon Excel çıktısı veriyor. |
| Birim, kişi, toplu ve aylık borçlandırma | Must | Yöneticinin en sevdiği özellik |
| Ödemeye taslak fatura, toplu onay | Must | Apsiyon'da yok |
| İhtar şablonu: kişiye ve avukata | Must | Belge şablon editörü temel alınır |
| Filtreli toplu e-posta | Must | SMS/WhatsApp sağlayıcısı seçilecek |
| Çoklu site tek ekranda | Must | Site firması için şart |
| Kişiye özel borç ve ödeme sayfası | Should | Online ödeme sanal POS kararına bağlı |
| Ortak gideri paylaştırma (sakine ya da daireye) | Should | İnternet, elektrik, su |
| Mobil uygulama (yapay zekâ ağırlıklı) | Sonra | Çekirdek oturunca; veri tarafı baştan mobile uygun tasarlanır |
| Rezervasyon, geçiş kontrolü, tur kontrol | Sonra | Şu an talep yok |

## 11. Banka bağlantısı

**Asıl uzun iş kod değil, sözleşme.** Seçim, sözleşme ve test hesabı haftalar sürer; **bugün başlamalı.**

| Yol | Nasıl | Artısı | Eksisi |
|---|---|---|---|
| Doğrudan banka | Her bankayla ayrı kurumsal anlaşma (API ya da ekstre dosyası) | Aracı ücreti yok | Banka sayısı kadar iş; her bankada sabit IP bildirimi; müşteri de bankasına form imzalar (Apsiyon'da da öyle) |
| Toplayıcı firma | Tek bağlantıyla çoğu banka | En hızlı yol | Aylık ya da hesap başına ücret |
| Açık bankacılık | TCMB lisanslı "hesap bilgisi hizmeti" aracısı; müşteri onay verir | Resmî, düzenlenmiş yol | Lisanslı bir aracıyla anlaşma gerekir |

- Sağlayıcı seçimi kullanıcının kararı. Somut isim ve fiyat araştırması henüz yapılmadı.
- **Kod beklemez:** eşleştirme motoru önce ekstre yüklemeyle kurulur, sağlayıcı seçilince ona bağlanır.
- Bankalar yalnız bildirilen **sabit IP**'den gelen çağrıyı kabul ediyor. Vercel'in sabit çıkış IP'si yok. Çözüm küçük bir sabit IP'li proxy; sanal POS ile ortak kullanılır. Bkz. `docs/odeme/SANAL-POS-ARASTIRMA.md` ve `../altyapi/KARARLAR-2026-09.md`.

**Otel için iki yol (şimdi yapılmıyor):**
1. Küçük apart otel ve pansiyonlar için Kiralama modülüne "gecelik" kipi.
2. Büyük oteller için otel yazılımı (PMS) yazmak yerine mevcut yazılımlarına bağlanıp arkada ön muhasebe olmak.

Otel yazılımı başlı başına ayrı bir ürün: Booking gibi kanallarla bağlantı, zorunlu KBS kimlik bildirimi, konaklama vergisi, kat hizmetleri, gün sonu kapanışı.

## 12. Mimari kararlar ve riskler

- **Abonelik firma bazında** (CLAUDE.md). Site firmasında her site ayrı firma, yani firma başına abonelik çok siteli firmaya pahalı kalır. Öneri: bu modüllerde fiyatı birim (daire) adedine bağlamak ve hesap düzeyinde tek fatura. Faturalamada yeni bir boyut demek: bugün şube ve firma kotası var, birim kotası yok.
- **Site = ek firma** (`accountRootId` modeli). Yönetim firması hesap kökü, siteler üyeler. Yönetim firmasının kendi muhasebesi (sitelere kestiği hizmet faturası) kendi firmasında durur.
- **Sakin ya da kiracı, firmanın üyesi OLMAZ; ayrı bir kimlik türüdür.** `ensureCompanyAccess` yalnızca "bu kişi bu firmaya erişebilir mi" diye soruyor. Kısıtlı bir çalışan rolüyle eklenen sakin, tek bir unutulmuş uçtan firmanın bütün verisini görebilir. Cari görünürlüğü işinde (CLAUDE.md) aynı dersi yaşadık. Sakin ekranları kendi küçük uç setini kullanır (örn. `/sakin/...`); her uç yalnız "kendi birimi, kendi borcu" sorusunu cevaplar.
- **Kiracı kimlik bilgileri ve yapay zekâ:** modele TCKN ya da kimlik gönderilmez, iç numara ve maske kullanılır (KVKK).

## 13. Yol haritası

| Faz | İçerik |
|---|---|
| 0: Hazırlık | Pilot müşterilerin Excel'leri ve Apsiyon çıktıları · banka ve SMS sağlayıcı görüşmeleri · Apple ve Google geliştirici hesapları (Reypo adına, D-U-N-S) |
| 1: Çekirdek | İlk modül (öneri: Kiralama) · birim, kişi, borçlandırma · banka eşleştirme, taslak fatura ve onay · ihtar · apart firmalarıyla pilot |
| 2: Site modülü | Aidat, işletme projesi, %5 tazminat · genel kurul, işletme defteri · çoklu site tek ekranda |
| 3: Mobil | Yapay zekâ ile işlem ve onay kartları · işletme ve sakin ekranları · bildirimler, kamerayla belge |
| Sonra | Online ödeme (sanal POS) · otel kararı |

- Canlı banka bağlantısı sözleşme biter bitmez devreye girer.
- Kiralama ile başlama önerisinin sebebi: gelir firmanın kendisine ait, Kobipo muhasebesi olduğu gibi işe yarıyor, yasal kural az ve "ödemeye otomatik fatura" talebi orada.
- Süreler bilerek yazılmadı; Faz 0 sonunda netleşecek.

## 14. Açık kararlar ve cevap bekleyen sorular

**Kararlar:**
- İlk modül: Kiralama mı, Site mi? Öneri: Kiralama.
- **Apartta malik kim: firma mı, daire sahibi mi?** Paranın kime ait olduğunu ve faturayı kimin keseceğini belirler.
- Fiyat birimi: daire başına mı? Hesap düzeyinde tek fatura mı?
- Banka bağlantı yolu ve sağlayıcı.
- SMS ve WhatsApp sağlayıcısı.
- Apsiyon'dan geçiş: tamamen mi, bir süre yan yana mı? Yan yanaysa ilk teslim yalnız muhasebe tarafı olabilir.
- Pilot müşteriler kimler?
- Yapay zekâ kullanımı: pakete dahil mi, kredi olarak mı?

**Konuşmada sorulup cevabı gelmemiş sorular:**
- "Vakit yok" derken somut tarih ne, ilk hangi müşteri?
- Ekip kim? Kaç paralel hat taşınabilir? Mobil kodu kim gözden geçirecek?
- Müşteriler Apsiyon'a şu an daire başı ne ödüyor? (Fiyatın referans noktası.)
- Hangi bankalar kullanılıyor?
- Site firması kaç siteyi yönetiyor, toplam kaç daire var? Sitelerin muhasebesini kim tutuyor?
- Müşterilerden "verimiz Türkiye'de dursun" diyen oldu mu? (Supabase'den çıkışı öne çeker.)
- Fiziksel sunucu nerede? Sabit IP'si ve kesintisiz güç kaynağı var mı?
- Reypo'nun mevcut bir Apple geliştirici hesabı ya da D-U-N-S numarası var mı?
- Uygulama adı.
- Vercel önizleme ortamı hangi veritabanına bağlı? (Paralel çalışmadan önce kontrol edilmeli.)
- Paralel çalışmada kısa ömürlü dallara geçilsin mi? (Şu an doğrudan `main`.)
