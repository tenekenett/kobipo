# İşletme asistanı — model ölçümü

> Durum: **ölçüm yapılmadı.** `lib/asistan/modeller.ts` içindeki varsayılan
> (`anthropic/claude-sonnet-5`) bir TAHMİNDİR. Ölçüm koşulduktan sonra kazanan
> model varsayılan yapılacak ve gerekçesi hem buraya hem o dosyanın başına
> yazılacak — fiş taramada olduğu gibi (`lib/fis-ocr/models.ts`).

## Neden ölçüyoruz

Hazır benchmark'lar bu işi ölçmüyor. Burada sorulan soru "hangi model daha
zeki" değil:

1. **Rakam sadakati** — aracın döndürdüğü sayıyı değiştirmeden söylüyor mu?
   Yuvarlıyor mu ("42.800" yerine "yaklaşık 43 bin")? Kendi hesabını yapıp
   tutmayan bir toplam üretiyor mu?
2. **Susabilme** — veri yokken "bilmiyorum" diyebiliyor mu, yoksa makul görünen
   bir şey mi uyduruyor? Bir ön muhasebe programında ikincisi, yanlış cevaptan
   daha zararlıdır: güvenilir görünür.
3. **Araç seçimi** — doğru aracı, doğru parametreyle, kaç turda çağırdı?
   "En çok satan aynı zamanda en kârlısı mı" sorusu iki çağrı ister; tek çağrıyla
   cevap veren model ya uyduruyordur ya soruyu anlamamıştır.
4. **Maliyet ve süre** — sağlayıcının bildirdiği gerçek rakam (`usage.cost`),
   bizim fiyat tablomuz değil.

## Nasıl koşulur

Uygulama ayakta olmalı (`npm run dev`) ve firma `ASISTAN_COMPANIES` beyaz
listesinde bulunmalı.

```bash
npm run asistan:olcum -- \
  --company ornek-market \
  --email kullanici@firma.com \
  --password '***'

# Belirli modeller:
npm run asistan:olcum -- --company ornek-market --email ... --password ... \
  --model anthropic/claude-opus-5,google/gemini-3.7-flash
```

Tezgâh modeli DOĞRUDAN çağırmaz; uygulamanın kendi ucuna (`/api/asistan/sohbet`)
`model` parametresiyle gider. Böylece ölçülen şey üretimde koşan yolun kendisi
olur — araçlar, yetki kapısı, brifing, hepsi dahil.

## "Kaynaksız sayı" sütunu nedir

Otomatik ipucu: cevaptaki her sayı, o sohbette çağrılan araçların çıktısında ya
da brifing sinyallerinde geçmeli. Geçmiyorsa işaretlenir.

**Bu bir skor değildir.** Meşru olduğu hâlde işaretlenen sayılar var:

- "90 gün"ü "3 ay" diye yazmak
- iki satırı toplayıp "toplam 5 ürün" demek
- yüzdeyi kendi hesaplaması

Sütun yalnız **nereye bakacağınızı** gösterir. Karar, çıktı dosyasındaki
cevapları okuyarak verilir.

## Kararı ne verir

Ölçümün çıktı dosyasındaki cevaplar okunarak. Bakılacaklar:

- Tavsiye somut mu (ürün adı, tutar, yapılacak iş) yoksa genel geçer mi
  ("stoklarınızı gözden geçirin")?
- Uydurma rakam var mı?
- Cevabı olmayan soruda ("önümüzdeki çeyrekte cirom ne olur") tahmin yapmayı
  reddedebilmiş mi?
- Maliyet farkı, kalite farkını haklı çıkarıyor mu? Firma başına aylık maliyet
  sentlerle ölçülüyorsa pahalı modelin farkı ucuza gelir; asistan çok kullanılan
  bir ekran hâline gelirse tablo değişir.

## Ölçüm sonuçları

_(Ölçüm koşulduğunda tablo buraya yazılacak: model · süre/soru · maliyet/soru ·
kaynaksız sayı · gözlemler.)_
