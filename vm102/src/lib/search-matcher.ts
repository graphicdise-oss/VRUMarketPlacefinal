export interface SearchableItem {
  name?: string | null;
  description?: string | null;
  shopName?: string | null;
  categoryName?: string | null;
  communityName?: string | null;
}

const COMPOUND_PREFIXES = [
  "ผ้าคลุมไหล่",
  "ผ้าฝ้าย",
  "ผ้าไหม",
  "ผ้าทอ",
  "ผ้า",
  "เสื้อเชิ้ต",
  "เสื้อผ้า",
  "เสื้อ",
  "ชาเกสร",
  "ชาสมุนไพร",
  "ชา",
  "ข้าวหอมมะลิ",
  "ข้าวหอม",
  "ข้าวอินทรีย์",
  "ข้าว",
  "สบู่สมุนไพร",
  "สบู่",
  "น้ำพริกเผา",
  "น้ำพริก",
  "น้ำมัลเบอร์รี่",
  "น้ำมันมะพร้าว",
  "น้ำผลไม้",
  "น้ำ",
  "กล้วยหอม",
  "กล้วยตาก",
  "กล้วยอบ",
  "กล้วย",
  "ส้มสายน้ำผึ้ง",
  "ส้มสาย",
  "ส้ม",
  "เมลอนญี่ปุ่น",
  "เมลอน",
  "ผักสลัด",
  "ผัก",
  "กระเป๋าสาน",
  "กระเป๋า",
  "กล่องทิชชู่",
  "กล่อง",
  "ตะกร้าหวาย",
  "ตะกร้า",
  "เทียนหอม",
  "เทียน",
  "เซรั่ม",
  "สเปรย์",
  "คอมบูชา",
  "เครื่องดื่ม",
];

const COMPOUND_MODIFIERS = [
  "อินทรีย์",
  "ทุ่งวไลย",
  "วไลย",
  "ทอมือ",
  "ย้อมคราม",
  "มัดหมี่",
  "กระจูด",
  "จักสาน",
  "ไม้ไผ่",
  "หวาย",
  "สมุนไพร",
  "เปลือกมังคุด",
  "มังคุด",
  "บัวหลวง",
  "เกสรบัว",
  "ดอกบัว",
  "เกสร",
  "บัว",
  "เห็ดหอม",
  "โบราณ",
  "เข้มข้น",
  "สกัดเย็น",
  "ตะไคร้หอม",
  "กันยุง",
  "ไขถั่วเหลือง",
  "อโรมา",
  "โพรไบโอติกส์",
  "มะพร้าว",
  "ไฮโดรโปนิกส์",
  "ธรรมชาติ",
];

/**
 * Resilient multi-term Thai matcher for e-commerce and community catalogs.
 *
 * Handles:
 * 1. Direct substring match (case-insensitive)
 * 2. Whitespace-separated multi-token search ("ข้าว มะลิ", "สบู่ มังคุด")
 * 3. Thai compound words with interleaved adjectives ("กระเป๋ากระจูด", "ข้าวอินทรีย์", "ชาเกสรบัว")
 */
export function matchesProductSearch(item: SearchableItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const searchable = `${item.name ?? ""} ${item.description ?? ""} ${item.shopName ?? ""} ${item.categoryName ?? ""} ${item.communityName ?? ""}`.toLowerCase();

  // 1. Direct substring match
  if (searchable.includes(q)) {
    return true;
  }

  // 2. Whitespace-separated tokens (all tokens must match)
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => searchable.includes(token))) {
    return true;
  }

  // 3. Thai compound word prefix decomposition
  for (const prefix of COMPOUND_PREFIXES) {
    if (q.startsWith(prefix) && q.length > prefix.length + 1) {
      const remainder = q.slice(prefix.length).trim();

      // If the item text contains the prefix AND the remainder
      if (searchable.includes(prefix) && searchable.includes(remainder)) {
        return true;
      }

      // Check if remainder contains known community modifiers (e.g. "เกสรบัว" -> "เกสร" + "บัว")
      for (const mod of COMPOUND_MODIFIERS) {
        if (remainder.includes(mod)) {
          const restOfRemainder = remainder.replace(mod, "").trim();
          if (
            searchable.includes(prefix) &&
            searchable.includes(mod) &&
            (!restOfRemainder || searchable.includes(restOfRemainder))
          ) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

