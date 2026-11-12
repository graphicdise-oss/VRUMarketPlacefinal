export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  showBackButton?: boolean;
  fallbackHref?: string;
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  void items;
  return null;
}
