export type IconStyle = {
  icon: string;
  bgColor: string;
  textColor: string;
  hoverBg: string;
  isBold?: boolean;
};

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
