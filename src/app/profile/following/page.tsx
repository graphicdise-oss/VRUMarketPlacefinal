import { Metadata } from "next";
import FollowingClient from "./FollowingClient";

export const metadata: Metadata = {
  title: "ร้านค้าที่ติดตาม - VRU Marketplace",
  description: "ร้านค้าชุมชนที่คุณกดติดตามไว้",
};

export default function FollowingPage() {
  return <FollowingClient />;
}

