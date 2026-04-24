# Supabase Bağlantı Sorunu Çözümü

## Sorun
`Can't reach database server at db.[PROJECT].supabase.co:5432`

## Neden
Supabase **doğrudan bağlantı** (`db.*.supabase.co:5432`) çoğunlukla **IPv6** kullanır. **Vercel** ve birçok IPv4-only ortam bu hosta TCP ile ulaşamaz; Prisma da bu hatayı verir.

Resmi özet: [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — sunucusuz için **Transaction pooler** (port **6543**), kalıcı / migrate için **Session pooler** veya doğrudan bağlantı.

## Çözüm (Prisma + Vercel)

1. Dashboard’da projenizi açın → üstten **Connect** → **ORMs** / **Connection string**.
2. **`DATABASE_URL` (uygulama + Vercel):** **Transaction** modu, URI. Sonuna mutlaka **`pgbouncer=true`** ekleyin (Prisma, hazırlıklı ifadeleri kapatır). Örnek biçim:
   `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true&sslmode=require`
3. **`DIRECT_URL` (migrate / `db push` / introspection):** **Session** pooler (çoğu zaman `aws-0-[REGION].pooler.supabase.com:5432` ve kullanıcı `postgres.[PROJECT-REF]`) **veya** IPv6 erişiminiz varsa **Direct** `db.*:5432`. [Prisma + Supabase](https://supabase.com/docs/guides/database/prisma).
4. Bu repoda `prisma/schema.prisma` içinde `directUrl = env("DIRECT_URL")` tanımlıdır. **Vercel**’de hem `DATABASE_URL` hem `DIRECT_URL` ekleyin (Production). `DIRECT_URL` sadece build’de migrate kullanıyorsanız şarttır; yalnızca `prisma generate` için gerekmez ama şema alanı dolu olduğu için env’de bulunmalıdır.

### .env örneği

```env
DATABASE_URL="postgresql://...@db.[REF].supabase.co:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.[REF]:...@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require"
```

Şifreyi her zaman Dashboard’dan kopyalayın; özel karakterler orada encode edilir.

### Migration

```bash
npx prisma migrate dev
# veya
npx prisma db push
```

## Notlar

- **Network restrictions** açıksa Vercel çıkış IP’lerini whitelist etmek gerekebilir (nadir).
- IPv4 zorunluluğu için [IPv4 add-on](https://supabase.com/docs/guides/platform/ipv4-address) alternatifi de vardır; çoğu uygulama için pooler yeterlidir.

