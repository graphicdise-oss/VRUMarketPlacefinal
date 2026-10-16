import { Metadata } from "next";
import ReviewsClient from "./ReviewsClient";

export const metadata: Metadata = {
  title: "รอการรีวิว - VRU Marketplace",
  description: "ให้คะแนนและรีวิวสินค้าที่คุณได้รับแล้ว",
};

export default function ReviewsPage() {
  return <ReviewsClient />;
}
