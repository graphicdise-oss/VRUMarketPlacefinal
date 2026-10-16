import { Metadata } from "next";
import WishlistClient from "./WishlistClient";

export const metadata: Metadata = {
  title: "สินค้าที่ถูกใจ - VRU Marketplace",
  description: "สินค้าที่คุณกดถูกใจไว้",
};

export default function WishlistPage() {
  return <WishlistClient />;
}
