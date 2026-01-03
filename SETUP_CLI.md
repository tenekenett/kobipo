# CLI Tabanlı Kurulum Rehberi

Bu proje Supabase ve Vercel CLI kullanarak tamamen CLI tabanlı çalışacak şekilde yapılandırılmıştır.

## Ön Gereksinimler

1. **Node.js** (v18 veya üzeri)
2. **Supabase CLI** (npm ile kurulacak)
3. **Vercel CLI** (npm ile kurulacak)
4. **Git**

## 1. Projeyi Klonlayın ve Bağımlılıkları Yükleyin

```bash
# Bağımlılıkları yükleyin (Supabase ve Vercel CLI dahil)
npm install
```

## 2. Supabase Kurulumu

### 2.1. Supabase CLI ile Giriş Yapın

```bash
# Supabase hesabınıza giriş yapın
npx supabase login
```

Bu komut tarayıcınızı açacak ve Supabase hesabınıza giriş yapmanızı isteyecektir.

### 2.2. Supabase Projesi Oluşturun

Supabase Dashboard'dan yeni bir proje oluşturun:
1. https://supabase.com/dashboard adresine gidin
2. "New Project" butonuna tıklayın
3. Proje bilgilerini doldurun ve oluşturun
4. Proje oluşturulduktan sonra **Project Reference** (örn: `swjalhvznztdmdyaspgz`) değerini not edin

### 2.3. Projeyi Supabase'e Bağlayın (Link)

```bash
# Projenizi Supabase projesine bağlayın
# [PROJECT-REF] yerine Supabase dashboard'dan aldığınız Project Reference'i yazın
npx supabase link --project-ref [PROJECT-REF]
```

Örnek:
```bash
npx supabase link --project-ref swjalhvznztdmdyaspgz
```

Bu komut `supabase/.temp/project-ref` dosyasını oluşturacak ve projenizi Supabase'e bağlayacaktır.

### 2.4. Environment Variables'ı Ayarlayın

```bash
# .env.example dosyasını kopyalayın
cp .env.example .env
```

Ardından `.env` dosyasını düzenleyin ve Supabase dashboard'dan aldığınız değerleri girin:

1. **Supabase Dashboard** > **Settings** > **API** bölümüne gidin
2. Şu değerleri kopyalayın:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

3. **Settings** > **Database** bölümüne gidin
4. **Connection string** sekmesinden **Transaction mode** connection string'i kopyalayın
5. Bu connection string'i `.env` dosyasındaki `DATABASE_URL` değerine yapıştırın

### 2.5. Database Migration'ları Çalıştırın

```bash
# Migration'ları Supabase'e push edin
npm run supabase:db:push
```

VEYA

```bash
# Migration'ları manuel olarak çalıştırın
npx supabase db push
```

Bu komut `supabase/migrations/` klasöründeki tüm migration dosyalarını Supabase veritabanınıza uygulayacaktır.

### 2.6. (Opsiyonel) Local Development için Supabase Başlatın

Eğer local development için Supabase kullanmak isterseniz:

```bash
# Local Supabase'i başlatın (Docker gerektirir)
npm run supabase:start

# Local Supabase durumunu kontrol edin
npm run supabase:status

# Local Supabase'i durdurun
npm run supabase:stop
```

## 3. Vercel Kurulumu

### 3.1. Vercel CLI ile Giriş Yapın

```bash
# Vercel hesabınıza giriş yapın
npx vercel login
```

### 3.2. Vercel Projesi Oluşturun ve Deploy Edin

```bash
# İlk deploy (interaktif)
npx vercel

# Production deploy
npm run vercel:prod
```

VEYA

```bash
# Development modunda çalıştırın (local'de Vercel ortamını simüle eder)
npm run vercel:dev
```

### 3.3. Environment Variables'ı Vercel'e Aktarın

```bash
# Local .env dosyasındaki değişkenleri Vercel'e push edin
npm run vercel:env:push
```

VEYA Vercel Dashboard'dan manuel olarak ekleyin:
1. Vercel Dashboard > Projeniz > Settings > Environment Variables
2. `.env.example` dosyasındaki tüm değişkenleri ekleyin

