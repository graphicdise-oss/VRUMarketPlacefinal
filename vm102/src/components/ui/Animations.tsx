"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

interface StaggeredGridProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
  margin?: string;
}

export function StaggeredGrid({ children, className = "", staggerDelay = 0.05 }: StaggeredGridProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 1 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: staggerDelay }
        }
      }}
    >
      {children}
    </motion.div>
  );
}

interface FadeInProps {
  children: ReactNode;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
}

export function FadeIn({ children, delay = 0, direction = "up" }: FadeInProps) {
  const directionOffset = {
    up: 16,
    down: -16,
    left: 16,
    right: -16,
    none: 0
  };

  const y = direction === "up" || direction === "down" ? directionOffset[direction] : 0;
  const x = direction === "left" || direction === "right" ? directionOffset[direction] : 0;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0, y, x },
        visible: { 
          opacity: 1, 
          y: 0, 
          x: 0, 
          transition: { type: "spring", stiffness: 350, damping: 25, delay }
        }
      }}
    >
      {children}
    </motion.div>
  );
}
