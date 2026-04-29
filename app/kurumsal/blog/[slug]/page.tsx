import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { blogPosts, getBlogPostBySlug } from "@/lib/content/blog"

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = getBlogPostBySlug(slug)
  if (!post) {
    return { title: "Yazi bulunamadi | Kobipo" }
  }
  return {
    title: `${post.title} | Kobipo Blog`,
    description: post.excerpt,
  }
}

export default async function BlogDetailPage({ params }: Props) {
  const { slug } = await params
  const post = getBlogPostBySlug(slug)
  if (!post) notFound()

  return (
    <CorporatePageShell
      badge={`Blog · ${post.category}`}
      title={post.title}
      description={post.excerpt}
      cta={{
        title: "Ekibinizle Kobipo'yu deneyin",
        description: "Blogda anlattigimiz finans akislarini tek panelde hayata gecirin.",
        primaryLabel: "Ucretsiz Basla",
        primaryHref: "/signup",
        secondaryLabel: "Tum Yazilar",
        secondaryHref: "/kurumsal/blog",
      }}
    >
      <article className="rounded-2xl border border-kobipo-border bg-white p-6 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-kobipo-gray">
          <span className="rounded-full bg-kobipo-pale px-2.5 py-0.5 font-semibold text-kobipo-blue">{post.category}</span>
          <span>·</span>
          <span>{post.readTime}</span>
          <span>·</span>
          <span>{post.date}</span>
          <span>·</span>
          <span>{post.author}</span>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-kobipo-text sm:text-base">
          {post.content.map((paragraph, index) => (
            <p key={`${post.slug}-${index}`}>{paragraph}</p>
          ))}
        </div>

        <div className="mt-8 border-t border-kobipo-border pt-5">
          <Link href="/kurumsal/blog" className="text-sm font-semibold text-kobipo-blue hover:text-kobipo-mid">
            ← Tum yazilara don
          </Link>
        </div>
      </article>
    </CorporatePageShell>
  )
}
