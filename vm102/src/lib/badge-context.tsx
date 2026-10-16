"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useAuth } from "./auth-context";
import { useSocket } from "./socket-context";
import { notificationApi } from "./api";
import type { ChatRoomSummaryDto, AckResponse, ChatPage } from "./api-modules/chat";

interface BadgeContextType {
  unreadNotifications: number;
  unreadChat: number;
  refreshNotifications: () => Promise<void>;
  refreshChat: () => void;
  markNotificationsAsReadLocally: () => void;
}

const BadgeContext = createContext<BadgeContextType>({
  unreadNotifications: 0,
  unreadChat: 0,
  refreshNotifications: async () => {},
  refreshChat: () => {},
  markNotificationsAsReadLocally: () => {},
});

export const useBadge = () => useContext(BadgeContext);

export function BadgeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { socket, isConnected } = useSocket();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChat, setUnreadChat] = useState(0);

  // 1. Fetch unread notifications
  const refreshNotifications = useCallback(async () => {
    if (isLoading || !isAuthenticated || !user) {
      setUnreadNotifications(0);
      return;
    }
    try {
      const res = await notificationApi.unreadCount();
      setUnreadNotifications(res?.count ?? 0);
    } catch {
      // Session might be unauthenticated or expired; silently reset count
      setUnreadNotifications(0);
    }
  }, [isLoading, isAuthenticated, user]);

  // 2. Fetch unread chat via Socket
  const refreshChat = useCallback(() => {
    if (isLoading || !isAuthenticated) {
      setUnreadChat(0);
      return;
    }
    if (!socket || !isConnected) {
      setUnreadChat(0);
      return;
    }
    socket.emit("listRooms", { limit: 50 }, (response: AckResponse<ChatPage<ChatRoomSummaryDto>>) => {
      if (response && response.ok && response.data?.items) {
        const rooms = response.data.items;
        const total = rooms.reduce((acc, room) => acc + (room.unreadCount || 0), 0);
        setUnreadChat(total);
      } else {
        setUnreadChat(0);
      }
    });
  }, [isLoading, isAuthenticated, socket, isConnected]);

  const markNotificationsAsReadLocally = useCallback(() => {
    setUnreadNotifications(0);
  }, []);

  // Effect for Notifications
  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      refreshNotifications();
      // Periodically refresh notifications every 30 seconds
      const interval = setInterval(refreshNotifications, 30000);
      return () => clearInterval(interval);
    } else if (!isLoading && !isAuthenticated) {
      setUnreadNotifications(0);
    }
  }, [isLoading, isAuthenticated, user, refreshNotifications]);

  // Effect for Chat
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setUnreadChat(0);
      return;
    }

    refreshChat();

    if (socket && isConnected) {
      // Listen for incoming messages to refresh count
      const handleMessage = () => {
        refreshChat();
      };

      socket.on("message", handleMessage);
      socket.on("messageUpdated", handleMessage);

      return () => {
        socket.off("message", handleMessage);
        socket.off("messageUpdated", handleMessage);
      };
    }
  }, [isLoading, isAuthenticated, socket, isConnected, refreshChat]);

  return (
    <BadgeContext.Provider
      value={{
        unreadNotifications,
        unreadChat,
        refreshNotifications,
        refreshChat,
        markNotificationsAsReadLocally,
      }}
    >
      {children}
    </BadgeContext.Provider>
  );
}
