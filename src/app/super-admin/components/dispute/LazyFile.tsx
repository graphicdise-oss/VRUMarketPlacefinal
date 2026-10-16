import React, { useState, useEffect } from "react";
import { errorMessage } from "./utils";

export function LazyFile({ label, load }: { label: string; load: () => Promise<Blob> }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (file) URL.revokeObjectURL(file.url);
    };
  }, [file]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await load();
      setFile({ url: URL.createObjectURL(blob), type: blob.type });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (file) {
    return file.type === "application/pdf" ? (
      <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs font-bold text-blue-600 underline">
        <i className="fa-solid fa-file-pdf"></i> เปิดไฟล์ PDF ({label})
      </a>
    ) : (
      <a href={file.url} target="_blank" rel="noreferrer" title="เปิดดูภาพเต็ม">
        { }
        <img src={file.url} alt={label} className="max-h-48 rounded-xl border border-gray-200 object-contain bg-white" />
      </a>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition disabled:opacity-60"
      >
        <i className={busy ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-paperclip"}></i> {label}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
