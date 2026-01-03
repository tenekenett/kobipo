# Supabase Bağlantı Sorunu Çözümü

## Sorun
Veritabanına bağlanılamıyor: `Can't reach database server`

## Çözüm Adımları

### 1. Supabase Dashboard'dan Connection String Alın

1. **Supabase Dashboard**'a gidin: https://supabase.com/dashboard
2. Projenizi seçin
3. **Settings** (Sol menüden) > **Database**
4. **Connection string** sekmesine tıklayın
5. **Transaction mode** seçin (migrations için)
6. **URI** formatını seçin
7. Connection string'i **kopyalayın**

### 2. Connection String Formatı

Supabase'den aldığınız connection string şu formatta olacak:
```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

VEYA direkt connection:
```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### 3. .env Dosyasını Güncelleyin

Supabase dashboard'dan kopyaladığınız connection string'i `.env` dosyasındaki `DATABASE_URL` değeriyle değiştirin.

**ÖNEMLİ:** Password otomatik olarak doğru encode edilmiş olacaktır.

### 4. Alternatif: Connection Pooling Kullanın

Eğer direkt connection çalışmazsa, **Session mode** (port 6543) connection string'i deneyin:

```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

### 5. Migration'ı Tekrar Çalıştırın

```bash
npm run db:migrate
```

VEYA

```bash
npx prisma db push
```

## Notlar

- Password'taki özel karakterler (`+`, `@`, `#`, vb.) Supabase dashboard'dan alınan connection string'de otomatik olarak encode edilir
- Eğer hala bağlanamıyorsanız, Supabase dashboard'da **Settings > Database > Network restrictions** bölümünden IP whitelist ayarlarını kontrol edin
- Bazı durumlarda Supabase'in **Connection pooling** özelliğini kullanmanız gerekebilir

