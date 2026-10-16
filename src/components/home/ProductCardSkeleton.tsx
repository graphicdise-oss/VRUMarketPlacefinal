export default function ProductCardSkeleton() {
  return (
    <div className="product-card bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col relative animate-pulse">
      {/* Image Skeleton */}
      <div className="relative pt-[100%] bg-gray-200"></div>

      {/* Info Skeleton */}
      <div className="p-4 flex flex-col flex-grow bg-white">
        <div className="h-4 bg-gray-200 rounded-md w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded-md w-1/2 mb-4"></div>
        
        <div className="flex flex-col gap-2 mb-3">
          <div className="h-3 bg-gray-200 rounded-md w-2/3"></div>
          <div className="flex justify-between">
            <div className="h-3 bg-gray-200 rounded-md w-1/3"></div>
            <div className="h-3 bg-gray-200 rounded-md w-1/4"></div>
          </div>
        </div>

        {/* Price Skeleton */}
        <div className="mt-auto mb-4 border-t border-gray-50 pt-3">
          <div className="h-5 bg-gray-200 rounded-md w-1/3"></div>
        </div>

        {/* Actions Skeleton */}
        <div className="flex flex-col gap-2.5">
          <div className="h-9 bg-gray-200 rounded-full w-full"></div>
          <div className="h-9 bg-gray-200 rounded-full w-full"></div>
        </div>
      </div>
    </div>
  );
}
