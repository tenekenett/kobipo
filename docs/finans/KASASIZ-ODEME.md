# Kasasız fatura ödemesi → varsayılan Kasa (DEVİR NOTU, 2026-09-16)

Başka makinede devam etmek için yazıldı. Bağlam ve karar burada, kod yarım.

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

## Yapıldı (bu commit)

- `lib/finans/varsayilan-kasa.ts` → `ensureDefaultCashAccount(db, companyId)`
  (depodaki `ensureDefaultWarehouseId` deseni; slug P2002 yarışı ele alınır).
- `app/api/faturalar/odemeler/route.ts` POST: hesap yoksa varsayılan Kasa;
  Transaction + bakiye artışı artık HER ödemede; yanıt `accountDefaulted: true`
  taşır. Tüm istemci yolları (hızlı satış/alış, fiş onay, Fatura Ödemeleri,
  restoran) bu uçtan geçer. tsc temiz. **Tarayıcıda denenmedi.**

## Kaldı

1. **Ekrana söylet**: `app/(dashboard)/faturalar/[id]/odemeler/page.tsx` ve hızlı
   satış/alış toast'ları `accountDefaulted` ise "Hesap seçilmedi, Kasa'ya
   yazıldı" desin (sessiz geçilmez).
2. **Geçmiş 7 kayıt için backfill**: `scripts/backfill-payment-transactions.mjs`
   kanalsızları BİLEREK atlıyor ve bakiyeye dokunmuyor (para o zaman hesaba
   işlenmişti). Kanalsızlar için YENİ betik gerekir ve FARKI şu: hesap hiç
   dokunulmamış → `ensureDefaultCashAccount` ile Kasa bul/aç, Transaction yaz,
   **Kasa bakiyesini de artır/azalt**, ödemeye `accountId + transactionId` yaz.
   Yön: `type === "SALES" || isPurchaseReturn(inv)` → INCOME, aksi EXPENSE
   (`lib/cari/invoice-direction.ts`). Önce `--apply`siz rapor; 199.999'luk test
   alışı için kullanıcıya sor.
3. Cari DETAY ekstresi (`app/api/cari/customers|suppliers/[id]`) kasasız fatura
   ödemesini satır olarak göstermiyor; `/cari/ekstre` (`lib/cari/ekstre-query.ts`)
   gösteriyor. Backfill sonrası bu 7 kayıt Transaction'a kavuşacağı için fark
   kendiliğinden kapanır; kalıcı çözüm detayı `fetchEkstre`'ye bağlamak.
4. Dokunulmayanlar (bilerek): `lib/invoicing/issue-sales-invoice.ts`
   (Kobipo'nun kendi faturalandırması, env ile hesap seçer), `app/api/pay/[token]`
   (ödeme linki pasif).
