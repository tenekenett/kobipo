# PayTR Tekrarlayan Ödeme — açma ve teyit listesi

**Neden bu belge var:** otomatik yenileme zinciri koda kuruldu ama **kapalı doğdu**.
Gerçek para hareketi olduğu için PayTR'ın uç adresi ve alan adları tahminle canlıya
alınmadı. Aşağıdaki üç şey teyit edilince tek env değişkeniyle devreye girer.

**Bugünkü davranış (bayrak kapalıyken):** ilk ödeme, kilitleme, hoşgörü ve uyarılar
tam çalışır. Vadesi gelen abonelik `runRecurring` tarafından **değiştirilmeden**
bırakılır (`pending` sayılır), ertesi gün yeniden denenir. Yani sistem yanlış bir şey
yapmaz — sadece kendiliğinden tahsilat etmez.

---

## 1. Ürün açık mı?

PayTR mağaza panelinde / müşteri temsilcinizde sorulacak:

> "Mağaza hesabımızda **Tekrarlayan Ödeme (kart saklama)** özelliği açık mı? Değilse
> açtırmak için ne gerekiyor?"

Açık değilken `recurring_payment=1` göndermek ödeme isteğini **reddettirir**. Bu yüzden
kod, bayrak kapalıyken bu alanı hiç göndermiyor — normal ödeme akışı etkilenmez.

## 2. Teyit edilecek üç şey

Kodda bu üçü açıkça işaretli. Yanlışsa düzeltme tek satırlıktır.

| # | Ne | Kodda nerede | Bugünkü varsayım |
|---|---|---|---|
| A | **Çekim uç adresi** | `lib/integrations/paytr/client.ts` → `PAYTR_RECURRING_URL` | `https://www.paytr.com/odeme/api/recurring-payment` — `PAYTR_RECURRING_URL` env'i ile kod değişmeden geçersiz kılınabilir |
| B | **İmza (hash) içeriği** | aynı dosya → `chargeRecurringPayment` içindeki `hashStr` | `merchant_id + merchant_oid + payment_amount + utoken + currency + test_mode`, ardından PayTR'ın değişmeyen deseni: `base64(HMAC_SHA256(hashStr + salt, key))` |
| C | **Bildirimdeki kart token'ının alan adı** | `lib/integrations/paytr/notification.ts` → `readCardFields` | `utoken` (kart markası `card_brand`/`card_type`, son dört hane `card_no`'dan) |

### C kendiliğinden çözülür

Alan adını tahmin etmek yerine **öğreniyoruz**: otomatik yenilemeli bir sipariş başarıyla
ödendiği hâlde token gelmezse, bildirimin **tüm anahtarları** log'a yazılır:

```
[paytr-callback] otomatik yenilemeli sipariş <id> için KART TOKEN'I GELMEDİ —
bu abonelik kendiliğinden yenilenemez. Bildirimdeki alanlar: [merchant_oid, status, ...]
```

İlk gerçek recurring ödemesinden sonra bu satıra bakmak yeterli: doğru ad orada görünür.

## 3. Açma sırası

```bash
# 1) Ürün açıldıktan sonra, ÖNCE test modunda:
PAYTR_TEST_MODE=1
PAYTR_RECURRING_ENABLED=1
```

1. Test kartıyla **otomatik yenileme açık** bir abonelik satın alın.
2. Log'da yukarıdaki uyarının **çıkmadığını** doğrulayın (token geldi demektir).
3. DB'de kontrol: `subscriptions.providerSubscriptionId` dolu, `cardLast4` dolu.
4. Müşteri abonelik ekranında "Kayıtlı kart" görünmeli.
5. Aboneliğin `periodEnd`'ini elle geçmişe çekip günlük işi tetikleyin:
   ```bash
   curl -H "Authorization: Bearer $BILLING_CRON_SECRET" https://<alan-adi>/api/billing/cron/daily
   ```
   Yanıtta `recurring.renewed: 1` ve `recurring.invoiced: 1` bekleyin.
   > Not: iş **günde bir kez** koşar (çift koşum kilidi). Aynı gün tekrar denemek için
   > o günün `cron_runs` satırı silinmeli.
6. `subscription_events` tablosunda `RENEWED` satırını ve kesilen faturayı doğrulayın.
7. Ancak bundan sonra `PAYTR_TEST_MODE=0`.

## 4. Güvenlik notu

Kart numarası, son kullanma tarihi ve CVV **hiçbir koşulda** saklanmıyor. Veritabanında
duran şey PayTR'ın kart token'ı (`providerSubscriptionId`) ile gösterim amaçlı marka ve
**son dört hane**dir. Çekim yetkisi tamamen PayTR tarafındadır.

## 5. Bayrak kapalı kalırsa ne olur?

Sistem tutarlı çalışmaya devam eder, sadece tahsilatı **müşteri başlatır**:

- Dönem bitiminde uyarı e-postası ve panel şeridi çıkar (7/3/1 gün + hoşgörü + kilit).
- Hoşgörü boyunca (aylık 7, yıllık 15 gün) erişim sürer.
- Müşteri `/ayarlar/abonelik` üzerinden yeni dönem satın alır.
- `isAutoRenewActive` false döndüğü için "bitiyor" şeridi **bastırılmaz** — yani
  müşteri her dönem uyarılır. Bu bilinçli: kimse tahsilat etmeyecekse susmak yanlış olur.
