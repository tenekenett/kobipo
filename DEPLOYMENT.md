# Deployment Guide - Vercel

Bu proje Vercel'e deploy edilmek üzere hazırlanmıştır.

## Ön Gereksinimler

1. Vercel hesabı
2. PostgreSQL veritabanı (Vercel Postgres, Supabase, Neon, vb.)
3. GitHub/GitLab/Bitbucket repository

## Deployment Adımları

### 1. Veritabanı Kurulumu

#### Vercel Postgres Kullanıyorsanız:
1. Vercel dashboard'da projenize gidin
2. Storage sekmesinden "Create Database" > "Postgres" seçin
3. Veritabanı oluşturulduktan sonra connection string'i kopyalayın

#### Supabase/Neon Kullanıyorsanız:
1. Supabase veya Neon'da yeni bir proje oluşturun
2. Connection string'i kopyalayın

### 2. Environment Variables

Vercel dashboard'da projenize gidin ve şu environment variables'ları ekleyin:

```
DATABASE_URL=postgresql://user:password@host:port/database?schema=public
NEXTAUTH_URL=https://your-domain.vercel.app
NEXTAUTH_SECRET=your-secret-key-here (openssl rand -base64 32 ile oluşturabilirsiniz)
E_INVOICE_PROVIDER=mock (veya logo, turkcell, veriban)
```

### 3. GitHub Repository'ye Push

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 4. Vercel'e Deploy

1. [Vercel Dashboard](https://vercel.com/dashboard)'a gidin
2. "Add New Project" butonuna tıklayın
3. GitHub repository'nizi seçin
4. Framework Preset: Next.js
5. Root Directory: ./
6. Build Command: `npm run build`
7. Output Directory: `.next`
8. Install Command: `npm install`
9. Environment variables'ları ekleyin
10. "Deploy" butonuna tıklayın

### 5. Database Migrations

Deploy sonrası, Vercel'de bir terminal açın veya local'den çalıştırın:

```bash
npx prisma migrate deploy
```

Veya Vercel'in build command'ına ekleyebilirsiniz:

```json
{
  "scripts": {
    "build": "prisma generate && prisma migrate deploy && next build"
  }
}
```

### 6. Prisma Studio (Opsiyonel)

Production veritabanını incelemek için:

```bash
npx prisma studio
```

## Production Optimizations

### 1. Environment Variables

Production'da mutlaka şunları ayarlayın:
- `NODE_ENV=production`
- `NEXTAUTH_SECRET` güçlü bir secret key
- `DATABASE_URL` production veritabanı connection string'i

### 2. Database Connection Pooling

Vercel Postgres otomatik olarak connection pooling sağlar. Diğer sağlayıcılar için:
- Supabase: Connection pooling otomatik
- Neon: Connection pooling otomatik

### 3. Build Optimizations

`next.config.js` dosyasında production optimizations zaten aktif.

## Troubleshooting

### Database Connection Errors

- Connection string'in doğru olduğundan emin olun
- SSL gerekiyorsa `?sslmode=require` ekleyin
- Firewall ayarlarını kontrol edin

### Build Errors

- `prisma generate` komutunun çalıştığından emin olun
- Node.js versiyonunun uyumlu olduğundan emin olun (18.x veya üzeri)

### Authentication Errors

- `NEXTAUTH_URL` environment variable'ının doğru olduğundan emin olun
- `NEXTAUTH_SECRET` set edilmiş olmalı

## Monitoring

Vercel dashboard'da:
- Function logs
- Analytics
- Real-time metrics

ile sisteminizi izleyebilirsiniz.