### 3.4. Vercel'den Environment Variables'ı Çekin

```bash
# Vercel'deki environment variables'ları local .env.local dosyasına çekin
npm run vercel:env:pull
```

## 4. Development

### 4.1. Development Server'ı Başlatın

```bash
# Next.js development server
npm run dev
```

### 4.2. Prisma Client'ı Generate Edin

```bash
# Prisma client'ı generate edin (schema değişikliklerinden sonra)
npm run db:generate
```

### 4.3. Prisma Studio'yu Açın (Opsiyonel)

```bash
# Veritabanını görselleştirmek için
npm run db:studio
```

## 5. Yeni Migration Oluşturma

### 5.1. Supabase Migration Oluşturma

```bash
# Yeni bir migration dosyası oluşturun
npm run supabase:migration:new migration_name
```

VEYA

```bash
npx supabase migration new migration_name
```

Bu komut `supabase/migrations/` klasöründe timestamp'li bir SQL dosyası oluşturur.

### 5.2. Prisma Schema'dan Migration Oluşturma

```bash
# Prisma schema değişikliklerinden migration oluşturun
npm run db:migrate
```

**ÖNEMLİ:** Prisma migration'ları ve Supabase migration'ları senkronize tutmanız gerekir. Prisma migration yaptıktan sonra, aynı değişiklikleri Supabase migration olarak da oluşturmanız gerekebilir.

## 6. Production Deployment

### 6.1. Build ve Deploy

```bash
# Production build
npm run build

# Production deploy
npm run vercel:prod
```

### 6.2. Migration'ları Production'a Uygulama

Production'a deploy ettikten sonra, migration'ları production veritabanına uygulayın:

```bash
# Production migration (Supabase CLI ile)
npx supabase db push --db-url $DATABASE_URL
```

VEYA Supabase Dashboard'dan SQL Editor ile migration dosyalarını çalıştırın.

## 7. Faydalı Komutlar

### Supabase Komutları

```bash
# Supabase durumunu kontrol et
npm run supabase:status

# Database'i reset et (DİKKAT: Tüm verileri siler!)
npm run supabase:db:reset

# Database değişikliklerini diff olarak göster
npm run supabase:db:diff

# TypeScript tiplerini generate et
npm run supabase:gen:types
```

### Vercel Komutları

```bash
# Development modunda çalıştır
npm run vercel:dev

# Preview deploy
npm run vercel:deploy

# Production deploy
npm run vercel:prod

# Environment variables'ları pull et
npm run vercel:env:pull

# Environment variables'ları push et
npm run vercel:env:push
```

## Sorun Giderme

### Supabase Bağlantı Sorunu

Eğer Supabase'e bağlanamıyorsanız:

1. `.env` dosyasındaki `DATABASE_URL` değerini kontrol edin
2. Supabase Dashboard > Settings > Database > Connection string'den Transaction mode connection string'i kopyalayın
3. Password'u doğru encode ettiğinizden emin olun

### Migration Sorunları

Eğer migration'lar çalışmıyorsa:

1. Migration dosyalarının `supabase/migrations/` klasöründe olduğundan emin olun
2. Migration dosya isimlerinin timestamp formatında olduğundan emin olun (örn: `20240101000000_name.sql`)
3. SQL syntax'ını kontrol edin

### Vercel Deploy Sorunları

Eğer Vercel'e deploy edemiyorsanız:

1. Environment variables'ların Vercel'de ayarlandığından emin olun
2. Build loglarını kontrol edin
3. `vercel.json` dosyasının doğru yapılandırıldığından emin olun

## İleri Seviye

### Local Supabase ile Development

Local Supabase kullanmak için Docker kurulu olmalıdır:

```bash
# Local Supabase'i başlat
npm run supabase:start

# Local Supabase'e migration'ları uygula
npx supabase db reset

# Local Supabase'i durdur
npm run supabase:stop
```

### TypeScript Tiplerini Generate Etme

Supabase veritabanı şemasından TypeScript tiplerini generate edin:

```bash
npm run supabase:gen:types
```

Bu komut `types/supabase.ts` dosyasını oluşturur/günceller.

