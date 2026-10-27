import { CatalogueShell } from "../../components/catalogue/CatalogueShell";

export default function CatalogueLayout({ children }: { children: React.ReactNode }) {
  return <CatalogueShell>{children}</CatalogueShell>;
}
