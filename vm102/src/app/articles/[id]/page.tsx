import ArticleDetailClient from "./ArticleDetailClient";

export default async function ArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  return <ArticleDetailClient articleId={resolvedParams.id} />;
}
