"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { useBadge } from "@/lib/badge-context";
import { useRouter } from "next/navigation";
export interface ChatContact {
  id: string;
  otherUserId?: string;
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: number;
  status?: "online" | "offline";
  isOnline?: boolean;
  isActive?: boolean;
}

export interface ChatMessage {
  id: string;
  roomId?: string;
  sender: "user" | "shop" | "system";
  content: string;
  fileId?: string | null;
  time: string;
  isRead?: boolean;
  avatar?: string;
  systemTarget?: "buyer" | "seller" | "all";
  systemLink?: string;
  systemActionText?: string;
  systemIcon?: string;
  systemColor?: string;
  isImportant?: boolean;
  imageAttachment?: string;
  orderId?: string | null;
  productPreview?: {
    name: string;
    price: string;
    image: string;
  };
}
import { buyerOrderApi, type OrderDto } from "@/lib/api-modules/order";
import { uploadChatAttachment, getChatAttachmentUrl, type AckResponse, type ChatMessageDto, type ChatPage, type ChatRoomSummaryDto } from "@/lib/api-modules/chat";
import { formatPrice } from "@/lib/utils";

function ChatOrderSummary({ orderId, content }: { orderId: string; content?: string }) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    buyerOrderApi.getById(orderId)
      .then(data => setOrder(data))
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-sm shadow-md p-6 text-center text-gray-400">
        <i className="fa-solid fa-spinner fa-spin text-2xl mb-2 text-[#16A085]"></i>
        <p className="text-sm">กำลังโหลดข้อมูลคำสั่งซื้อ...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-sm shadow-md p-6 text-center text-gray-400">
        <i className="fa-solid fa-circle-exclamation text-2xl mb-2 text-red-400"></i>
        <p className="text-sm">ไม่พบข้อมูลคำสั่งซื้อ</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-sm shadow-md overflow-hidden flex flex-col">
      <div className="bg-gradient-to-r from-blue-600 to-vru-blue px-4 py-3 text-white flex justify-between items-center">
        <h4 className="font-bold text-sm"><i className="fa-solid fa-file-invoice-dollar mr-2"></i> ใบแจ้งยอดชำระเงิน</h4>
        <span className="text-xs font-semibold opacity-90">{order.id.substring(0, 8).toUpperCase()}</span>
      </div>
      <div className="p-4 bg-gray-50 flex flex-col gap-2 border-b border-gray-100">
        {order.items?.map((item, idx) => (
          <div key={idx} className="flex justify-between items-start text-sm">
            <span className="text-gray-700 font-medium">{item.productNameAtPurchase} <span className="text-gray-400 text-xs">x{item.quantity}</span></span>
            <span className="font-bold text-gray-900">{formatPrice(item.priceAtPurchase * item.quantity)}</span>
          </div>
        ))}
        <div className="flex justify-between items-start text-sm mt-1 pt-2 border-t border-gray-200">
          <span className="text-gray-600 font-medium">ค่าจัดส่ง</span>
          <span className="font-bold text-gray-900">{formatPrice(order.shippingAmountMinor || 0)}</span>
        </div>
      </div>
      <div className="p-4 bg-white flex justify-between items-center">
        <span className="text-sm font-bold text-gray-700">ยอดชำระสุทธิ</span>
        <span className="text-lg font-black text-vru-blue">{formatPrice(order.totalAmountMinor || 0)}</span>
      </div>
      <div className="p-4 bg-gray-50 border-t border-gray-100">
        {content && <p className="text-xs text-gray-500 mb-3 text-center">{content}</p>}
        <Link href={`/orders/${order.id}`} className="block w-full bg-vru-orange hover:bg-vru-orange-dark text-white text-center font-bold py-2.5 rounded-xl shadow-sm transition text-sm">
          ดูรายละเอียดคำสั่งซื้อ
        </Link>
      </div>
    </div>
  );
}

