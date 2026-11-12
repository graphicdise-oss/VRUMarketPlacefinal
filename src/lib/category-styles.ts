export type IconStyle = {
  icon: string;
  bgColor: string;
  textColor: string;
  hoverBg: string;
  isBold?: boolean;
};

export interface ColorTone {
  key: string;
  name: string;
  bgColor: string;
  textColor: string;
  hoverBg: string;
  borderColor: string;
  dotBg: string;
}

export interface IconOption {
  icon: string;
  name: string;
  category: string;
}

export const COLOR_PRESETS: Record<string, ColorTone> = {
  teal: {
    key: "teal",
    name: "เขียวหยก (VRU)",
    bgColor: "bg-[#D4F1BB]/30",
    textColor: "text-[#16A085]",
    hoverBg: "hover:bg-[#16A085]",
    borderColor: "border-[#16A085]/30",
    dotBg: "bg-[#16A085]",
  },
  orange: {
    key: "orange",
    name: "ส้มสดใส",
    bgColor: "bg-orange-50",
    textColor: "text-orange-500",
    hoverBg: "hover:bg-orange-500",
    borderColor: "border-orange-200",
    dotBg: "bg-orange-500",
  },
  yellow: {
    key: "yellow",
    name: "เหลืองอำพัน",
    bgColor: "bg-yellow-50",
    textColor: "text-yellow-600",
    hoverBg: "hover:bg-yellow-500",
    borderColor: "border-yellow-200",
    dotBg: "bg-yellow-500",
  },
  green: {
    key: "green",
    name: "เขียวธรรมชาติ",
    bgColor: "bg-green-50",
    textColor: "text-green-600",
    hoverBg: "hover:bg-green-600",
    borderColor: "border-green-200",
    dotBg: "bg-green-600",
  },
  blue: {
    key: "blue",
    name: "ฟ้าสดใส",
    bgColor: "bg-blue-50",
    textColor: "text-blue-500",
    hoverBg: "hover:bg-blue-500",
    borderColor: "border-blue-200",
    dotBg: "bg-blue-500",
  },
  purple: {
    key: "purple",
    name: "ม่วงพาสเทล",
    bgColor: "bg-purple-50",
    textColor: "text-purple-500",
    hoverBg: "hover:bg-purple-500",
    borderColor: "border-purple-200",
    dotBg: "bg-purple-500",
  },
  pink: {
    key: "pink",
    name: "ชมพูหวาน",
    bgColor: "bg-pink-50",
    textColor: "text-pink-500",
    hoverBg: "hover:bg-pink-500",
    borderColor: "border-pink-200",
    dotBg: "bg-pink-500",
  },
  indigo: {
    key: "indigo",
    name: "น้ำเงินคราม",
    bgColor: "bg-indigo-50",
    textColor: "text-indigo-500",
    hoverBg: "hover:bg-indigo-500",
    borderColor: "border-indigo-200",
    dotBg: "bg-indigo-500",
  },
  red: {
    key: "red",
    name: "แดงทับทิม",
    bgColor: "bg-red-50",
    textColor: "text-red-500",
    hoverBg: "hover:bg-red-500",
    borderColor: "border-red-200",
    dotBg: "bg-red-500",
  },
  rose: {
    key: "rose",
    name: "กุหลาบ",
    bgColor: "bg-rose-50",
    textColor: "text-rose-500",
    hoverBg: "hover:bg-rose-500",
    borderColor: "border-rose-200",
    dotBg: "bg-rose-500",
  },
  emerald: {
    key: "emerald",
    name: "เขียวมรกต",
    bgColor: "bg-emerald-50",
    textColor: "text-emerald-500",
    hoverBg: "hover:bg-emerald-500",
    borderColor: "border-emerald-200",
    dotBg: "bg-emerald-500",
  },
  cyan: {
    key: "cyan",
    name: "ฟ้าไซแอน",
    bgColor: "bg-cyan-50",
    textColor: "text-cyan-500",
    hoverBg: "hover:bg-cyan-500",
    borderColor: "border-cyan-200",
    dotBg: "bg-cyan-500",
  },
  amber: {
    key: "amber",
    name: "อำพันอุ่น",
    bgColor: "bg-amber-50",
    textColor: "text-amber-500",
    hoverBg: "hover:bg-amber-500",
    borderColor: "border-amber-200",
    dotBg: "bg-amber-500",
  },
  slate: {
    key: "slate",
    name: "เทาสลีท",
    bgColor: "bg-slate-50",
    textColor: "text-slate-500",
    hoverBg: "hover:bg-slate-500",
    borderColor: "border-slate-200",
    dotBg: "bg-slate-500",
  },
};

