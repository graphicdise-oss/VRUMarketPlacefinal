"use client";

import { useState, useRef, useEffect } from "react";

interface Option {
  label: string;
  value: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  className?: string;
  dropdownClassName?: string;
}

export default function CustomSelect({ options, value, onChange, className = "", dropdownClassName = "" }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-3 bg-white border border-gray-200 text-sm py-2 px-4 rounded-full outline-none hover:border-[#16A085] focus:border-[#16A085] shadow-sm font-bold text-gray-700 transition-colors"
      >
        <span className="truncate">{selectedOption?.label}</span>
        <i className={`fa-solid fa-chevron-down text-[10px] text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}></i>
      </button>

      {isOpen && (
        <div className={`absolute z-50 mt-1 min-w-full w-max max-w-[250px] bg-white border border-gray-100 rounded-2xl shadow-lg overflow-hidden py-1 ${dropdownClassName}`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                value === option.value ? "bg-[#16A085]/10 text-[#16A085] font-bold" : "text-gray-700 font-medium hover:bg-gray-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
