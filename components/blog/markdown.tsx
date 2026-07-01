import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSanitize from "rehype-sanitize"

/**
 * Blog gövdesi için güvenli markdown render'ı (react-markdown + GFM + sanitize).
 * Typography eklentisi olmadığından temel tipografi arbitrary-variant sınıflarıyla verilir.
 * Hem public detay sayfasında (server) hem editör önizlemesinde (client) kullanılır.
 */
export function Markdown({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div
      className={
        "text-[15px] leading-7 text-foreground/90 " +
        "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-foreground " +
        "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground " +
        "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground " +
        "[&_p]:my-3 " +
        "[&_a]:text-kobipo-blue [&_a]:underline " +
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 " +
        "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground " +
        "[&_img]:my-4 [&_img]:rounded-lg [&_img]:max-w-full " +
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm " +
        "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:text-sm [&_pre_code]:bg-transparent [&_pre_code]:text-slate-100 " +
        "[&_hr]:my-6 [&_hr]:border-border " +
        className
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
