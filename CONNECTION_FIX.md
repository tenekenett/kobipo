# Supabase Bağlantı Sorunu Çözümü

## Sorun
`Can't reach database server at db.[PROJECT].supabase.co:5432` **veya** `...:6543`

## Neden
- **5432 + `db.*.supabase.co`:** doğrudan Postgres; çoğu ortamda **IPv6** beklentisi — **Vercel** sık sık buraya IPv4 ile ulaşamaz.
- **6543 + `db.*.supabase.co`:** dokümantasyonda örnek görünse bile bazı ağlardan (özellikle Vercel) yine **TCP erişimi olmayabilir**. Supabase panelinin ürettiği **paylaşımlı pooler** adresi farklıdır.

Resmi özet: [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — sunucusuz için **Transaction pooler**; [Prisma + Supabase](https://supabase.com/docs/guides/database/prisma).

## Çözüm (Prisma + Vercel)

1. Dashboard → proje → üstte **Connect** → **Connection string** (veya **ORMs / Prisma**).
2. **`DATABASE_URL`:** **Transaction** modunu seçin ve gösterilen **URI’yi hiç ellemeden kopyalayın**. Host'un nesli ve bölgesi projeye göre değişir:
   - `aws-0-<REGION>.pooler.supabase.com` **veya** `aws-1-<REGION>.pooler.supabase.com` ve port **`6543`**
   - Bölge **mutlaka projenizin gerçek bölgesi** olmalı (ör. `ap-northeast-1`, `eu-central-1`). Yanlış bölgedeki pooler kiracıyı tanımaz → **`FATAL: Tenant or user not found`**.
   - Kullanıcı adı çoğu zaman **`postgres.<PROJECT-REF>`** (`postgres` tek başına değil).
3. Sona Prisma için **`?pgbouncer=true&connection_limit=1`** ekleyin (panelde yoksa). Örnek: `.../postgres?pgbouncer=true&connection_limit=1&sslmode=require&connect_timeout=30`
4. **`DIRECT_URL`:** **Session** pooler URI (aynı Connect ekranından, port **5432**, aynı `aws-*-<REGION>.pooler...` host) veya migrate’i sadece lokalden yapıyorsanız uygun doğrudan / session string. [Prisma + Supabase](https://supabase.com/docs/guides/database/prisma).
5. `prisma/schema.prisma` içinde `directUrl = env("DIRECT_URL")` olduğu için **Vercel Production**’da `DIRECT_URL` de tanımlı olmalı (şema bunu ister).

### .env örneği (bu projenin gerçek bölgesi: `ap-northeast-1`)

```env
DATABASE_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require&connect_timeout=30"
DIRECT_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
```

**`db.[REF].supabase.co:6543`** ile Vercel’de hâlâ “can’t reach” alıyorsanız, **`DATABASE_URL`’i mutlaka paneldeki `aws-*-<REGION>.pooler...:6543` string ile değiştirin.**

## `FATAL: Tenant or user not found`

Paylaşımlı pooler (`*.pooler.supabase.com`) kullanıcı adını **kiracı (tenant)** olarak bekler. **`postgres`** yeterli değildir.

- Doğru kullanıcı: **`postgres.<PROJECT-REF>`** (ör. `postgres.ueftuxhtdfckhureqccy`).
- **Connect → Transaction** (veya Session) URI’yi panelden kopyalarsanız bu format genelde zaten doğru gelir; elle `postgres:` yazmayın.
- Şifrede `@`, `#`, `:` vb. varsa tam URI’yi panelden kopyalayın (URL-encode edilmiş olur).

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

