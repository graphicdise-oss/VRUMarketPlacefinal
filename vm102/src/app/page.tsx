import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import HeroSlider from "@/components/home/HeroSlider";
import CategoryMenu from "@/components/home/CategoryMenu";
import CouponBannerSection from "@/components/home/CouponBannerSection";
import ProductGrid from "@/components/home/ProductGrid";
import ArticleSection from "@/components/home/ArticleSection";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col selection:bg-[#16A085]/30 selection:text-[#16A085]">
      <Header />
      
      {/* Hero & Categories Section with Soft Gradient Background */}
      <div className="relative overflow-x-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#D4F1BB]/20 via-white to-gray-50/50 pointer-events-none -z-10 h-[800px]"></div>
        
        {/* Decorative Elements */}
        <div className="absolute top-20 left-0 w-64 h-64 bg-[#16A085]/5 rounded-full blur-3xl pointer-events-none -z-10"></div>
        <div className="absolute top-40 right-0 w-96 h-96 bg-[#D4F1BB]/20 rounded-full blur-3xl pointer-events-none -z-10"></div>

        <main className="flex-grow">
          {/* Full-width Hero Slider container */}
          <section className="w-full">
            <HeroSlider />
          </section>

          {/* Centered Content */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 sm:mt-10 relative z-20">
            <CategoryMenu />
            
            <CouponBannerSection />

            <div className="mt-12 md:mt-20">
              <ProductGrid />
            </div>
          </div>
        </main>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full mt-10 md:mt-16 mb-20">
        <ArticleSection />
      </div>

      <Footer />
      <MobileNav />
    </div>
  );
}