import React from "react";

export const MIN_REASON = 10;
export const MAX_REASON = 2000;

export function ReasonField({
  value,
  onChange,
  placeholder,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  max: number;
}) {
  const length = value.trim().length;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        rows={3}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#16A085]"
      />
      <p className={`text-[11px] mt-1 ${length >= MIN_REASON ? "text-gray-400" : "text-red-400"}`}>
        {length}/{max} ตัวอักษร (อย่างน้อย {MIN_REASON})
      </p>
    </div>
  );
}
