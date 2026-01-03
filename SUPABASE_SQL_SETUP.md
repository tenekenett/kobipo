# Supabase SQL Editor ile Veritabanı Kurulumu

## Adımlar

1. **Supabase Dashboard'a gidin**
   - https://supabase.com/dashboard
   - Projenizi seçin

2. **SQL Editor'ı açın**
   - Sol menüden **SQL Editor** seçin
   - **New query** butonuna tıklayın

3. **SQL Dosyasını Kopyalayın**
   - Bu projedeki `migration.sql` dosyasını açın
   - Tüm içeriği kopyalayın (Ctrl+A, Ctrl+C)

4. **SQL'i Çalıştırın**
   - Supabase SQL Editor'a yapıştırın (Ctrl+V)
   - **Run** butonuna tıklayın
   - Başarılı mesajını bekleyin

5. **Doğrulama**
   - Sol menüden **Table Editor** seçin
   - Tabloların oluşturulduğunu kontrol edin:
     - users
     - companies
     - customers
     - suppliers
     - products
     - financial_accounts
     - transactions
     - invoices
     - vb.

## Sonraki Adımlar

SQL çalıştırdıktan sonra:

```bash
# Prisma client'ı generate edin
npm run db:generate

# Development server'ı başlatın
npm run dev
```

## Not

Bu yöntem migration geçmişi oluşturmaz, sadece tabloları oluşturur. 
İleride migration yapmak isterseniz, Supabase'den Transaction mode connection string'i almanız gerekir.

