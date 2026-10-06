# Fatura e-postası — DEVİR NOTU (2026-10-06)

> **Dal:** `fatura-eposta` (main'e BİLEREK gönderilmedi — aşağıda "Neden ayrı dal").
> Devam: `git fetch && git checkout fatura-eposta`

## İstek (kullanıcı)

"Gelen ve giden e-faturaları mail olarak gönderme yok bizde. Gelenleri kullanıcının sisteme
kayıt olurken kullandığı maile gönderelim. Giden faturaları da carinin mail adresi kayıtlıysa
oraya göndeririz."

Kullanıcı kararları (AskUserQuestion):
- Gelen bildirimi: **her fatura için ayrı mail** (günlük özet DEĞİL).
- Alıcı: **hesabı açan kişi** = hesap kök firmasındaki en eski ADMIN üyeliği (süper-admin hariç).

## Neden ayrı dal (main değil)

1. Migrasyon `supabase/migrations/20261006000002_fatura_eposta.sql` canlıya **UYGULANMADI**.
   main'e push = Vercel üretim dağıtımı; yeni Prisma istemcisi `companies.invoiceEmailAuto`
   vb. kolonları seçer, kolon yokken firma okuyan ekranlar düşer.
2. İş bitmeden üretime çıkarsa giden e-belgeler müşterilere otomatik mail atmaya başlar
   (henüz gerçek gönderim denemesi yapılmadı).

main'e almadan önce: migrasyonu uygula → kalan işleri bitir → ölç → sonra birleştir.

## Ölçülen durum (canlı veri, salt okur)

- **Önizlemedeki "E-posta gönder" sahteydi:** `app/api/faturalar/[id]/email/route.ts` hiçbir
  şey göndermeden "kuyruğa alındı" dönüyordu. Bu dalda gerçek gönderime bağlandı.
- **Carinin e-postası VKN sorgusundan GELMİYOR** (kullanıcı öyle sanıyordu): GİB sorgusu e-posta
  döndürmez; döndürdüğü `urn:mail:defaultpk@…` posta kutusu etiketidir, mail kutusu değildir
  (cari formu onu `eInvoiceAlias`a yazıyor, doğru). 424 müşterinin 40'ında e-posta var (10'u test
  `.kobipo`); son 30 günde kesilen 122 e-belgenin yalnız 8'inin carisinde e-posta var (~%7).
  → Kullanıcıya önerildi: fatura editöründe "bu caride e-posta yok" uyarısı + hızlı giriş (YAPILMADI).
- **Gelen kutusu kendiliğinden çekilmiyordu:** yalnız "Senkronize" düğmesiyle. Son çekimler 2 Eki;
  Reypo Medya'da 28 Tem'den beri hiç.
- **Şubeler ana firmanın Mysoft kutusunu paylaşıyor:** aynı gelen fatura 2–3 firmada satır
  (483 ETTN, 1.238 satır). Bildirim tekilleştirmesi bu yüzden HESAP × ETTN.
- **Vercel planı Hobby** (API ile okundu: `faramps-projects` → `hobby`). Hobby'de günde birden
  sık cron tanımlanırsa DAĞITIM BAŞARISIZ olur. "Her fatura ayrı mail, anında" sık yoklama ister.
- Mysoft'tan resmî PDF ~6–7 sn, XML ~0,2 sn (Reypo Medya, test ortamı, ADM2026000000018).
- `.env.local` canlı firmaların Mysoft şifresini ÇÖZEMİYOR (NEXTAUTH_SECRET farklı) — canlı
  firma faturasıyla yerelden ölçüm yapılamaz, yalnız test ortamlı Reypo Medya.

## Ayrıca bulunan (bu işten bağımsız, DÜZELTİLMEDİ, kullanıcıya henüz söylenmedi)

`PUT /api/companies/[id]` kısmi gövdede `sector`, `businessModel`, `employeeRange`,
`monthlyInvoiceVolume`, `primaryBusinessNeed`, `usesEDonusumBefore` ve `invoiceSeriesPrefix`
alanlarını `null`'a çekiyor (`x || null` deseni). E-Dönüşüm Ayarları sayfası tam olarak kısmi
gövdeyle kaydediyor → her kayıtta bu alanlar siliniyor olabilir. Önce veriden doğrula, kullanıcıya
anlat, sonra düzelt. (Bu yüzden fatura e-postası anahtarları ayrı DAR uçla yazılıyor.)

## Yapılanlar (bu dal)