export const AVAILABLE_ICONS: IconOption[] = [
  // อาหารและเครื่องดื่ม
  { icon: "fa-carrot", name: "ผัก/ของสด", category: "อาหาร" },
  { icon: "fa-cookie", name: "ขนม/ของว่าง", category: "อาหาร" },
  { icon: "fa-apple-whole", name: "ผลไม้", category: "อาหาร" },
  { icon: "fa-bowl-food", name: "อาหารปรุงสำเร็จ", category: "อาหาร" },
  { icon: "fa-utensils", name: "ร้านอาหาร", category: "อาหาร" },
  { icon: "fa-mug-hot", name: "เครื่องดื่มร้อน", category: "อาหาร" },
  { icon: "fa-bottle-water", name: "เครื่องดื่มเย็น", category: "อาหาร" },

  // เกษตรกรรมและธรรมชาติ
  { icon: "fa-leaf", name: "ใบไม้/เกษตร", category: "เกษตรกรรม" },
  { icon: "fa-seedling", name: "ต้นกล้า/พืชพันธุ์", category: "เกษตรกรรม" },
  { icon: "fa-wheat-awn", name: "ข้าว/ธัญพืช", category: "เกษตรกรรม" },
  { icon: "fa-tree", name: "ต้นไม้", category: "เกษตรกรรม" },
  { icon: "fa-spa", name: "สมุนไพร/สปา", category: "สุขภาพ" },
  { icon: "fa-heart", name: "สุขภาพ", category: "สุขภาพ" },
  { icon: "fa-pump-soap", name: "สกินแคร์/บำรุง", category: "สุขภาพ" },

  // เครื่องแต่งกายและของใช้
  { icon: "fa-shirt", name: "เสื้อผ้า", category: "แฟชั่น" },
  { icon: "fa-hat-cowboy", name: "หมวก/เครื่องประดับ", category: "แฟชั่น" },
  { icon: "fa-glasses", name: "แว่นตา", category: "แฟชั่น" },
  { icon: "fa-shoe-prints", name: "รองเท้า", category: "แฟชั่น" },
  { icon: "fa-basket-shopping", name: "ตะกร้า/ของที่ระลึก", category: "งานฝีมือ" },
  { icon: "fa-palette", name: "งานศิลปะหัตถกรรม", category: "งานฝีมือ" },
  { icon: "fa-gift", name: "ของขวัญ", category: "งานฝีมือ" },
  { icon: "fa-gem", name: "อัญมณี/เครื่องเงิน", category: "งานฝีมือ" },
  { icon: "fa-scissors", name: "สิ่งทอ/เย็บปัก", category: "งานฝีมือ" },

  // ของใช้ในบ้านและเทคโนโลยี
  { icon: "fa-house-chimney", name: "ของใช้ในบ้าน", category: "ในบ้าน" },
  { icon: "fa-couch", name: "เฟอร์นิเจอร์", category: "ในบ้าน" },
  { icon: "fa-bed", name: "เครื่องนอน", category: "ในบ้าน" },
  { icon: "fa-screwdriver-wrench", name: "เครื่องมือช่าง", category: "ในบ้าน" },
  { icon: "fa-microscope", name: "นวัตกรรม มรว.", category: "นวัตกรรม" },
  { icon: "fa-lightbulb", name: "ไอเดีย/ความคิดสร้างสรรค์", category: "นวัตกรรม" },
  { icon: "fa-laptop", name: "อุปกรณ์ดิจิทัล", category: "นวัตกรรม" },
  { icon: "fa-bolt", name: "อิเล็กทรอนิกส์", category: "นวัตกรรม" },

  // ทั่วไป
  { icon: "fa-box-open", name: "กล่องพัสดุ/สินค้า", category: "ทั่วไป" },
  { icon: "fa-tag", name: "สินค้าโปรโมชั่น", category: "ทั่วไป" },
  { icon: "fa-star", name: "สินค้าแนะนำ", category: "ทั่วไป" },
  { icon: "fa-crown", name: "สินค้าพรีเมียม OTOP", category: "ทั่วไป" },
  { icon: "fa-bag-shopping", name: "ช้อปปิ้ง", category: "ทั่วไป" },
];

