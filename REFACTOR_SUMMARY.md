# Refactor Özeti - Supabase ve Vercel CLI Entegrasyonu

Bu dokümantasyon, projenin Supabase ve Vercel CLI kullanacak şekilde refactor edilmesini özetler.

## Yapılan Değişiklikler

### 1. Supabase CLI Yapılandırması ✅

- **`supabase/config.toml`**: Supabase CLI yapılandırma dosyası oluşturuldu
- **`supabase/migrations/`**: Migration dosyaları için klasör oluşturuldu
- **`supabase/migrations/20240101000000_initial_schema.sql`**: İlk migration dosyası oluşturuldu
  - Tüm tablolar ve ilişkiler
  - Index'ler
  - Foreign key'ler
  - Updated_at trigger'ları

### 2. Vercel CLI Yapılandırması ✅

- **`vercel.json`**: Environment variables referansları eklendi
- Vercel CLI komutları package.json'a eklendi

### 3. Package.json Güncellemeleri ✅

#### Yeni Scripts:

**Supabase CLI:**
- `supabase:start` - Local Supabase başlat
- `supabase:stop` - Local Supabase durdur
- `supabase:status` - Supabase durumunu kontrol et
- `supabase:link` - Projeyi Supabase'e bağla
- `supabase:db:push` - Migration'ları Supabase'e push et
- `supabase:db:reset` - Database'i reset et
- `supabase:db:diff` - Database değişikliklerini göster
- `supabase:migration:new` - Yeni migration oluştur
- `supabase:gen:types` - TypeScript tiplerini generate et (linked)
- `supabase:gen:types:local` - TypeScript tiplerini generate et (local)

**Vercel CLI:**
- `vercel:dev` - Vercel development modu
- `vercel:deploy` - Preview deploy
- `vercel:prod` - Production deploy
- `vercel:env:pull` - Environment variables'ları çek
- `vercel:env:push` - Environment variables'ları push et

**Sync Scripts:**
- `sync:prisma-to-supabase` - Prisma migration'ı Supabase migration'a dönüştür

#### Yeni Dependencies:

- `supabase`: ^1.200.0 (devDependency)
- `vercel`: ^37.0.0 (devDependency)

#### Build Script Güncellemesi:

- `build`: Prisma generate'i build öncesi çalıştırır

### 4. Environment Variables ✅

- **`.env.example`**: Tüm gerekli environment variables için örnek dosya
  - Supabase configuration
  - NextAuth configuration
  - E-Fatura provider

### 5. Dokümantasyon ✅

- **`SETUP_CLI.md`**: Kapsamlı CLI tabanlı kurulum rehberi
  - Supabase kurulumu
  - Vercel kurulumu
  - Migration yönetimi
  - Development workflow
  - Production deployment

- **`README.md`**: Güncellenmiş ana README
  - CLI tabanlı kurulum vurgusu
  - Tüm komutların listesi
  - Proje yapısı
  - Hızlı başlangıç rehberi

### 6. Yardımcı Scripts ✅

- **`scripts/sync-prisma-to-supabase.js`**: Prisma migration'larını Supabase migration formatına dönüştüren script
  - En son Prisma migration'ı bulur
  - SQL'i Supabase formatına uyarlar
  - Yeni Supabase migration dosyası oluşturur

### 7. .gitignore Güncellemeleri ✅

- Supabase geçici dosyaları eklendi:
  - `supabase/.temp`
  - `supabase/.branches`
- `.env.example` dosyasının commit edilmesi için exception eklendi

## Kullanım Senaryoları

### Senaryo 1: Yeni Proje Kurulumu

```bash
# 1. Bağımlılıkları yükle
npm install

# 2. Supabase'e giriş yap ve projeyi bağla
npx supabase login
npx supabase link --project-ref [PROJECT-REF]

# 3. Environment variables'ı ayarla
cp .env.example .env
# .env dosyasını düzenle

# 4. Migration'ları çalıştır
npm run supabase:db:push

# 5. Development server'ı başlat
npm run dev
```