| Parça | Dosya |
|---|---|
| Saf kurallar + 15 test | `lib/fatura-eposta/kurallar.ts`, `kurallar.test.ts` |
| Hesap kurucusu | `lib/fatura-eposta/kurucu.server.ts` |
| Giden mail (otomatik + elle + tarama) | `lib/fatura-eposta/giden.server.ts` |
| Gelen kutusu tarama + bildirim | `lib/fatura-eposta/gelen.server.ts` |
| Gelen senkron çekirdeği uçtan çıkarıldı | `lib/integrations/e-invoice/inbox-sync.ts` (uç ince sarmalayıcı) |
| Zamanlanmış uç (CRON_SECRET) | `app/api/e-donusum/cron/fatura-eposta/route.ts` |
| Elle gönder (sahte uç gerçeklendi) + GET geçmiş | `app/api/faturalar/[id]/email/route.ts` |
| Ayar anahtarları (dar uç) | `app/api/e-donusum/eposta-ayarlari/route.ts` + `lib/page-access.ts` kuralı |
| Ayarlar kartı | `components/e-donusum/fatura-eposta-ayarlari.tsx` → `ayarlar/e-donusum/page.tsx` |
| Önizleme: durum çipi + gönder kutusu | `app/(dashboard)/faturalar/[id]/onizleme/page.tsx` |
| Otomatik tetik | `finalizeGibDraft` (send-invoice-helper) + `createInvoiceFromBody` doğrudan gönderim |
| Resend: ek dosya + gönderen adı | `lib/email/resend.ts` (`attachments`, `fromName`) |
| Şablonlar | `lib/email/templates.ts` (`gidenFaturaEmail`, `gelenFaturaEmail`, layout `footerHtml`) |
| Şema + migrasyon | `prisma/schema.prisma`, `supabase/migrations/20261006000002_fatura_eposta.sql` |
| Ölçüm betiği | `scripts/fatura-eposta-kontrol.ts` |

Doğrulama: `tsc` temiz, `npx vitest run` 1.934 test geçti (son düzenlemelerden sonra ilgili
paketler yeniden koşuldu). Gerçek mail gönderimi ve migrasyonlu uçtan uca deneme YAPILMADI.

### Kurgu kısaca

- **Giden:** belge GİB'e gidince (`after()` ile yanıt beklemeden) carinin adresine PDF + UBL XML
  ekli tek mail. Gönderen adı firma adı, yanıt firma e-postasına (yoksa kurucuya). Fatura başına
  TEK otomatik mail: `invoice_email_logs.autoKey` benzersiz = sahiplenme. Durumlar: GONDERILIYOR,
  GONDERILDI, HATA (5 deneme, tarama yeniden dener), ALICI_YOK, KAPALI, BASLANGIC.
  Alış faturası (PURCHASE), fiş, Manuel, GİB taslağı gönderilmez. GİB PK etiketi
  (`defaultpk@`, `urn:mail:`) ve `.test/.example/.kobipo` alanları adres sayılmaz.
- **Gelen:** zamanlanmış iş → (1) hesap × Mysoft mükellefi başına TEK çekim, son 72 saat
  (Mysoft dönem filtresi gönderim tarihine göre) → (2) `notifiedAt` boş satırlar, hesap × ETTN
  gruplanır, ana firma satırı bildirir, diğerleri KOPYA. Tazelik 72 saat (eski senkron "ESKI",
  mail yok). PDF alınamazsa bildirim eksiz gider. 3'lü paralel, gönderimler 600 ms aralıklı.
- **Başlangıç çizgisi:** migrasyon mevcut tüm gelen satırlara ve SENT e-belgelere `BASLANGIC`
  yazar — ilk koşum geçmişe mail dökmez.
- **Anahtarlar:** `Company.invoiceEmailAuto`, `Company.incomingEmailNotify` (varsayılan açık),
  Ayarlar → E-Dönüşüm → "Fatura e-postaları" (şubede de görünür). Elle gönderim anahtara bakmaz.

## ▶ DURUM — 2026-10-06 akşam (ikinci oturum)

Yapıldı:
- Migrasyon canlıda (kullanıcı uyguladı). Doğrulandı: 419 giden e-belge + 2.390 gelen satır
  `BASLANGIC`, `invoice_email_logs` RLS açık; `prisma generate` yapıldı.
- **Tetik kararı: GitHub Actions, 30 dk** (`.github/workflows/fatura-eposta.yml`, :07/:37).
  Kullanıcı Supabase'e bağımlı olmak istemedi; repo private'a alınacak → Actions kotası
  2.000 dk/ay, her koşum ≥1 dk → 30 dk (~1.440 dk/ay). Log yalnız sayıları basar.
- Gelen kuyruğu tıkanması düzeltildi: tazeliği geçmiş satırlar `eskileriKapat` ile toplu kapanır.
- Mysoft `email1` gönderilmiyor → Mysoft tarafından çift mail riski yok (swagger'da
  `NotificationSettingsModel.isSendDocumentMail` var; email1 gönderilirse risk doğar).
- Mysoft'ta webhook yok (swagger-v8 tarandı) → gelen için anlık tetik mümkün değil.
- CLAUDE.md'ye "Fatura e-postası" bölümü yazıldı.
- **Gerçek gönderim ölçüldü:** Reypo Medya test faturası ADM2026000000018, PDF (70 KB) + XML
  ekli olarak kullanıcının hesap e-postasına gitti; Gmail'de doğrudan GELEN KUTUSUNA düştü
  (spam değil). Kayıt: invoice_email_logs MANUAL/GONDERILDI.
