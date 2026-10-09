# Müşavire çıkışın mevzuat çerçevesi — e-Defter, e-Beyan, Defter Beyan (2026-10-09)

Kobipo'nun C adımı (Luca/Zirve aktarımı **ya da** e-Defter) için bilinmesi gerekenler. Kaynaklar
çoğunlukla entegratör/danışman yazıları; uygulamadan önce GİB'in kendi duyurusu ve teknik
kılavuzuyla doğrulanmalı (edefter.gov.tr, dijital.gib.gov.tr).

## e-Defter

- Yevmiye ve defter-i kebir GİB standardında **XBRL GL** biçiminde üretilir; imzalanır (tüzel kişi
  **mali mühür**, gerçek kişi nitelikli e-sertifika); **berat** (yevmiye kaydı içermeyen, defterin
  değişmezliğini gösteren dosya) GİB'e yüklenir. Başvuru edefter.gov.tr.
- Tek kaynağa göre 2025'ten itibaren yevmiye XML'i GİB'e yükleniyor, kebir yüklenmiyor ama
  üretilip saklanıyor (doğrulanmadı).
- **2026 yükleme tercihi:** aylık ya da geçici vergi dönemi (3 aylık); bildirim son günü 31 Ocak
  2026, bildirmeyen aylık sayılır.
- **Aylık takvim:** ayın beratı 4. ayın 10'u (gelir vergisi) / 14'ü (kurumlar). Ör. Ocak → 10/14
  Mayıs; Haziran 2026 → 12/14 Ekim 2026 (hafta sonu kayması). Aralık beratı yıllık beyanı izleyen
  aya uzar. GİB 11 Mayıs 2026'da bir dönemi Haziran'a uzattı.
- **Saklama:** VUK 5 yıl, TTK 10 yıl → pratikte 10 yıl. 2020 sonrası e-defterlerin **ikincil
  kopyası** 10 yıl GİB'de ya da e-defter saklayıcısında; sorumluluk mükellefte.
- Kimler yapıyor: müşavir programları (Luca — TÜRMOB sunucusunda saklama, Zirve, Mikro, Logo) ve
  entegratörler (QNB, Nilvera, Uyumsoft, Sovos, Faturaport'un takvim yazısı). Mikro'da e-Defter
  ek modül ~33.450 TL ilk yıl (bayi).

**Kobipo için:** e-Defter = XBRL GL üretimi + imza (mali mühür / sertifika — HSM ya da entegratör)
+ berat + saklama + takvim takibi + yıl içinde fiş değişmezliği (kapanmış ay). Kobipo'nun defteri
dönem kilidi (`lockedUntil`) ve sıralı fiş numarasıyla buna hazırlıklı; ama imza ve saklama bir
entegratör işi. Mysoft'un e-Defter hizmeti olup olmadığı sorulmalı (swagger'da e-Defter ucu
aranmalı). Müşavirin zaten yaptığı işi Kobipo'ya almak, müşaviri rakip yapar — karar kullanıcının.

## Yeni e-Beyan (KDV beyannameleri)

- Kapsam: **KDV1 (0015), KDV2 (4017), KDV2B (4018), KDV4 (0016), KDV9015**. Diğer beyannameler
  eski (BDP/e-Beyanname) yolda.
- Kademeli geçiş: 1 Eylül 2025 Eskişehir + Kırşehir → … → **2026/Temmuz döneminden (1 Ağustos
  2026) itibaren İstanbul HARİÇ tüm iller** (GİB duyurusu 20 Temmuz 2026; Prozon sirküleri 1810).
- Gönderim: Dijital Vergi Dairesi portalı (kırmızı uyarılar giderilmeden gönderilmez) ya da
  **muhasebe yazılımından web servisle**. Yeni sistemde XML hazırlama adımı yok; yazılımların KDV
  XML aktarım modülleri yeni web servis protokolüne uyarlanmalı. Bir ERP notunda: entegratör
  bilgileri, **GİB token** ve mükellef grubu tanımı; toplu gönderim yok; **önce KDV2** (tahakkuk
  ödenince KDV1).
- GİB'in beyannameyi e-belge verisinden ön doldurup doldurmadığı kaynaklarda net değil.

**Kobipo için:** Kobipo'nun KDV hesabı tek yerde (`lib/raporlar/kdv-kural.ts`,
`computeVatDeclaration`) — beyannamenin tablolarına (matrah/oran/tevkifat/devreden) karşılık
gelen bir "e-Beyan'a hazır döküm" müşavirin işini kısaltır. Doğrudan gönderim yetki ve sorumluluk
meselesi (beyanı müşavir imzalar). Önce döküm, gönderim ancak müşavir talebiyle.

## Defter Beyan Sistemi (DBS)

İşletme defteri / basit usul / serbest meslek mükellefleri için GİB'in defter sistemi. Mikro,
Logo ve Zirve doğrudan aktarıyor. Kobipo'nun muhasebe modülü bilanço esasına (Tekdüzen) göre;
işletme defteri tutan küçük müşteriler için DBS'ye aktarım ayrı bir ihtiyaç (gelir/gider
kayıtları zaten Kobipo'da).

## Kaynaklar

- e-Defter: [edefter.gov.tr duyurular](https://edefter.gov.tr/duyurular.html) ·
  [PwC — 2026 süre uzatımı](https://www.pwc.com.tr/tr/hizmetlerimiz/vergi/dolayli-vergi/bultenler/e-donusum-bultenleri/2026/e-defter-berat-yukleme-suresi-uzatildi.html) ·
  [QNB — 2026 berat takvimi](https://www.qnbesolutions.com.tr/blog/2026-e-defter-berat-takvimi-aylik-ve-gecici-vergi-donemi-tarihleri) ·
  [Nilvera — berat süreleri](https://www.nilvera.com/e-defter-berat-yukleme-sureleri) ·
  [STB — 2026 tercih son günü](https://www.stb-cpaturkey.com/2026-e-defter-berat-yukleme-tercihi-31-ocak-2026/) ·
  [Sovos — ikincil kopya saklama](https://sovos.com/tr/blog/kdv/e-defter-ikincil-kopya-saklama-sureleri/) ·
  [Uyumsoft — e-Defter saklama](https://www.uyumsoft.com/blog/e-defter-saklama-nedir-nasil-saklanir)
- e-Beyan: [Prozon sirküler 1810](https://prozon.net/sirkuler/istanbul-haric-tum-turkiyede-kdv-beyannameleri-kdv1-kdv2-kdv2b-kdv4-kdv9015-yeni-e-beyan-sistemine-geciyor/) ·
  [Müşavirler Kulübü — e-Beyan rehberi](https://musavirlerkulubu.com.tr/makale/kdv-beyannamelerinde-e-beyan-donemi-basliyor-mali-musavirler-icin-rehber) ·
  [Dijital Vergi Dairesi — gerekli programlar](https://dijital.gib.gov.tr/gerekliProgramlar) ·
  [Birleşik Yazılım — KDV1 e-Beyan notları](https://document.birlesikyazilim.com/KDV1BeyannamesiE-BeyanIslemleri.html) ·
  [Zirve — yeni e-Beyan'da KDV-1](https://blog.zirveyazilim.net/yeni-e-beyan-kapsaminda-kdv-1-beyannamesi-nasil-hazirlanir)
