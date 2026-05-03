"use client";

import { create } from "zustand";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error" | "warning";
  duration?: number;
};

type Store = {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<Store>((set) => ({
  toasts: [],
  push: (t) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { ...t, id: Math.random().toString(36).slice(2) },
      ],
    })),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toast(opts: Omit<ToastItem, "id">) {
  useToastStore.getState().push(opts);
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-md">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onDismiss, toast.duration ?? 4000);
    return () => clearTimeout(id);
  }, [onDismiss, toast.duration]);

  const color =
    toast.variant === "success"
      ? "border-green-500/40 bg-green-500/10"
      : toast.variant === "error"
        ? "border-red-500/40 bg-red-500/10"
        : toast.variant === "warning"
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-border bg-card";

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-4",
        color,
      )}
    >
      <div className="font-semibold text-sm">{toast.title}</div>
      {toast.description && (
        <div className="text-xs text-muted-foreground mt-1">
          {toast.description}
        </div>
      )}
    </div>
  );
}
