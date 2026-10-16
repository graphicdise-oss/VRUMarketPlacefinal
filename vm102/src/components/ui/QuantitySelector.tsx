"use client";

interface QuantitySelectorProps {
  qty: number;
  onDecrease: () => void;
  onIncrease: () => void;
}

export default function QuantitySelector({ qty, onDecrease, onIncrease }: QuantitySelectorProps) {
  return (
    <div className="flex items-center bg-gray-50 border border-gray-200 rounded p-1">
      <button onClick={onDecrease} className="w-6 h-6 flex items-center justify-center bg-white border border-gray-300 rounded text-gray-500 hover:text-vru-orange transition">-</button>
      <span className="text-xs font-bold w-8 text-center">{qty}</span>
      <button onClick={onIncrease} className="w-6 h-6 flex items-center justify-center bg-white border border-gray-300 rounded text-gray-500 hover:text-vru-orange transition">+</button>
    </div>
  );
}