- **Kullanıcı kararı: geçmiş faturaya mail gitmez** → `OTOMATIK_EPOSTA_BASLANGIC`
  (2026-10-06 20:50 TR). Gelen: geliş bundan önceyse ESKI; giden tarama: createdAt bundan
  önceyse "hiç denenmemiş" yoluna girmez. Ölçüm anında iki kuralla da aday 0'dı.
- `--gelen` ölçümü: Reypo Medya (Mysoft TEST ortamı) kutusunda son 72 saatte 32 fatura, hepsi
  Mysoft'un deneme faturaları. Yayından sonra yeni gelenler Reypo kurucusuna bildirilir —
  test ortamını otomatik maillerden çıkarma sorusu kullanıcıya soruldu, cevap yok.

Kalan:
1. **GitHub sırrı (kullanıcı):** repo → Settings → Secrets and variables → Actions →
   `CRON_SECRET` = Vercel'deki `CRON_SECRET` değeri. Workflow yalnız main'den çalışır.
2. ~~Ölçüm~~ — yapıldı (yukarıda).
3. main'e birleştir + push → Vercel dağıtımı. Dağıtımla birlikte giden e-belgeler müşterilere
   otomatik mail atmaya başlar (yalnız OTOMATIK_EPOSTA_BASLANGIC sonrası belgeler).
   Sonra Actions'ta "Run workflow" ile elle bir koşum.
4. Öneriler (onay yok): fatura editöründe "carinin e-postası yok" uyarısı; gelen listede
   "bildirildi" bilgisi.
5. `PUT /api/companies/[id]` alan silme — kullanıcıya raporlandı, karar bekliyor
   (veri: onboarding'li 31 firmanın 18'inde sektör boş; Seri No ekranı tek alanlı gövde yolluyor).
6. Spam riski (kobipo.com Gmail itibarı) — kullanıcıya söylendi.

---

### (Eski) DEVAM listesi — ilk oturum

#### Kalan işler (ilk oturumdaki hâli)

1. **Migrasyonu canlıya uygula (kullanıcı çalıştırır):**
   `node scripts/apply-migration.js supabase/migrations/20261006000002_fatura_eposta.sql`
   (Claude Code'un izin sınıflandırıcısı canlı DB'ye yazan komutu reddeder.)
   Sonra `npx prisma generate` (çalışan `next dev` varsa önce durdur — EPERM).
2. **Tetikleyici sıklığı — KULLANICI KARARI BEKLİYOR.** Hobby'de cron günde birdir; "her fatura
   ayrı mail, anında" için seçenekler:
   - Vercel Pro ($20/ay/üye) → `vercel.json`a `*/10 * * * *` gibi bir girdi.
   - Dış zamanlayıcı (cron-job.org, GitHub Actions schedule) → uca `Authorization: Bearer $CRON_SECRET`.
   - Supabase `pg_cron` + `pg_net` (DB'den uca istek; sır DB'de durur).
   Karar gelene kadar en az GÜNLÜK girdi eklenebilir (Hobby'de geçerli):
   `{ "path": "/api/e-donusum/cron/fatura-eposta", "schedule": "30 6 * * *" }` — ama günlükte
   72 saat tazelik + koşum başı ~15 bildirim kapasitesi yoğun firmada (Eren ~7/gün) yetmeyebilir.
   `vercel.json` HENÜZ DEĞİŞTİRİLMEDİ.
3. **Ölç (migrasyondan sonra):**
   - `npx tsx scripts/fatura-eposta-kontrol.ts --gelen` → zamanlanmış işin şu an ne yapacağı
     (salt okur: kutular, DB'de olmayan yeni faturalar, maskeli kurucu).
   - `npx tsx scripts/fatura-eposta-kontrol.ts --giden=cmulg4a1s000112k041nqz6uj` (Reypo Medya,
     test ortamı) → PDF/XML/HTML (göndermez).
   - Gerçek gönderim YALNIZ kullanıcının verdiği test adresine:
     `... --giden=<id> --gonder --to=<adres>` (cariye test maili atılmaz).
   - Dev sunucuda önizleme ekranı: durum çipi + "E-postayla gönder" kutusu.
4. **CLAUDE.md'ye bölüm yaz** (kural tek yerde `lib/fatura-eposta/kurallar.ts`; giden fatura
   başına tek otomatik mail/autoKey; gelen hesap × ETTN tekilleştirme; 72 sa tazelik;
   başlangıç çizgisi; dar ayar ucu; tetik sıklığı kararı).
5. **Öneri (kullanıcı onayı yok):** fatura editöründe carinin e-postası yoksa uyarı + hızlı giriş;
   gelen e-faturalar listesinde "bildirildi" bilgisi.
6. `PUT /api/companies/[id]` alan silme bulgusunu kullanıcıya raporla (yukarı bak).
7. Spam: kobipo.com'un Gmail itibarı zayıf (2026-09-28 ölçümü, mail-tester 10/10 ama Gmail'de
   spam). Müşterinin müşterisine giden fatura maili spama düşebilir; uygulama maillerini alt alan
   adına ayırma kararı kullanıcının. Kullanıcıya söylendi.
8. Sonra: main'e birleştir + push (kullanıcının varsayılanı "doğrudan main").