export const ICON_MAP: Record<string, IconStyle> = {
  "อาหารสด/วัตถุดิบ": { icon: "fa-carrot", bgColor: "bg-orange-50", textColor: "text-orange-500", hoverBg: "hover:bg-orange-500" },
  "อาหารแปรรูป/ขนม": { icon: "fa-cookie", bgColor: "bg-yellow-50", textColor: "text-yellow-600", hoverBg: "hover:bg-yellow-500" },
  "เครื่องดื่ม": { icon: "fa-mug-hot", bgColor: "bg-blue-50", textColor: "text-blue-500", hoverBg: "hover:bg-blue-500" },
  "ผลิตผลการเกษตร": { icon: "fa-leaf", bgColor: "bg-green-50", textColor: "text-green-600", hoverBg: "hover:bg-green-600" },
  "งานฝีมือ/ของที่ระลึก": { icon: "fa-basket-shopping", bgColor: "bg-[#D4F1BB]/30", textColor: "text-[#16A085]", hoverBg: "hover:bg-[#16A085]" },
  "เสื้อผ้า/เครื่องแต่งกาย": { icon: "fa-shirt", bgColor: "bg-purple-50", textColor: "text-purple-500", hoverBg: "hover:bg-purple-500" },
  "สุขภาพและความงาม": { icon: "fa-spa", bgColor: "bg-pink-50", textColor: "text-pink-500", hoverBg: "hover:bg-pink-500" },
  "ของใช้ในบ้าน": { icon: "fa-house-chimney", bgColor: "bg-indigo-50", textColor: "text-indigo-500", hoverBg: "hover:bg-indigo-500" },
  "นวัตกรรม มรว.": { icon: "fa-microscope", bgColor: "bg-slate-50", textColor: "text-slate-500", hoverBg: "hover:bg-slate-500", isBold: true },
};

export const DYNAMIC_COLORS = [
  { bgColor: "bg-red-50", textColor: "text-red-500", hoverBg: "hover:bg-red-500" },
  { bgColor: "bg-cyan-50", textColor: "text-cyan-500", hoverBg: "hover:bg-cyan-500" },
  { bgColor: "bg-emerald-50", textColor: "text-emerald-500", hoverBg: "hover:bg-emerald-500" },
  { bgColor: "bg-amber-50", textColor: "text-amber-500", hoverBg: "hover:bg-amber-500" },
  { bgColor: "bg-violet-50", textColor: "text-violet-500", hoverBg: "hover:bg-violet-500" },
  { bgColor: "bg-rose-50", textColor: "text-rose-500", hoverBg: "hover:bg-rose-500" },
  { bgColor: "bg-fuchsia-50", textColor: "text-fuchsia-500", hoverBg: "hover:bg-fuchsia-500" },
  { bgColor: "bg-sky-50", textColor: "text-sky-500", hoverBg: "hover:bg-sky-500" },
  { bgColor: "bg-teal-50", textColor: "text-teal-500", hoverBg: "hover:bg-teal-500" },
  { bgColor: "bg-lime-50", textColor: "text-lime-600", hoverBg: "hover:bg-lime-600" },
];

export const DYNAMIC_ICONS = [
  "fa-box-open", "fa-star", "fa-heart", "fa-gift", "fa-gem", "fa-crown", "fa-lightbulb",
  "fa-compass", "fa-map", "fa-fire", "fa-bolt", "fa-seedling", "fa-droplet", "fa-cube"
];

export function getDynamicStyle(name: string): IconStyle {
  if (ICON_MAP[name]) return ICON_MAP[name];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);
  
  const color = DYNAMIC_COLORS[hash % DYNAMIC_COLORS.length];
  const icon = DYNAMIC_ICONS[hash % DYNAMIC_ICONS.length];
  
  return { ...color, icon, isBold: false };
}

export function getCategoryStyle(category: { name: string; icon?: string | null; color?: string | null } | string): IconStyle {
  if (typeof category === 'string') {
    return getDynamicStyle(category);
  }

  const customIcon = category.icon?.trim();
  const customColorKey = category.color?.trim();
  const colorPreset = customColorKey ? COLOR_PRESETS[customColorKey] : undefined;

  if (customIcon && colorPreset) {
    return {
      icon: customIcon,
      bgColor: colorPreset.bgColor,
      textColor: colorPreset.textColor,
      hoverBg: colorPreset.hoverBg,
      isBold: false,
    };
  }

  if (customIcon) {
    const baseStyle = getDynamicStyle(category.name);
    return {
      ...baseStyle,
      icon: customIcon,
    };
  }

  if (colorPreset) {
    const baseStyle = getDynamicStyle(category.name);
    return {
      ...baseStyle,
      bgColor: colorPreset.bgColor,
      textColor: colorPreset.textColor,
      hoverBg: colorPreset.hoverBg,
    };
  }

  return getDynamicStyle(category.name);
}
