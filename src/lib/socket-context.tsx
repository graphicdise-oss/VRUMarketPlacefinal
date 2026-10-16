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

    // Use API base URL for Socket.IO server, defaulting to localhost:3001
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    const origin = new URL(API_BASE).origin;
    
    // Connect to the /chat namespace with the specific socket.io path
    const socketInstance = io(`${origin}/chat`, {
      path: "/api/v1/socket.io",
      withCredentials: true,
      autoConnect: true,
      transports: ["websocket"]
    });
    
    socketInstance.on("connect", () => {
      console.log("[Socket] Connected to server");
      setIsConnected(true);
    });
    
    socketInstance.on("disconnect", () => {
      console.log("[Socket] Disconnected from server");
      setIsConnected(false);
    });
    
    setTimeout(() => {
      setSocket(socketInstance);
    }, 0);
    
    return () => {
      socketInstance.disconnect();
    };
  }, [isAuthenticated, user]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}
