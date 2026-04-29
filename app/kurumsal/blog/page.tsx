import Link from "next/link"
import { CorporatePageShell } from "@/components/site/corporate-page-shell"
import { blogCategories, blogPosts } from "@/lib/content/blog"

const toneClasses = {
  blue: "from-kobipo-blue/20 to-kobipo-pale",
  navy: "from-kobipo-navy/20 to-kobipo-light/50",
  green: "from-kobipo-green/20 to-kobipo-green-light",
}

export default function BlogPage() {
  return (
    <CorporatePageShell
      badge="Blog"
      title="Kobipo Blog"
      description="KOBI finansi, e-donusum ve operasyon yonetimi hakkinda ekiplerinizin hizla uygulayabilecegi pratik icerikler."
    >
      <section className="rounded-2xl border border-kobipo-border bg-white p-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-kobipo-gray">Kategoriler</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {blogCategories.map((category) => (
            <span
              key={category}
              className="rounded-full border border-kobipo-border bg-kobipo-offwhite px-3 py-1 text-xs font-semibold text-kobipo-gray"
            >
              {category}
            </span>
          ))}
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {blogPosts.map((post) => (
          <article
            key={post.slug}
            className="overflow-hidden rounded-2xl border border-kobipo-border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
          >
            <div className={`h-24 bg-gradient-to-r ${toneClasses[post.coverTone]}`} />
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
                  href={`/kurumsal/blog/${post.slug}`}
                  className="text-sm font-semibold text-kobipo-blue transition-colors hover:text-kobipo-mid"
                >
                  Yaziyi oku
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </CorporatePageShell>
  )
}