### Senaryo 2: Yeni Migration Oluşturma

**Prisma ile:**
```bash
# 1. Prisma schema'yı değiştir
# 2. Prisma migration oluştur
npm run db:migrate

# 3. Supabase migration'a dönüştür
npm run sync:prisma-to-supabase

# 4. Oluşturulan migration'ı kontrol et ve düzenle
# 5. Supabase'e push et
npm run supabase:db:push
```

**Doğrudan Supabase ile:**
```bash
# 1. Yeni migration dosyası oluştur
npm run supabase:migration:new migration_name

# 2. SQL dosyasını düzenle
# 3. Migration'ı push et
npm run supabase:db:push
```

### Senaryo 3: Vercel'e Deploy

```bash
# 1. Vercel'e giriş yap
npx vercel login

# 2. İlk deploy (interaktif)
npx vercel

# 3. Environment variables'ı push et
npm run vercel:env:push

# 4. Production deploy
npm run vercel:prod
```

### Senaryo 4: Local Development (Supabase Local)

```bash
# 1. Local Supabase'i başlat (Docker gerekir)
npm run supabase:start

# 2. Migration'ları local'e uygula
npm run supabase:db:reset

# 3. TypeScript tiplerini generate et
npm run supabase:gen:types:local

# 4. Development server'ı başlat
npm run dev

# 5. İşiniz bitince durdur
npm run supabase:stop
```

## Önemli Notlar

1. **Prisma ve Supabase Senkronizasyonu**: 
   - Prisma migration yaptıktan sonra, aynı değişiklikleri Supabase migration olarak da oluşturmanız gerekir
   - `sync:prisma-to-supabase` script'i bu işlemi kolaylaştırır, ancak her zaman kontrol edin

2. **Environment Variables**:
   - Development için `.env` dosyası kullanılır
   - Production için Vercel Dashboard veya CLI ile environment variables ayarlanır

3. **Migration Yönetimi**:
   - Supabase migration'ları `supabase/migrations/` klasöründe tutulur
   - Prisma migration'ları `prisma/migrations/` klasöründe tutulur
   - Her iki migration sistemi de senkronize tutulmalıdır

4. **TypeScript Tipleri**:
   - Supabase veritabanı şemasından TypeScript tipleri generate edilebilir
   - `npm run supabase:gen:types` komutu ile `types/supabase.ts` dosyası oluşturulur

5. **Local vs Remote**:
   - Local development için `supabase:start` kullanılabilir (Docker gerekir)
   - Remote Supabase projesi için `supabase:link` kullanılır

## Sonraki Adımlar

1. ✅ Supabase CLI kurulumu tamamlandı
2. ✅ Vercel CLI kurulumu tamamlandı
3. ✅ Migration sistemi kuruldu
4. ✅ Dokümantasyon güncellendi
5. ⏳ Proje test edilmeli
6. ⏳ Production'a deploy edilmeli

## Sorun Giderme

### Supabase Bağlantı Sorunu

```bash
# Projeyi yeniden bağla
npx supabase link --project-ref [PROJECT-REF]

# Connection string'i kontrol et
# Supabase Dashboard > Settings > Database > Connection string
```

### Migration Sorunları

```bash
# Database'i reset et (DİKKAT: Veriler silinir!)
npm run supabase:db:reset

# Migration'ları tekrar push et
npm run supabase:db:push
```

### Vercel Deploy Sorunları

```bash
# Environment variables'ı kontrol et
npm run vercel:env:pull

# Build loglarını kontrol et
# Vercel Dashboard > Deployments > [Deployment] > Build Logs
```

## Kaynaklar

- [Supabase CLI Dokümantasyonu](https://supabase.com/docs/reference/cli)
- [Vercel CLI Dokümantasyonu](https://vercel.com/docs/cli)
- [Prisma Dokümantasyonu](https://www.prisma.io/docs)
- [SETUP_CLI.md](./SETUP_CLI.md) - Detaylı kurulum rehberi

