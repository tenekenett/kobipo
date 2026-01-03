# Supabase Kurulum Rehberi

## 1. Supabase Connection String Alma

Supabase dashboard'unuzda:

1. **Settings** > **Database** bölümüne gidin
2. **Connection string** sekmesine tıklayın
3. **URI** formatını seçin
4. Connection string'i kopyalayın

Format şu şekilde olacak:
```
postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**ÖNEMLİ:** 
- Prisma migrations için **Transaction mode (port 5432)** kullanın
- Uygulama için **Session mode (port 6543) veya Transaction mode** kullanabilirsiniz
- Production için **Connection Pooling (port 6543)** önerilir

## 2. Environment Variables

`.env` dosyası oluşturun ve şu değişkenleri ekleyin:

```env
# Supabase Database Connection
# Transaction mode (migrations için)
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# Veya Connection Pooling (production için önerilen)
# DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here" # openssl rand -base64 32 ile oluşturabilirsiniz

# E-Fatura Integration (opsiyonel)
E_INVOICE_PROVIDER="mock"
```

## 3. Database Password

Eğer database password'unuzu bilmiyorsanız:
1. Supabase Dashboard > Settings > Database
2. "Reset database password" butonuna tıklayın
3. Yeni password'u kaydedin ve connection string'e ekleyin

## 4. Prisma Migration

Connection string'i ayarladıktan sonra:

```bash
# Prisma client'ı generate edin
npm run db:generate

# Migration'ları çalıştırın
npm run db:migrate
```

**Not:** Supabase'de migration'lar için Transaction mode (port 5432) kullanmanız gerekebilir.

## 5. Connection Pooling (Production)

Production için connection pooling kullanmanız önerilir. Supabase otomatik olarak connection pooling sağlar.

Connection string formatı:
```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

## 6. Test Bağlantısı

Migration'lar başarılı olduktan sonra:

```bash
# Development server'ı başlatın
npm run dev
```

Tarayıcıda `http://localhost:3000` adresine gidin ve kayıt ol sayfasından test kullanıcısı oluşturun.

## Troubleshooting

### Connection Error
- Password'un doğru olduğundan emin olun
- Connection string'deki özel karakterleri URL encode edin
- Firewall ayarlarını kontrol edin (Supabase dashboard'da IP whitelist)

### Migration Error
- Transaction mode (port 5432) kullandığınızdan emin olun
- Database'in boş olduğundan emin olun
- Supabase dashboard'da SQL Editor'dan manuel olarak tabloları kontrol edin

### SSL Connection
Bazı durumlarda SSL gerektirebilir:
```
DATABASE_URL="postgresql://...?sslmode=require"
```

