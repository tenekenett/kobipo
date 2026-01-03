# Ön Muhasebe SaaS Platformu

Bulut tabanlı ön muhasebe SaaS platformu - Next.js 14, Supabase ve Vercel ile geliştirilmiştir.

## 🚀 Teknoloji Yığını

- **Framework**: Next.js 14+ (App Router)
- **Veritabanı**: PostgreSQL (Supabase)
- **ORM**: Prisma
- **Authentication**: NextAuth.js
- **UI**: Tailwind CSS + shadcn/ui
- **Deployment**: Vercel
- **CLI Tools**: Supabase CLI, Vercel CLI

## 📋 Ön Gereksinimler

- Node.js v18 veya üzeri
- npm veya yarn
- Supabase hesabı
- Vercel hesabı
- Git

## ⚡ Hızlı Başlangıç

### 1. Projeyi Klonlayın

```bash
git clone <repository-url>
cd saas
```

### 2. Bağımlılıkları Yükleyin

```bash
npm install
```

Bu komut Supabase CLI ve Vercel CLI'yi de otomatik olarak yükler.

### 3. Supabase Kurulumu

```bash
# Supabase'e giriş yapın
npx supabase login

# Projenizi Supabase projesine bağlayın
npx supabase link --project-ref [YOUR-PROJECT-REF]

# Environment variables'ı ayarlayın
cp .env.example .env
# .env dosyasını düzenleyin ve Supabase değerlerini girin

# Migration'ları çalıştırın
npm run supabase:db:push
```

Detaylı kurulum için [SETUP_CLI.md](./SETUP_CLI.md) dosyasına bakın.

### 4. Development Server'ı Başlatın

```bash
npm run dev
```

Tarayıcıda `http://localhost:3000` adresine gidin.

## 📚 Kullanılabilir Komutlar

### Development

```bash
npm run dev          # Development server başlat
npm run build        # Production build
npm run start        # Production server başlat
npm run lint         # ESLint çalıştır
```

### Database (Prisma)

```bash
npm run db:generate  # Prisma client generate et
npm run db:push      # Schema'yı veritabanına push et
npm run db:migrate   # Migration oluştur ve uygula
npm run db:studio    # Prisma Studio'yu aç
```

### Supabase CLI

```bash
npm run supabase:start          # Local Supabase başlat (Docker gerekir)
npm run supabase:stop           # Local Supabase durdur
npm run supabase:status         # Supabase durumunu kontrol et
npm run supabase:link           # Projeyi Supabase'e bağla
npm run supabase:db:push        # Migration'ları Supabase'e push et
npm run supabase:db:reset       # Database'i reset et
npm run supabase:db:diff        # Database değişikliklerini göster
npm run supabase:migration:new  # Yeni migration oluştur
npm run supabase:gen:types      # TypeScript tiplerini generate et
```

### Vercel CLI

```bash
npm run vercel:dev      # Vercel development modu
npm run vercel:deploy   # Preview deploy
npm run vercel:prod     # Production deploy
npm run vercel:env:pull # Environment variables'ları çek
npm run vercel:env:push # Environment variables'ları push et
```

## 📁 Proje Yapısı

```
saas/
├── app/                    # Next.js App Router sayfaları ve route'ları
│   ├── (auth)/            # Authentication sayfaları
│   ├── (dashboard)/       # Dashboard sayfaları
│   └── api/               # API route'ları
├── components/            # React bileşenleri
│   ├── dashboard/         # Dashboard bileşenleri
│   └── ui/                # UI bileşenleri (shadcn/ui)
├── lib/                   # Yardımcı fonksiyonlar ve utilities
│   ├── auth/              # Authentication yapılandırması
│   ├── db/                # Database bağlantıları
│   └── integrations/      # Harici entegrasyonlar
├── prisma/                # Prisma schema ve migrations
│   └── schema.prisma      # Prisma schema dosyası
├── supabase/              # Supabase yapılandırması
│   ├── config.toml        # Supabase CLI yapılandırması
│   └── migrations/        # Supabase migration dosyaları
├── types/                 # TypeScript type tanımları
├── .env.example           # Environment variables örneği
├── vercel.json            # Vercel yapılandırması
└── package.json           # NPM bağımlılıkları ve scriptler
```

## 🔧 Yapılandırma

### Environment Variables

`.env.example` dosyasını kopyalayarak `.env` dosyası oluşturun ve aşağıdaki değerleri doldurun:

- `DATABASE_URL`: Supabase database connection string
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `NEXTAUTH_URL`: NextAuth URL (development: http://localhost:3000)
- `NEXTAUTH_SECRET`: NextAuth secret key
- `E_INVOICE_PROVIDER`: E-Fatura provider (mock, logo, turkcell, veriban)

### Supabase Yapılandırması

Supabase CLI yapılandırması `supabase/config.toml` dosyasında bulunur. Bu dosyayı genellikle değiştirmenize gerek yoktur.

### Vercel Yapılandırması

Vercel yapılandırması `vercel.json` dosyasında bulunur. Environment variables Vercel Dashboard'dan veya CLI ile yönetilir.

## 📦 Modüller

### Faz 1 (MVP)
- ✅ Yönetim ve Kullanıcı Modülü
- ✅ Cari Hesap Modülü
- ✅ E-Dönüşüm Modülü
- ✅ Temel Stok ve Hizmet Modülü
- ✅ Temel Finans Modülü
- ✅ Temel Raporlama Modülü

## 🚢 Deployment

### Vercel'e Deploy

```bash
# İlk deploy
npx vercel

# Production deploy
npm run vercel:prod
```

Detaylı deployment rehberi için [SETUP_CLI.md](./SETUP_CLI.md) dosyasına bakın.

## 📖 Dokümantasyon

- [SETUP_CLI.md](./SETUP_CLI.md) - CLI tabanlı kurulum rehberi
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment rehberi (eski)
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) - Supabase kurulum rehberi (eski)

## 🤝 Katkıda Bulunma

1. Fork edin
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Değişikliklerinizi commit edin (`git commit -m 'Add some amazing feature'`)
4. Branch'inizi push edin (`git push origin feature/amazing-feature`)
5. Pull Request oluşturun

## 📝 Lisans

Bu proje özel bir projedir.

## 🔗 Faydalı Linkler

- [Next.js Dokümantasyonu](https://nextjs.org/docs)
- [Supabase Dokümantasyonu](https://supabase.com/docs)
- [Vercel Dokümantasyonu](https://vercel.com/docs)
- [Prisma Dokümantasyonu](https://www.prisma.io/docs)
- [NextAuth.js Dokümantasyonu](https://next-auth.js.org)
