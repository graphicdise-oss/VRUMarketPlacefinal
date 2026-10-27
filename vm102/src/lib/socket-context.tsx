"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./auth-context";

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false });

export const useSocket = () => useContext(SocketContext);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    // Only connect if authenticated
    if (!isAuthenticated) return;

    // Resolve origin safely (handles both absolute URLs and relative paths like "/api/v1")
    let origin = "";
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
        origin = new URL(API_BASE).origin;
      } else if (typeof window !== "undefined") {
        origin = window.location.origin;
      }
    } catch {
      origin = typeof window !== "undefined" ? window.location.origin : "";
    }

    if (!origin) return;

    let socketInstance: Socket | null = null;
    try {
      // Connect to the /chat namespace with the specific socket.io path
      socketInstance = io(`${origin}/chat`, {
        path: "/api/v1/socket.io",
        withCredentials: true,
        autoConnect: true,
        transports: ["websocket", "polling"]
      });

      socketInstance.on("connect", () => {
        console.log("[Socket] Connected to server");
        setIsConnected(true);
      });

      socketInstance.on("disconnect", () => {
        console.log("[Socket] Disconnected from server");
        setIsConnected(false);
      });

      socketInstance.on("connect_error", (err) => {
        console.warn("[Socket] Connection error:", err.message);
        setIsConnected(false);
      });

      setSocket(socketInstance);
    } catch (err) {
      console.warn("[Socket] Failed to create socket instance:", err);
    }

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, [isAuthenticated, user]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}
