"use client";

import { useState, useCallback, createContext, useContext } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_STYLES: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: "bg-green-500", icon: "fa-circle-check" },
  error: { bg: "bg-red-500", icon: "fa-circle-exclamation" },
  info: { bg: "bg-blue-500", icon: "fa-circle-info" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [type, setType] = useState<ToastType>("success");
  const [visible, setVisible] = useState(false);

  const showToast = useCallback((msg: string, toastType: ToastType = "success") => {
    setMessage(msg);
    setType(toastType);
    setVisible(true);
    setTimeout(() => setVisible(false), 3000);
  }, []);

  const style = TOAST_STYLES[type];

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`fixed bottom-20 md:bottom-4 right-4 ${style.bg} text-white px-4 py-3 rounded-lg shadow-lg z-[120] flex items-center gap-2 transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0 pointer-events-none"}`}>
        <i className={`fa-solid ${style.icon}`}></i>
        <span className="text-sm font-bold">{message}</span>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}