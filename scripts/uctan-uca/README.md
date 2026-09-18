# Uçtan uca tarama

Her API ucunu, her panel sayfasını ve her query süzgecini gerçek HTTP ile, dört kimlikle
vuran güvenlik + sağlamlık + süre taraması. Tek seferlik bir denetim değil; yeni uç
açıldığında ya da kapı mantığı değiştiğinde yeniden koşturulur.

```
scripts/uctan-uca/
  envanter.mjs     statik: app/api/**/route.ts → metotlar, kapı türü, query anahtarları
  tarama.mjs       dinamik: sondalar (auth / çapraz firma / IDOR / VIEWER / fuzz / sayfa)
```

## Koşturma

Dev sunucu 3.000+ istekte 3–4 GB'a şişiyor (Turbopack); tarama **üretim derlemesine**
karşı koşturulur — bellek düşük, süreler gerçekçi, HMR yok:

```bash
npx next build
npx next start -p 3005 > /tmp/kobipo.log 2>&1 &
TEST_BASE_URL=http://localhost:3005 node scripts/uctan-uca/tarama.mjs --eszamanli=4
```

Yarıda kesilirse (bellek, kapanış) `--devam` kaldığı yerden sürer; sondalar
`sondalar.jsonl`'e anında yazılır. Çıktı: `sonuc.json` (ham) ve
`docs/denetim/UCTAN-UCA-TARAMA-SONUC.md` (üretilen rapor). Yorumlanmış rapor ve
düzeltme kararları ayrı dosyada: `docs/denetim/2026-09-18-UCTAN-UCA-TARAMA.md`.


## Kimlikler ve kurallar

| kimlik | nedir | beklenen |
|---|---|---|
| `anon` | çerez yok | 401/403/3xx; 400/404 = doğrulama kapıdan önce (düşük) |
| `adminA` | A firmasının süper OLMAYAN ADMIN'i | 2xx; 5xx = bulgu; süre/boyut ölçülür |
| `adminB` | A'ya üye olmayan firmanın ADMIN'i, `companyId=A` | 403/404; gövdede A işareti = **sızıntı** |
| `adminB` + kendi firması + A id'si | IDOR sondası | 404; A id'si gövdede = **IDOR** |
| `viewerA` | A'da VIEWER (tarama açar, siler) | okuma 2xx, yazma 403 |
| `super` | varsa süper-admin | yalnız salt-okuma olumlu sondalar |

- A firması **gerçek müşteri olamaz**: olumsuz yazma sondaları kapı kırıksa YAZAR.
  Varsayılan A = Reypo Medya Ajansı (dev firması). Tarama öncesi/sonrası A'nın 57
  tablosunun satır sayısı karşılaştırılır; fark `veri-degisti` (kritik) olur.
- Dış servise giden uçlar (`EXTERNAL`) olumlu sondaya girmez; kapı sondaları girer.
- Fuzz yalnız GET + adminA: her query anahtarına 17 değer (+ `limit=100000` gibi ada
  özel). Ölçülen: 5xx, stack sızıntısı, süre.
- "companyId yok sayıldı" (adminB 2xx ama A işareti yok) sızıntı DEĞİLDİR: uç param'ı
  değil oturumun firmasını kullanmıştır; elle doğrulanır.

## Bilinen sınırlar

- Yazma uçlarının OLUMLU yolu (geçerli gövdeyle kayıt açma) kapsam dışı; gövde şemaları
  uca özgü. Gövde FK sahipliği için `lib/company/owned.ts` + 2026-09-15 denetimi.
- Fikstürü olmayan `[id]` uçları "Kapsanmayan" listesine düşer (A'da o tablo boşsa).
- Süreler dev'de anlamsız (derleme + uzak DB); üretim derlemesinde bile makine-DB
  gecikmesi (Türkiye → eu-central-1, ~70 ms/sorgu) eklidir. Ortamdan bağımsız rakam
  **sorgu sayısıdır** — ölçmek için prisma.ts'e geçici bir sorgu sayacı eklenip (KOBIPO_QUERY_LOG bayrağı) uç başına sayılabilir; performans turu için bkz. docs/denetim/2026-09-18-UCTAN-UCA-TARAMA.md.