export default function ChatPageClient() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { socket, isConnected } = useSocket();
  const { refreshChat } = useBadge();
  const router = useRouter();

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [activeContactId, setActiveContactId] = useState<string>("");
  const [wsStatus, setWsStatus] = useState<"CONNECTED" | "CONNECTING" | "DISCONNECTED">("CONNECTING");
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const [inputText, setInputText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Realtime typing & presence
  const [isCounterpartTyping, setIsCounterpartTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Message Search
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Block & Report
  const [isBlocked, setIsBlocked] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportCategory, setReportCategory] = useState("ใช้คำหยาบคาย / ไม่เหมาะสม");
  const [reportSuccess, setReportSuccess] = useState(false);

  // Settings
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settings, setSettings] = useState({ soundEnabled: true, autoReplyEnabled: false, autoReplyMessage: "ขณะนี้ไม่อยู่ จะรีบตอบกลับภายหลัง" });

  const currentUserChatRole = "buyer";

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    setWsStatus(isConnected ? "CONNECTED" : "DISCONNECTED");
  }, [isConnected]);

  // Load Contacts
  useEffect(() => {
    if (isAuthenticated && isConnected && socket) {
      socket.emit("listRooms", { limit: 50 }, (response: AckResponse<ChatPage<ChatRoomSummaryDto>>) => {
        if (response.ok) {
          const rooms = response.data.items || [];
          const fetchedContacts = rooms.map((room): ChatContact => {
            const displayName = currentUserChatRole === "buyer" 
              ? (room.shopName || `ร้านค้า (${room.shopOwnerUserId.substring(0, 5)})`)
              : (room.buyerName || `ผู้ซื้อ (${room.buyerId.substring(0, 5)})`);
            const otherUserId = currentUserChatRole === "buyer" ? room.shopOwnerUserId : room.buyerId;
            return {
              id: room.id,
              otherUserId,
              name: displayName,
              avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0D5C75&color=fff`,
              lastMessage: room.lastMessage?.content || (room.lastMessage?.fileId ? "[รูปภาพแนบ]" : "ยังไม่มีข้อความ"),
              time: room.lastMessage ? new Date(room.lastMessage.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "",
              unread: room.unreadCount || 0,
              status: "online" as const,
              isOnline: false,
            };
          });
          setContacts(fetchedContacts);
          if (fetchedContacts.length > 0 && !activeContactId) {
            setActiveContactId(fetchedContacts[0].id);
          }
        }
      });
    }
  }, [isAuthenticated, isConnected, socket, currentUserChatRole, activeContactId]);

  // Load Chat History when active room changes
  useEffect(() => {
    if (activeContactId && socket && isConnected) {
      socket.emit("listMessages", { roomId: activeContactId, limit: 50 }, (response: AckResponse<ChatPage<ChatMessageDto>>) => {
        if (response.ok) {
          const fetchedMessages = response.data.items || [];
          const formattedMessages = fetchedMessages.map((msg): ChatMessage => ({
            id: msg.id,
            roomId: msg.roomId,
            sender: msg.senderId === user?.id ? "user" : "shop",
            content: msg.content,
            fileId: msg.fileId,
            time: new Date(msg.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
            isRead: msg.isRead ?? true,
            orderId: msg.orderId,
          })).reverse();
          
          setChatHistories(prev => ({ ...prev, [activeContactId]: formattedMessages }));
          refreshChat();
        }
      });
    }
  }, [activeContactId, isConnected, socket, user?.id, refreshChat]);

  // Check online status of counterpart
  const activeContact = contacts.find(c => c.id === activeContactId);
  useEffect(() => {
    if (activeContact?.otherUserId && socket && isConnected) {
      socket.emit("checkOnline", { userId: activeContact.otherUserId }, (res: AckResponse<{ isOnline: boolean }>) => {
        if (res.ok) {
          setContacts(prev => prev.map(c => c.id === activeContactId ? { ...c, isOnline: res.data.isOnline } : c));
        }
      });
    }
  }, [activeContactId, activeContact?.otherUserId, socket, isConnected]);

  // Socket realtime listeners: typing, roomRead, incoming message
  useEffect(() => {
    if (socket && isConnected) {
      const handleUserTyping = (data: { roomId: string; userId: string }) => {
        if (data.roomId === activeContactId && data.userId !== user?.id) {
          setIsCounterpartTyping(true);
        }
      };

      const handleUserStopTyping = (data: { roomId: string; userId: string }) => {
        if (data.roomId === activeContactId && data.userId !== user?.id) {
          setIsCounterpartTyping(false);
        }
      };

      const handleRoomRead = (data: { roomId: string; userId: string; readAt: string }) => {
        if (data.roomId === activeContactId && data.userId !== user?.id) {
          setChatHistories(prev => ({
            ...prev,
            [data.roomId]: (prev[data.roomId] || []).map(m => m.sender === "user" ? { ...m, isRead: true } : m)
          }));
        }
      };

      const messageListener = (msg: ChatMessageDto) => {
        setChatHistories(prev => {
          const roomHistory = prev[msg.roomId] || [];
          if (roomHistory.some(m => m.id === msg.id)) return prev;

          const formattedMessage: ChatMessage = {
            id: msg.id,
            roomId: msg.roomId,
            sender: msg.senderId === user?.id ? "user" : "shop",
            content: msg.content,
            fileId: msg.fileId,
            time: new Date(msg.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
            isRead: msg.senderId === user?.id ? false : true,
            orderId: msg.orderId,
          };

          return {
            ...prev,
            [msg.roomId]: [...roomHistory, formattedMessage]
          };
        });

        // If message is in the active room and from the other party, mark as read
        if (msg.roomId === activeContactId && msg.senderId !== user?.id) {
          socket.emit("markRoomRead", { roomId: activeContactId });
        }
      };

      socket.on("userTyping", handleUserTyping);
      socket.on("userStopTyping", handleUserStopTyping);
      socket.on("roomRead", handleRoomRead);
      socket.on("message", messageListener);

      return () => {
        socket.off("userTyping", handleUserTyping);
        socket.off("userStopTyping", handleUserStopTyping);
        socket.off("roomRead", handleRoomRead);
        socket.off("message", messageListener);
      };
    }
  }, [socket, isConnected, activeContactId, user?.id]);

  useEffect(() => {
    const storedSettings = localStorage.getItem("vru_chat_settings");
    if (storedSettings) setSettings(JSON.parse(storedSettings));
  }, []);

  const saveSettings = (newSettings: typeof settings) => {
    setSettings(newSettings);
    localStorage.setItem("vru_chat_settings", JSON.stringify(newSettings));
  };

  const rawMessages = useMemo(() => chatHistories[activeContactId] || [], [chatHistories, activeContactId]);
  const messages = useMemo(() => {
    if (!searchQuery.trim()) return rawMessages;
    const q = searchQuery.toLowerCase();
    return rawMessages.filter(m => m.content?.toLowerCase().includes(q));
  }, [rawMessages, searchQuery]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isCounterpartTyping]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("ระบบรองรับเฉพาะไฟล์รูปภาพ (JPG, PNG) เท่านั้น");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert("ขนาดไฟล์รูปภาพต้องไม่เกิน 10MB");
        return;
      }
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setSelectedImage(url);
    }
  };

  const removeSelectedImage = () => {
    if (selectedImage) {
      URL.revokeObjectURL(selectedImage);
      setSelectedImage(null);
    }
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (socket && isConnected && activeContactId) {
      socket.emit("typing", { roomId: activeContactId });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("stopTyping", { roomId: activeContactId });
      }, 1500);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && !selectedFile) || wsStatus !== "CONNECTED" || !activeContactId) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      socket?.emit("stopTyping", { roomId: activeContactId });
    }

    let fileId: string | null = null;
    if (selectedFile) {
      setIsUploading(true);
      try {
        const uploadRes = await uploadChatAttachment(activeContactId, selectedFile);
        fileId = uploadRes.fileId;
      } catch (err: unknown) {
        setIsUploading(false);
        const errMsg = err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่";
        alert("อัปโหลดรูปภาพไม่สำเร็จ: " + errMsg);
        return;
      }
      setIsUploading(false);
    }

    if (socket) {
      socket.emit("sendMessage", { roomId: activeContactId, content: inputText, fileId }, (response: AckResponse<ChatMessageDto>) => {
        if (response.ok) {
          const msg = response.data;
          const formattedMessage: ChatMessage = {
            id: msg.id,
            roomId: msg.roomId,
            sender: "user" as const,
            content: msg.content,
            fileId: msg.fileId,
            time: new Date(msg.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
            isRead: false,
            orderId: msg.orderId,
          };
          setChatHistories((prev) => ({
            ...prev,
            [activeContactId]: [...(prev[activeContactId] || []), formattedMessage]
          }));
        } else {
          alert("ไม่สามารถส่งข้อความได้: " + (response.error?.message || "เกิดข้อผิดพลาด"));
        }
      });
    }

    setInputText("");
    removeSelectedImage();
  };

  const handleHideMessage = (messageId: string) => {
    if (!confirm("ต้องการลบข้อความนี้ออกจากหน้าจอของคุณใช่หรือไม่? (ข้อความยังคงถูกบันทึกเพื่อเป็นหลักฐานในระบบ)")) return;
    if (socket) {
      socket.emit("hideMessage", { roomId: activeContactId, messageId }, (response: AckResponse<void>) => {
        if (response.ok) {
          setChatHistories(prev => ({
            ...prev,
            [activeContactId]: (prev[activeContactId] || []).filter(m => m.id !== messageId)
          }));
        } else {
          alert("ลบข้อความไม่สำเร็จ: " + response.error.message);
        }
      });
    }
  };

  const handleClearRoom = () => {
    if (!confirm("ต้องการล้างประวัติการสนทนาทั้งหมดในห้องนี้สำหรับคุณใช่หรือไม่?")) return;
    if (socket) {
      socket.emit("clearRoom", { roomId: activeContactId }, (response: AckResponse<void>) => {
        if (response.ok) {
          setChatHistories(prev => ({ ...prev, [activeContactId]: [] }));
          alert("ล้างประวัติการสนทนาเรียบร้อยแล้ว");
        } else {
          alert("ล้างประวัติไม่สำเร็จ: " + response.error.message);
        }
      });
    }
  };

  const handleToggleBlock = () => {
    if (!activeContact?.otherUserId) return;
    if (isBlocked) {
      socket?.emit("unblockUser", { targetUserId: activeContact.otherUserId }, (res: AckResponse<void>) => {
        if (res.ok) {
          setIsBlocked(false);
          alert("ปลดบล็อกผู้ใช้เรียบร้อยแล้ว");
        }
      });
    } else {
      if (!confirm("ยืนยันการบล็อกผู้ใช้นี้? จะไม่สามารถส่งข้อความหากันได้อีก")) return;
      socket?.emit("blockUser", { targetUserId: activeContact.otherUserId }, (res: AckResponse<void>) => {
        if (res.ok) {
          setIsBlocked(true);
          alert("บล็อกผู้ใช้เรียบร้อยแล้ว");
        }
      });
    }
  };

  const handleSubmitReport = async () => {
    if (!reportReason.trim() || !activeContactId) return;
    if (socket) {
      socket.emit("reportRoom", { roomId: activeContactId, reason: reportCategory, details: reportReason }, (res: AckResponse<{ id: string }>) => {
        if (res.ok) {
          setReportSuccess(true);
          setTimeout(() => {
            setIsReportModalOpen(false);
            setReportReason("");
            setReportSuccess(false);
          }, 2000);
        } else {
          alert("ส่งรายงานไม่สำเร็จ: " + (res.error?.message || "เกิดข้อผิดพลาด"));
        }
      });
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 flex-col gap-4">
        <div className="w-12 h-12 border-4 border-[#D4F1BB] border-t-[#16A085] rounded-full animate-spin"></div>
        <p className="text-gray-500 font-bold">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden p-0 md:p-4">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 flex-shrink-0 z-10 md:rounded-t-[1.5rem] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group transition">
            <div className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition text-gray-500 mr-2">
              <i className="fa-solid fa-arrow-left"></i>
            </div>
            <Image src="/logo.png" alt="VRU Logo" width={40} height={40} className="w-10 h-10 object-contain group-hover:scale-105 transition-transform duration-300" />
            <div className="hidden sm:flex flex-col leading-none items-center">
              <div className="text-lg font-bold tracking-tight text-[#16A085]">
                VRU <span className="text-gray-800">Marketplace</span>
              </div>
              <div className="text-[9px] font-black tracking-[0.2em] uppercase mt-1 bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                Thai Trade
              </div>
            </div>
            <h1 className="text-sm font-medium text-gray-400 ml-3 border-l border-gray-200 pl-3 hidden md:block">
              ข้อความ
            </h1>
          </Link>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${wsStatus === "CONNECTED" ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600"}`}>
              <span className={`w-2 h-2 rounded-full ${wsStatus === "CONNECTED" ? "bg-green-500" : "bg-red-500"}`}></span>
              {wsStatus === "CONNECTED" ? "เชื่อมต่อแล้ว" : "ออฟไลน์"}
            </div>
          </div>
        </div>
      </header>

      {/* Chat Container */}
      <main className="flex-grow flex overflow-hidden max-w-7xl mx-auto w-full bg-white md:rounded-b-[1.5rem] shadow-lg border border-gray-100 border-t-0">
        {/* Left Sidebar - Contact List */}
        <div className="w-full md:w-80 border-r border-gray-100 flex flex-col hidden md:flex bg-white">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50">
            <div className="relative">
              <input type="text" placeholder="ค้นหาร้านค้า..." className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-vru-blue/20 focus:border-vru-blue transition shadow-sm" />
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
            </div>
          </div>
          <div className="flex-grow overflow-y-auto">
            {contacts.map((contact) => (
              <div 
                key={contact.id} 
                onClick={() => setActiveContactId(contact.id)}
                className={`p-4 border-b border-gray-50 flex items-start gap-3 cursor-pointer transition ${activeContactId === contact.id ? "bg-blue-50/50 border-l-4 border-l-vru-blue" : "hover:bg-gray-50"}`}>
                <div className="relative">
                  <img 
                    src={contact.avatar} 
                    alt={contact.name} 
                    className="w-12 h-12 rounded-full object-cover shadow-sm border border-gray-200" 
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=0D5C75&color=fff`;
                    }}
                  />
                  <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-white rounded-full ${contact.isOnline ? "bg-green-500" : "bg-gray-300"}`}></span>
                </div>
                <div className="flex-grow min-w-0 mt-0.5">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className={`text-sm truncate pr-2 ${activeContactId === contact.id ? "font-bold text-gray-900" : "font-semibold text-gray-700"}`}>{contact.name}</h3>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap font-medium">{contact.time}</span>
                  </div>
                  <p className={`text-xs truncate ${contact.unread > 0 && activeContactId !== contact.id ? "font-bold text-gray-800" : "text-gray-500"}`}>{contact.lastMessage}</p>
                </div>
                {contact.unread > 0 && activeContactId !== contact.id && (
                  <div className="w-5 h-5 bg-vru-blue rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm flex-shrink-0 mt-1">
                    {contact.unread}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right - Chat Area */}
        <div className="flex-grow flex flex-col h-full bg-[#f8faf9] relative">
          
          <div className="relative flex flex-col h-full z-10">
            {/* Chat Header */}
            <div className="bg-white p-3 md:p-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <button className="md:hidden text-gray-400 hover:text-vru-blue p-2 -ml-2"><i className="fa-solid fa-chevron-left"></i></button>
                <div className="relative">
                  <img 
                    src={activeContact?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(activeContact?.name || "Shop")}&background=0D5C75&color=fff`} 
                    alt={activeContact?.name || "Shop"} 
                    className="w-10 h-10 rounded-full shadow-sm border border-gray-200 object-cover" 
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(activeContact?.name || "Shop")}&background=0D5C75&color=fff`;
                    }}
                  />
                  <span className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-white rounded-full ${activeContact?.isOnline ? "bg-green-500" : "bg-gray-300"}`}></span>
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-sm md:text-base">{activeContact?.name || "บทสนทนา"}</h2>
                  <p className="text-[10px] md:text-xs text-vru-blue font-medium flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${activeContact?.isOnline ? "bg-vru-blue animate-pulse" : "bg-gray-300"}`}></span> {activeContact?.isOnline ? "ออนไลน์" : "ออฟไลน์"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <button 
                  onClick={() => setIsSearching(!isSearching)} 
                  title="ค้นหาข้อความ" 
                  className={`text-gray-500 hover:text-vru-blue hover:bg-blue-50 transition text-xs font-bold border border-gray-200 bg-white shadow-sm px-2.5 py-1.5 rounded-full ${isSearching ? "text-vru-blue border-vru-blue bg-blue-50" : ""}`}
                >
                  <i className="fa-solid fa-magnifying-glass"></i>
                </button>
                <button 
                  onClick={handleClearRoom} 
                  title="ล้างประวัติการสนทนาสำหรับฉัน" 
                  className="text-gray-500 hover:text-red-500 hover:bg-red-50 transition text-xs font-bold border border-gray-200 bg-white shadow-sm px-2.5 py-1.5 rounded-full hidden sm:inline-flex"
                >
                  <i className="fa-regular fa-trash-can"></i>
                </button>
                <button 
                  onClick={handleToggleBlock} 
                  title={isBlocked ? "ปลดบล็อกผู้ใช้นี้" : "บล็อกผู้ใช้นี้"} 
                  className={`transition text-xs font-bold border border-gray-200 bg-white shadow-sm px-2.5 py-1.5 rounded-full hidden sm:inline-flex ${isBlocked ? "text-red-600 bg-red-50 border-red-300" : "text-gray-500 hover:text-red-600 hover:bg-red-50"}`}
                >
                  <i className="fa-solid fa-ban"></i>
                </button>
                <button onClick={() => setIsSettingsModalOpen(true)} className="text-gray-500 hover:text-vru-blue hover:bg-blue-50 transition text-xs font-bold border border-gray-200 bg-white shadow-sm px-2 sm:px-3 py-1.5 rounded-full"><i className="fa-solid fa-gear sm:mr-1"></i> <span className="hidden sm:inline">ตั้งค่า</span></button>
                <button onClick={() => setIsReportModalOpen(true)} className="text-gray-500 hover:text-red-600 hover:bg-red-50 transition text-xs font-bold border border-gray-200 bg-white shadow-sm px-2 sm:px-3 py-1.5 rounded-full"><i className="fa-solid fa-flag sm:mr-1"></i> <span className="hidden sm:inline">รายงาน</span></button>
                <Link href={activeContact?.id ? `/shops/${activeContact.id}` : "#"} className="hover:text-vru-blue hover:bg-blue-50 transition text-[10px] sm:text-xs font-bold border border-gray-200 bg-white shadow-sm px-2 sm:px-3 py-1.5 rounded-full whitespace-nowrap"><i className="fa-solid fa-store sm:mr-1"></i> <span className="hidden sm:inline">หน้าร้าน</span></Link>
              </div>
            </div>

            {/* In-chat Search Input Bar */}
            {isSearching && (
              <div className="bg-white px-4 py-2.5 border-b border-gray-200 flex items-center gap-2.5 shadow-inner">
                <i className="fa-solid fa-magnifying-glass text-gray-400 text-sm"></i>
                <input 
                  type="text" 
                  placeholder="ค้นหาข้อความในห้องสนทนานี้..." 
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)} 
                  className="w-full text-sm bg-transparent focus:outline-none" 
                  autoFocus 
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-gray-400 hover:text-gray-600 text-xs p-1">
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                )}
                <button onClick={() => { setIsSearching(false); setSearchQuery(""); }} className="text-xs text-gray-500 hover:text-gray-800 font-bold ml-1">
                  ปิด
                </button>
              </div>
            )}

            {/* Note about Slips */}
            <div className="bg-[#D4F1BB] text-[#16A085] text-xs font-bold py-2 px-4 text-center flex-shrink-0 shadow-sm flex items-center justify-center gap-2">
              <i className="fa-solid fa-triangle-exclamation"></i> ห้ามส่งสลิปโอนเงินผ่านทางแชท กรุณาแนบสลิปในหน้า &quot;คำสั่งซื้อ&quot;
            </div>

            {/* Messages */}
            <div className="flex-grow overflow-y-auto chat-scroll p-4 md:p-6 flex flex-col gap-5">
              <div className="text-center my-3"><span className="text-[10px] text-gray-500 font-bold bg-gray-100 border border-gray-200 px-4 py-1.5 rounded-full shadow-sm">วันนี้ 14:15</span></div>

              {messages.map((msg) => {
                if (msg.sender === "system") {
                  if (msg.systemTarget && msg.systemTarget !== currentUserChatRole) return null;
                  
                  // Render Order Summary
                  if (msg.orderId) {
                    return (
                      <div key={msg.id} className="w-full flex justify-center my-4">
                        <ChatOrderSummary orderId={msg.orderId} content={msg.content} />
                      </div>
                    );
                  }

                  // Standard System Message
                  return (
                    <div key={msg.id} className="w-full flex justify-center my-2">
                      <div className={`flex items-start gap-3 p-4 rounded-2xl w-full max-w-sm shadow-sm border ${msg.systemColor || "text-gray-700 bg-gray-50 border-gray-200"}`}>
                        {msg.systemIcon && <div className="text-xl mt-0.5"><i className={`fa-solid ${msg.systemIcon}`}></i></div>}
                        <div className="flex-grow flex flex-col">
                          <p className="text-[13px] font-bold whitespace-pre-wrap mb-2 leading-relaxed">{msg.content}</p>
                          {msg.systemLink && (
                            <Link href={msg.systemLink} className="self-start bg-white/90 hover:bg-white text-gray-800 px-4 py-1.5 rounded-full text-[11px] font-black shadow-sm transition border border-gray-100">
                              {msg.systemActionText || "ดูรายละเอียด"}
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Standard Chat Bubble
                const isUser = msg.sender === "user";
                return (
                  <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] md:max-w-[70%] flex ${isUser ? "flex-col items-end" : "items-end gap-2"}`}>
                      {!isUser && msg.avatar && <img src={msg.avatar} alt="Avatar" className="w-8 h-8 rounded-full mb-5 shadow-sm border border-gray-200" />}
                      {!isUser && !msg.avatar && <div className="w-8 h-8 mb-5"></div>}
                      <div className="flex flex-col items-start">
                        {msg.productPreview && (
                          <div className="bg-white p-2 rounded-2xl rounded-br-md shadow-sm border border-gray-200 mb-1.5 flex gap-3 w-full max-w-[260px]">
                            <img src={msg.productPreview.image} alt="Product" className="w-12 h-12 object-cover rounded-xl" />
                            <div className="flex flex-col justify-center">
                              <p className="text-[11px] font-bold text-gray-800 line-clamp-1">{msg.productPreview.name}</p>
                              <p className="text-[12px] font-black text-vru-blue">{msg.productPreview.price}</p>
                            </div>
                          </div>
                        )}
                        {msg.fileId && (
                          <div className={`mb-1.5 overflow-hidden rounded-xl border border-gray-200/50 shadow-sm ${isUser ? "self-end" : "self-start"}`}>
                            <a href={getChatAttachmentUrl(activeContactId, msg.fileId)} target="_blank" rel="noopener noreferrer">
                              <img src={getChatAttachmentUrl(activeContactId, msg.fileId)} alt="Attachment" className="max-w-[200px] md:max-w-[250px] max-h-[300px] object-contain bg-white hover:opacity-90 transition cursor-pointer" />
                            </a>
                          </div>
                        )}
                        {msg.imageAttachment && !msg.fileId && (
                          <div className={`mb-1.5 overflow-hidden rounded-xl border border-gray-200/50 shadow-sm ${isUser ? "self-end" : "self-start"}`}>
                            <img src={msg.imageAttachment} alt="Attachment" className="max-w-[200px] md:max-w-[250px] max-h-[300px] object-contain bg-white" />
                          </div>
                        )}
                        {msg.content && (
                          <div className={`px-4 py-3 text-[14px] shadow-sm whitespace-pre-wrap leading-relaxed ${isUser ? "bg-vru-blue text-white rounded-3xl rounded-tr-md" : `bg-white text-gray-800 rounded-3xl rounded-tl-md border border-gray-100 ${msg.isImportant ? "border-l-4 border-l-vru-blue" : ""}`}`}>
                            {msg.content}
                          </div>
                        )}
                        <span className={`text-[10px] font-bold text-gray-400 mt-1 flex items-center gap-1.5 ${isUser ? "mr-1 self-end" : "ml-1"}`}>
                          {msg.time}
                          {isUser && (
                            msg.isRead ? (
                              <span className="text-blue-500 font-bold flex items-center gap-0.5 ml-0.5" title="อ่านแล้ว">
                                <i className="fa-solid fa-check-double text-[11px]"></i> อ่านแล้ว
                              </span>
                            ) : (
                              <span className="text-gray-400 font-normal flex items-center gap-0.5 ml-0.5" title="ส่งแล้ว">
                                <i className="fa-solid fa-check text-[11px]"></i> ส่งแล้ว
                              </span>
                            )
                          )}
                          <button
                            type="button"
                            onClick={() => handleHideMessage(msg.id)}
                            title="ลบสำหรับฉัน"
                            className="opacity-60 hover:opacity-100 transition text-gray-400 hover:text-red-500 text-[10px] ml-1"
                          >
                            <i className="fa-regular fa-trash-can"></i>
                          </button>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {isCounterpartTyping && (
                <div className="flex items-center gap-2 px-3.5 py-1.5 bg-white border border-gray-200 rounded-full w-fit shadow-sm text-xs text-gray-500 animate-pulse my-1 ml-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-vru-blue animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-vru-blue animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-vru-blue animate-bounce [animation-delay:0.4s]"></span>
                  <span className="font-medium text-[11px] text-gray-600">กำลังพิมพ์...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form Area */}
            <div className="bg-white border-t border-gray-100 flex-shrink-0 flex flex-col">
              {selectedImage && (
                <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                  <div className="relative group">
                    <img src={selectedImage} alt="Selected" className="h-16 w-16 object-cover rounded-lg border border-gray-200 shadow-sm" />
                    <button type="button" onClick={removeSelectedImage} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md hover:bg-red-600 transition">
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                  {isUploading && (
                    <span className="text-xs text-vru-blue font-bold flex items-center gap-1.5 animate-pulse">
                      <i className="fa-solid fa-spinner fa-spin"></i> กำลังอัปโหลดรูปภาพ...
                    </span>
                  )}
                </div>
              )}
              <form onSubmit={handleSendMessage} className={`p-3 md:p-4 ${selectedImage ? 'pt-2' : ''}`}>
                <input type="file" accept="image/jpeg,image/png" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                <div className="flex items-center gap-2 md:gap-3">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-vru-blue transition p-2 rounded-full hover:bg-blue-50" title="แนบรูปภาพ (JPG/PNG)"><i className="fa-solid fa-image text-xl"></i></button>
                  <div className="flex-grow relative">
                    <input 
                      type="text" 
                      value={inputText}
                      onChange={handleInputChange}
                      disabled={wsStatus !== "CONNECTED" || isUploading} 
                      placeholder={isUploading ? "กำลังอัปโหลดรูป..." : (wsStatus === "CONNECTED" ? "พิมพ์ข้อความ..." : "รอการเชื่อมต่อ...")} 
                      className="w-full bg-gray-50 border border-gray-200 rounded-full pl-5 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-vru-blue/20 focus:border-vru-blue transition disabled:opacity-50 shadow-inner" 
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-vru-blue p-1 transition"><i className="fa-regular fa-face-smile text-lg"></i></button>
                  </div>
                  <button type="submit" disabled={(!inputText.trim() && !selectedFile) || wsStatus !== "CONNECTED" || isUploading} className="bg-vru-blue hover:bg-blue-700 hover:shadow-lg text-white w-12 h-12 rounded-full flex items-center justify-center transition shadow-md flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                    {isUploading ? <i className="fa-solid fa-spinner fa-spin text-base"></i> : <i className="fa-solid fa-paper-plane text-base pr-0.5"></i>}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* Report Modal */}
      {isReportModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-red-50">
              <h3 className="font-bold text-xl text-red-600 flex items-center gap-2">
                <i className="fa-solid fa-flag"></i> รายงานผู้ใช้งาน / ร้านค้านี้
              </h3>
              <button onClick={() => setIsReportModalOpen(false)} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            
            {reportSuccess ? (
              <div className="p-10 text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center text-3xl mb-4">
                  <i className="fa-solid fa-check"></i>
                </div>
                <h4 className="font-bold text-gray-800 text-lg mb-2">ส่งรายงานสำเร็จ</h4>
                <p className="text-sm text-gray-500">ทีมงานแอดมินจะตรวจสอบข้อความสนทนาและดำเนินการโดยเร็วที่สุด ขอบคุณครับ</p>
              </div>
            ) : (
              <>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">สาเหตุที่รายงาน <span className="text-red-500">*</span></label>
                    <select 
                      value={reportCategory}
                      onChange={(e) => setReportCategory(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-500 text-sm mb-4 bg-white text-gray-700"
                    >
                      <option value="ใช้คำหยาบคาย / ไม่เหมาะสม">ใช้คำหยาบคาย / ไม่เหมาะสม</option>
                      <option value="มีพฤติกรรมหลอกลวง / ฉ้อโกง">มีพฤติกรรมหลอกลวง / ฉ้อโกง</option>
                      <option value="ขายสินค้าผิดกฎหมาย">ขายสินค้าผิดกฎหมาย</option>
                      <option value="อื่นๆ">อื่นๆ</option>
                    </select>
                    
                    <label className="block text-sm font-bold text-gray-700 mb-2">รายละเอียดเพิ่มเติม</label>
                    <textarea 
                      value={reportReason} 
                      onChange={e => setReportReason(e.target.value)} 
                      placeholder="อธิบายเหตุการณ์ที่เกิดขึ้น..." 
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-red-500 h-24 text-sm" 
                    ></textarea>
                  </div>
                  <div className="bg-yellow-50 text-yellow-700 p-3 rounded-xl text-[11px] font-bold border border-yellow-200">
                    <i className="fa-solid fa-circle-info text-yellow-500 mr-1"></i>
                    เมื่อท่านกดส่งรายงาน ระบบจะคัดลอกบทสนทนาล่าสุดส่งไปให้แอดมินชุมชนตรวจสอบด้วยอัตโนมัติ
                  </div>
                </div>
                <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
                  <button onClick={() => setIsReportModalOpen(false)} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm">ยกเลิก</button>
                  <button 
                    onClick={handleSubmitReport} 
                    disabled={!reportReason.trim()}
                    className="px-5 py-2.5 font-bold text-white bg-red-500 hover:bg-red-600 disabled:bg-red-200 rounded-xl shadow-md transition flex items-center gap-2 text-sm"
                  >
                    <i className="fa-solid fa-paper-plane"></i> ยืนยันการรายงาน
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-gear text-[#16A085]"></i> ตั้งค่าการสนทนา
              </h3>
              <button onClick={() => setIsSettingsModalOpen(false)} className="text-gray-400 hover:text-gray-800"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-gray-800 text-sm">เสียงแจ้งเตือนข้อความ</h4>
                  <p className="text-xs text-gray-500">เล่นเสียงเมื่อมีข้อความเข้า</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={settings.soundEnabled} onChange={(e) => saveSettings({ ...settings, soundEnabled: e.target.checked })} />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16A085]"></div>
                </label>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-gray-800 text-sm">ข้อความตอบกลับอัตโนมัติ</h4>
                    <p className="text-xs text-gray-500">เฉพาะร้านค้า (ส่งเมื่อออฟไลน์)</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={settings.autoReplyEnabled} onChange={(e) => saveSettings({ ...settings, autoReplyEnabled: e.target.checked })} />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16A085]"></div>
                  </label>
                </div>
                {settings.autoReplyEnabled && (
                  <textarea 
                    value={settings.autoReplyMessage}
                    onChange={(e) => saveSettings({ ...settings, autoReplyMessage: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#16A085] transition h-20"
                    placeholder="พิมพ์ข้อความตอบกลับอัตโนมัติ..."
                  ></textarea>
                )}
              </div>
            </div>

            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setIsSettingsModalOpen(false)} className="px-6 py-2.5 font-bold text-white bg-[#16A085] hover:bg-[#117A65] rounded-xl shadow-md transition text-sm">
                บันทึกและปิด
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}