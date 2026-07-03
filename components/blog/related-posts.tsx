import Link from "next/link"
import type { BlogPost } from "@/lib/content/blog"
import { postPath } from "@/lib/content/blog"

const toneClasses: Record<BlogPost["coverTone"], string> = {
  blue: "from-kobipo-blue/20 to-kobipo-pale",
  navy: "from-kobipo-navy/20 to-kobipo-light/50",
  green: "from-kobipo-green/20 to-kobipo-green-light",
}

/** Yazı detayında iç bağlantı (self-link) için ilgili yazı kartları. */
export function RelatedPosts({ posts }: { posts: BlogPost[] }) {
  if (posts.length === 0) return null

  return (
    <section aria-labelledby="ilgili-yazilar" className="mt-10">
      <h2 id="ilgili-yazilar" className="text-lg font-bold tracking-tight text-kobipo-navy">
        İlgili yazılar
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={postPath(post.slug)}
            className="group flex flex-col overflow-hidden rounded-2xl border border-kobipo-border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
          >
            {post.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.coverImageUrl} alt={post.title} className="h-24 w-full object-cover" />
            ) : (
              <div className={`h-20 bg-gradient-to-r ${toneClasses[post.coverTone]}`} />
            )}
            <div className="flex flex-1 flex-col p-4">
              <span className="w-fit rounded-full bg-kobipo-pale px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-kobipo-blue">
                {post.category}
              </span>
              <h3 className="mt-2 text-sm font-bold leading-snug text-kobipo-navy transition-colors group-hover:text-kobipo-blue">
                {post.title}
              </h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-kobipo-gray">{post.excerpt}</p>
              <span className="mt-3 text-xs font-semibold text-kobipo-blue">Yazıyı oku →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
