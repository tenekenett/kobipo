import { BlogPostEditor } from "@/components/blog-admin/blog-post-editor"

export default async function EditBlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <BlogPostEditor postId={id} />
}
