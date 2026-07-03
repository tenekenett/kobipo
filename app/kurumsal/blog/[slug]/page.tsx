import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { Markdown } from "@/components/blog/markdown"
import { RelatedPosts } from "@/components/blog/related-posts"
import { JsonLd } from "@/components/seo/json-ld"
import { articleJsonLd } from "@/lib/seo/structured-data"
import { pageMetadata } from "@/lib/seo/metadata"
import {
  getBlogPostBySlug,
  getPublishedPosts,
  getRelatedPosts,
  postPath,
  categoryPath,
} from "@/lib/content/blog"

// Yeni yazılar/güncellemeler için ISR — slug'lar on-demand oluşturulup önbelleğe alınır.
export const revalidate = 60

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  try {
    const posts = await getPublishedPosts()
    return posts.map((post) => ({ slug: post.slug }))
  } catch {
    return []
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPostBySlug(slug)
  if (!post) {
    return { title: "Yazı bulunamadı", robots: { index: false, follow: false } }
  }
  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: postPath(slug),
    type: "article",
    publishedTime: post.isoDate,
    authors: [post.author],
    section: post.category,
    images: post.coverImageUrl ? [{ url: post.coverImageUrl, alt: post.title }] : undefined,
  })
}

export default async function BlogDetailPage({ params }: Props) {
  const { slug } = await params
  const post = await getBlogPostBySlug(slug)
  if (!post) notFound()

  const related = await getRelatedPosts(slug, post.category, 3)

  return (
    <CorporatePageShell
      badge={`Blog · ${post.category}`}
      title={post.title}
      description={post.excerpt}
      breadcrumbs={[
        { label: "Ana Sayfa", href: "/" },
        { label: "Blog", href: "/kurumsal/blog" },
        { label: post.category, href: categoryPath(post.category) },
        { label: post.title },
      ]}
      cta={{
        title: "Ekibinizle Kobipo'yu deneyin",
        description: "Blogda anlattığımız finans akışlarını tek panelde hayata geçirin.",
        primaryLabel: "Ücretsiz Başla",
        primaryHref: "/signup",
        secondaryLabel: "Tüm Yazılar",
        secondaryHref: "/kurumsal/blog",
      }}
    >
      <JsonLd data={articleJsonLd(post, postPath(slug))} />

      <article className="rounded-2xl border border-kobipo-border bg-white p-6 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-kobipo-gray">
          <Link
            href={categoryPath(post.category)}
            className="rounded-full bg-kobipo-pale px-2.5 py-0.5 font-semibold text-kobipo-blue transition-colors hover:bg-kobipo-blue hover:text-white"
          >
            {post.category}
          </Link>
          <span>·</span>
          <span>{post.readTime}</span>
          <span>·</span>
          <span>{post.date}</span>
          <span>·</span>
          <span>{post.author}</span>
        </div>

        {post.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt={post.title}
            className="mb-6 aspect-video w-full rounded-xl object-cover"
          />
        )}

        <Markdown content={post.body} />

        <div className="mt-8 border-t border-kobipo-border pt-5">
          <Link href="/kurumsal/blog" className="text-sm font-semibold text-kobipo-blue hover:text-kobipo-mid">
            ← Tüm yazılara dön
          </Link>
        </div>
      </article>

      <RelatedPosts posts={related} />
    </CorporatePageShell>
  )
}
