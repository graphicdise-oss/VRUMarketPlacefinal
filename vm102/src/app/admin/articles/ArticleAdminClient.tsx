"use client";

import { useState, useEffect } from "react";
import { articleApi, Article, CreateArticleDto, UpdateArticleDto } from "@/lib/api-modules/article";
import { useToast } from "@/components/ui/Toast";

export default function ArticleAdminClient() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);

  const [formData, setFormData] = useState<CreateArticleDto>({
    title: "",
    category: "",
    image: "",
    authorName: "",
    excerpt: "",
    content: "",
    tags: [],
  });

  const loadArticles = async () => {
    setIsLoading(true);
    try {
      const { items } = await articleApi.list({ limit: 100 });
      setArticles(items);
    } catch (error) {
      console.error(error);
      showToast("ไม่สามารถโหลดข้อมูลบทความได้", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadArticles();
  }, []);

  const handleOpenModal = (article?: Article) => {
    if (article) {
      setEditingArticle(article);
      setFormData({
        title: article.title,
        category: article.category,
        image: article.image || "",
        authorName: article.authorName,
        excerpt: article.excerpt || "",
        content: article.content,
        tags: article.tags || [],
      });
    } else {
      setEditingArticle(null);
      setFormData({
        title: "",
        category: "ภูมิปัญญา", // Default
        image: "",
        authorName: "",
        excerpt: "",
        content: "",
        tags: [],
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingArticle(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content) {
      showToast("กรุณากรอกข้อมูลให้ครบถ้วน", "error");
      return;
    }

    setIsSaving(true);
    try {
      if (editingArticle) {
        await articleApi.update(editingArticle.id, formData);
        showToast("แก้ไขบทความสำเร็จ", "success");
      } else {
        await articleApi.create(formData);
        showToast("เพิ่มบทความสำเร็จ", "success");
      }
      await loadArticles();
      handleCloseModal();
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ที่จะลบบทความนี้?")) return;
    
    try {
      await articleApi.delete(id);
      showToast("ลบบทความสำเร็จ", "success");
      loadArticles();
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const uploadData = new FormData();
    uploadData.append("file", file);

    try {
      const response = await fetch("/api/upload/articles", {
        method: "POST",
        body: uploadData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setFormData({ ...formData, image: data.url });
      showToast("อัปโหลดรูปภาพสำเร็จ", "success");
    } catch (error) {
      console.error("Error uploading image:", error);
      showToast("ไม่สามารถอัปโหลดรูปภาพได้", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const CATEGORIES = ["ภูมิปัญญา", "นวัตกรรม", "เกษตรกรรม", "สัมภาษณ์", "งานฝีมือ", "สินค้าชุมชน", "แฟชั่น & หัตถกรรม"];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-gray-900 mb-2">จัดการเรื่องราวชุมชน</h1>
          <p className="text-gray-500">เพิ่ม ลบ แก้ไข บทความเรื่องราวจากชุมชน</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-[#16A085] hover:bg-[#117A65] text-white px-6 py-3 rounded-xl font-bold shadow-sm hover:shadow-md transition flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i>
          เพิ่มบทความใหม่
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#16A085]"></div>
        </div>
      ) : articles.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300 text-3xl">
            <i className="fa-solid fa-newspaper"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">ยังไม่มีบทความ</h3>
          <p className="text-gray-500 mb-6">คลิกที่ปุ่มเพิ่มบทความใหม่เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map((article) => (
            <div key={article.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex flex-col">
              <div className="relative aspect-[4/3] bg-gray-100 w-full">
                {article.image ? (
                  <img src={article.image} alt={article.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">No Image</div>
                )}
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className="bg-[#16A085] text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm">
                    {article.category}
                  </span>
                </div>
              </div>
              
              <div className="p-5 flex flex-col flex-grow">
                <div className="mb-4 flex-grow">
                  <h3 className="font-bold text-gray-800 line-clamp-2">{article.title}</h3>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{article.excerpt}</p>
                  <p className="text-xs text-gray-400 mt-3"><i className="fa-regular fa-user"></i> {article.authorName}</p>
                </div>
                
                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => handleOpenModal(article)}
                    className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2 rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <i className="fa-solid fa-pen-to-square"></i> แก้ไข
                  </button>
                  <button
                    onClick={() => handleDelete(article.id)}
                    className="flex-none w-10 bg-red-50 hover:bg-red-100 text-red-500 py-2 rounded-lg transition flex items-center justify-center"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Form */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-xl font-bold text-gray-800">
                {editingArticle ? "แก้ไขบทความ" : "เพิ่มบทความใหม่"}
              </h2>
              <button onClick={handleCloseModal} className="w-8 h-8 bg-white hover:bg-gray-100 rounded-full flex items-center justify-center text-gray-500 shadow-sm transition">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">หัวข้อ (Title) <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">หมวดหมู่ (Category)</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none bg-white"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อผู้เขียน (Author) <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      value={formData.authorName}
                      onChange={(e) => setFormData({...formData, authorName: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">รูปภาพหน้าปก</label>
                  
                  <div className="flex gap-4 items-start">
                    {/* Image Preview */}
                    <div className="w-32 h-32 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0 border border-gray-200 flex items-center justify-center">
                      {formData.image ? (
                        <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <i className="fa-regular fa-image text-3xl text-gray-400"></i>
                      )}
                    </div>
                    
                    <div className="flex-grow space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">อัปโหลดจากเครื่อง</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          disabled={isUploading}
                          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#16A085]/10 file:text-[#16A085] hover:file:bg-[#16A085]/20 transition-all cursor-pointer"
                        />
                        {isUploading && <span className="text-xs text-[#16A085] mt-1 block animate-pulse">กำลังอัปโหลด...</span>}
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">หรือระบุ URL รูปภาพ (ถ้ามี)</label>
                        <input
                          type="text"
                          value={formData.image || ""}
                          onChange={(e) => setFormData({...formData, image: e.target.value})}
                          placeholder="เช่น https://..."
                          className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none transition text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">คำโปรย (Excerpt)</label>
                  <textarea
                    value={formData.excerpt || ""}
                    onChange={(e) => setFormData({...formData, excerpt: e.target.value})}
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">เนื้อหาบทความ (Content) <span className="text-red-500">*</span></label>
                  <textarea
                    required
                    value={formData.content}
                    onChange={(e) => setFormData({...formData, content: e.target.value})}
                    rows={8}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                    placeholder="รองรับ HTML หรือข้อความธรรมดา..."
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3.5 rounded-xl transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-[#16A085] hover:bg-[#117A65] text-white font-bold py-3.5 rounded-xl transition shadow-md hover:shadow-lg disabled:opacity-50"
                >
                  {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
