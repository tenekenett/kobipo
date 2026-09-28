# Worldline entegratör başvurusu — e-posta taslağı (2026-09-28)

Durum: **taslak, gönderilmedi.** Alıcı adresi Worldline çağrı merkezinden (0 850 250 40 30)
entegrasyon ekibi için alınacak. Sorular `ARASTIRMA.md` → "Worldline'a sorulacaklar" ile aynı sırada.

---

**Konu:** Kobipo – Worldline ÖKC entegrasyonu (GMP-3 kablolu ve TSM kablosuz) başvurusu

Merhaba,

Reypo Bilişim olarak geliştirdiğimiz Kobipo, KOBİ'ler için bulut tabanlı ön muhasebe ve
restoran/kafe (adisyon, masa, hızlı satış) yazılımıdır. Müşterilerimizin kullandığı Worldline
ÖKC'lerine (Ingenico ve PAX) satış gönderebilmek için entegratör olarak çalışmak istiyoruz. Hem
kablolu (GMP-3) hem kablosuz (TSM) yolu birlikte değerlendiriyor, işletmenin ihtiyacına göre
ikisini de sunmayı planlıyoruz. Test için elimizde bir Ingenico iDE280 bulunuyor
(seri no: [SERİ NO]).

Başvuru süreci ve aşağıdaki konularda bilgi rica ederiz.

**Sözleşme ve kapsam**

1. Kablolu (GMP-3 SDK) ve kablosuz (TSM entegrasyon firması) entegrasyon için başvuru süreci,
   sözleşme ve ücretler nelerdir? Tek sözleşme iki yolu da kapsıyor mu? Entegratör/geliştirici
   ücreti ve test cihazı bedeli var mı?
2. Anlaşma Worldline'ın işlettiği tüm ÖKC modellerini kapsıyor mu (Ingenico iDE280, iWE280,
   Move/5000F ve PAX A910SF)? Tüm modeller için aynı SDK ve aynı TSM arayüzü mü kullanılıyor?
3. İşletmelerin GMP3 Hizmet Bedeli lisansını Kobipo üzerinden satıp müşterimiz adına
   tanımlatabileceğimiz bir bayi / iş ortaklığı modeli var mı?
4. Test ortamı, simülatör ya da test cihazı imkânı var mı? Elimizdeki iDE280 ile kablosuz test
   yapabilir miyiz?
5. iKasa'da "GMP3 + Z Raporu Hizmet Bedeli" kablolu ve kablosuz için 7.702 TL görünüyor. Lisansta
   cihaz başına tek bir yol mu seçiliyor, yoksa aynı cihaz iki yolla da kullanılabilir mi?

**Kablosuz (TSM)**

6. TSM sunucusu ile entegratör sunucusu arasındaki iletişim hangi protokolle yapılıyor
   (HTTPS/REST mi, TCP mi)? Port, kimlik doğrulama yöntemi ve TSM'nin kaynak IP adresleri nelerdir?
   iKasa'daki "Restoran Kurulum Bilgileri" (kullanıcı adı / şifre) işletme başına bizim
   belirlediğimiz bir kimlik mi, TSM bize bu bilgiyle mi bağlanıyor?
7. Cihazda "Açık Çekler" açıldığında liste anlık olarak mı çekiliyor, belirli aralıklarla mı?
   Yazılım tarafından bir satışı cihaz ekranına doğrudan gönderme (anında ödeme) imkânı var mı?
8. Bir çek cihazda açıldığında kilitleniyor mu? Bu sırada yazılımdan ürün eklenir ya da çek
   güncellenirse ne oluyor?

**Kablolu (GMP-3)**

9. GMP-3 iletişim kütüphanesi hangi biçimde sağlanıyor (Windows DLL, .NET vb.) ve hangi işletim
   sistemlerini destekliyor? Android için kütüphane var mı?
10. iKasa'da RS232, USB ve TCP/IP seçenekleri görünüyor. Tek bilgisayar birden fazla cihaza
    bağlanabiliyor mu? TCP/IP'de cihazın sabit IP'si gerekiyor mu?
11. Cihaz–bilgisayar eşleştirmesi yetkili servis tarafından mı yapılıyor, yoksa uzaktan ya da
    işletmenin kendisi tarafından yapılabiliyor mu? Ücreti ve süresi nedir?

**Her iki yol için**

12. Ödeme tamamlandığında yazılıma hangi bilgiler dönüyor: fiş no, Z no, EKÜ no, ödeme kırılımı
    (nakit / kredi kartı / yemek kartı), bir fişte birden fazla ödeme?
13. İptal ve iade akışı nasıl işliyor? Fatura isteyen müşteride fatura bilgi fişi basılabiliyor mu,
    bilgi fişi numarası yazılıma dönüyor mu?
14. "GMP3 + Z Raporu" paketindeki Z raporu (bilgi dışa aktarım) hizmeti: işletme iKasa'da
    "Entegrasyon Yetkileri (Z Raporum)" ile yetki verdiğinde Z raporu verisi entegratöre nasıl
    aktarılıyor (API, dosya, e-posta)? Hangi alanlar geliyor?

Mümkünse teknik dokümantasyonu ve sözleşme taslağını paylaşmanızı, uygun olduğunuz bir zamanda
kısa bir görüşme ayarlamayı rica ederiz.

Saygılarımızla,

[AD SOYAD]
Reypo Bilişim – Kobipo
[TELEFON] · [E-POSTA] · www.kobipo.com
