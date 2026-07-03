import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { pageMetadata } from "@/lib/seo/metadata"
import { slugify } from "@/lib/blog/slug"
import {
  getBlogCategories,
  getCategoryBySlug,
  getPostsByCategory,
  categoryPath,
  postPath,
} from "@/lib/content/blog"

export const revalidate = 60

type Props = {
  params: Promise<{ slug: string }>
}

const toneClasses = {
  blue: "from-kobipo-blue/20 to-kobipo-pale",
  navy: "from-kobipo-navy/20 to-kobipo-light/50",
  green: "from-kobipo-green/20 to-kobipo-green-light",
}

export async function generateStaticParams() {
  try {
    const categories = await getBlogCategories()
    return categories.map((category) => ({ slug: slugify(category) }))
  } catch {
    return []
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  if (!category) {
    return { title: "Kategori bulunamadı", robots: { index: false, follow: false } }
  }
  return pageMetadata({
    title: `${category} yazıları`,
    description: `${category} kategorisindeki Kobipo blog yazıları — KOBİ finansı, e-dönüşüm ve işletme yönetimi için pratik içerikler.`,
    path: categoryPath(category),
  })
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  if (!category) notFound()

  const posts = await getPostsByCategory(category)

  return (
    <CorporatePageShell
      badge={`Kategori · ${category}`}
      title={category}
      description={`${category} kategorisindeki tüm Kobipo blog yazıları.`}
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Blog", href: "/kurumsal/blog" },
        { label: category },
      ]}
    >
      <div className="mb-6">
        <Link href="/kurumsal/blog" className="text-sm font-semibold text-kobipo-blue hover:text-kobipo-mid">
          ← Tüm yazılar
        </Link>
      </div>

      {posts.length === 0 ? (
        <p className="rounded-2xl border border-kobipo-border bg-white p-6 text-sm text-kobipo-gray">
          Bu kategoride henüz yayınlanmış yazı yok.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="overflow-hidden rounded-2xl border border-kobipo-border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
            >
              {post.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.coverImageUrl} alt={post.title} className="h-28 w-full object-cover" />
              ) : (
                <div className={`h-24 bg-gradient-to-r ${toneClasses[post.coverTone]}`} />
              )}
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-kobipo-pale px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-kobipo-blue">
                    {post.category}
                  </span>
                  <span className="text-xs text-kobipo-gray">{post.readTime}</span>
                </div>
                <h2 className="mt-3 text-lg font-bold leading-tight text-kobipo-navy">{post.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-kobipo-gray">{post.excerpt}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-kobipo-gray">
                    {post.author} · {post.date}
                  </span>
                  <Link
                    href={postPath(post.slug)}
                    className="text-sm font-semibold text-kobipo-blue transition-colors hover:text-kobipo-mid"
                  >
                    Yazıyı oku
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </CorporatePageShell>
  )
}
