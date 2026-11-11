import { CatalogueShell } from "../../components/catalogue/CatalogueShell";
import styles from "../../components/customer/customer.module.css";
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <CatalogueShell><div className={`maison-container ${styles.account}`}>{children}</div></CatalogueShell>;
}
