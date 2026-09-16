# Kasasız fatura ödemesi → varsayılan Kasa (2026-09-16)

İlk commit devir notu olarak yazıldı; kalan üç madde aynı gün tamamlandı
(aşağıda "Tamamlandı").

## Sorun

Fatura ödemesi hesap (kasa/banka) seçilmeden girilince yalnız `invoice_payments`
yazılıyor, `Transaction` üretilmiyordu (`accountId` zorunlu). Sonuç: fatura
"ödendi", cari borç düşmüş, **para hiçbir kasada yok** — kasa bakiyesi, Finans >
Hareketler, pano geliri (`getAdminStats` yalnız `transactions` toplar), nakit
projeksiyonu onu görmez.

Canlıda 2026-09-16: **7 kayıt, ₺202.169,74** (`transactionId IS NULL AND
accountId IS NULL`, iptal/dönüştürülmüş hariç):

| Firma | Adet | Tutar | Yöntem | Hesap sayısı |
|---|---|---|---|---|
| Reypo Medya Ajansı | 4 | 200.767 (199.999'u test alışı ALI-2026-0007) | CASH, VIRTUAL_POS | 1 |
| Materyon | 1 | 959,04 | VIRTUAL_POS | 0 |
| Demo Firma | 1 | 306 | CASH | 0 |
| EREN FORKLİFT PNÖMATİK | 1 | 137,70 | VIRTUAL_POS | 0 |

Reypo'da hesap tanımlıyken bile kasasız yazılabilmiş → sorun yalnız "kasası yok"
değil, alan zorunlu değil.

## Karar: (b) varsayılan Kasa

Hesap zorunlu YAPILMADI (33 firmanın 21'inde hiç hesap yok; POS satışı bloke
olurdu). Hesap seçilmezse firmanın en eski aktif CASH hesabı, yoksa otomatik
açılan "Kasa" (kod `KASA`) kullanılır; hareket oraya yazılır. Yanlış yerdeyse
kullanıcı hareketi sonradan taşır. BANK'a düşülmez.

## Yapıldı (ilk commit)

- `lib/finans/varsayilan-kasa.ts` → `ensureDefaultCashAccount(db, companyId)`
  (depodaki `ensureDefaultWarehouseId` deseni; slug P2002 yarışı ele alınır).
- `app/api/faturalar/odemeler/route.ts` POST: hesap yoksa varsayılan Kasa;
  Transaction + bakiye artışı artık HER ödemede. Tüm istemci yolları (hızlı
  satış/alış, fiş onay, Fatura Ödemeleri, restoran) bu uçtan geçer.

## Tamamlandı

1. **Ekran söylüyor.** Uç yanıtı `accountDefaulted` + `accountCreated` taşır;
   not metni tek yerde: `lib/finans/hesapsiz-odeme.ts` → `defaultedAccountNote`.
   Hızlı satış/alış, fiş onay kartı, kahveci satış ve adisyon kapanışı notu
   mevcut başarı toast'ına EKLER (toast sınırı 1: ayrı toast ötekini ezerdi) ve
   hesap listesini tazeler — sonraki satış yeni Kasa'yı açıkça seçer. Fatura
   Ödemeleri ekranı hesap alanının altında "boş bırakılırsa kasaya yazılır" der.
   **Tarayıcıda satış yapılarak denenmedi** (dev canlı DB'de; satış canlıya fiş
   ve Kasa yazardı). Saf kısım testli: `hesapsiz-odeme.test.ts`.
2. **Backfill uygulandı** — `npx tsx scripts/kasasiz-odeme-backfill.ts`
   (`--uygula`, `--atla=<ödemeId>`, `--firma=<id>`). Eski `.mjs` betiğinden farkı
   dosya başında: hesaba hiç dokunulmamıştı, bu yüzden bakiye de güncellenir.
   6 ödeme işlendi; Demo Firma, Reypo, Materyon ve Eren Forklift'te "Kasa" açıldı
   (Reypo'nun tek hesabı kasa değildi). Ölçüldü: dört Kasa'nın bakiyesi hareket
   toplamına eşit (306 / 768 / 959,04 / 137,70).
   **Bilerek atlanan:** ALI-2026-0007 test alışının 199.999 TL'lik ödemesi
   (`cmransoya0001vqhplsepd9kl`). İşlenseydi Reypo Kasa'sı −199 bin açılırdı;
   test faturası silinecek. Silinmezse aynı betik `--firma` ile işleyebilir.
   Not: sanal POS tahsilatları da Kasa'ya düştü — karar (b) BANK'a düşmüyor;
   yanlış yerdeyse hareket taşınır.
3. **Cari detay tablosu ekstreyle aynı kurallardan geçiyor** —
   `lib/cari/ekstre-query.ts` → `faturaSatirYonu` (fatura sütunu) ve
   `faturaOdemesiSatirlari` (kasaya bağlanmamış ödeme satırı); `fetchEkstre` ve
   iki detay ucu bunları kullanır. Bağlantısız ödeme hâlâ doğabilir: Kobipo'nun
   kendi faturalandırması tahsilat hesabı tanımsızken bilerek yazıyor.
   Yan bulgu da düzeldi: detay ucu faturayı yalnız kartın kendi tipine göre
   yazıyordu, iade ve mahsup faturası tabloda 0/0 duruyordu. Ölçüldü: böyle
   faturası olan 7 kartın 6'sında tablonun son bakiyesi karttan farklıydı
   (earsin: kart −78.365, tablo +116.062); şimdi yedisi de tutuyor.
   Tam `fetchEkstre`'ye bağlama YAPILMADI: detayda ekstrede olmayan şeyler var
   (dönüştürülmüş fiş bilgi satırları, çek/senet `issueDate`, `createdAt` sırası)
   — ayrı iş.

## Dokunulmayanlar (bilerek)

`lib/invoicing/issue-sales-invoice.ts` (Kobipo'nun kendi faturalandırması, env
ile hesap seçer), `app/api/pay/[token]` (ödeme linki pasif).
