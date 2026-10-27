"use client";
import Image, { type ImageProps } from "next/image";
import { useState } from "react";
function Photo({ fallbackClassName, alt, ...props }: ImageProps & { fallbackClassName?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={fallbackClassName} role="img" aria-label={`${alt || "Product"}: photograph unavailable`}>Photograph temporarily unavailable.</span>;
  return <Image {...props} alt={alt} unoptimized={String(props.src).startsWith("/catalogue-images/") || String(props.src).startsWith("/api/admin/")} onError={() => setFailed(true)} />;
}
export function ProductPhoto(props: ImageProps & { fallbackClassName?: string }) { return <Photo key={String(props.src)} {...props} />; }
