import Link from "next/link";
import { businessContact, confirmedContactMethods } from "../../lib/editorial/contact.ts";
import styles from "./editorial.module.css";

export function ContactOptions({ appointment = false }: { appointment?: boolean }) {
  const methods = confirmedContactMethods();
  return <div className={`royal-frame ${styles.contactPanel}`}>
    <p className={styles.eyebrow}>{appointment ? "Appointment enquiries" : "Contact availability"}</p>
    {methods.length ? <>
      <h2 className="font-display">Begin with a message.</h2>
      <p>{appointment ? "Tell us what you would like to discuss. A date and time are only agreed after personal confirmation from the boutique." : "Use the confirmed email below to begin a conversation with the boutique."}</p>
      {methods.map((method) => <a key={method.href} href={method.href + (appointment ? "?subject=Private%20appointment%20enquiry" : "")}
        className={`hero-cta hero-primary-button ${styles.button}`}>{appointment ? "Email an appointment enquiry" : method.label}</a>)}
    </> : <>
      <h2 className="font-display">Contact details are being confirmed.</h2>
      <p>{appointment ? "Use the request form above to discuss a consultation. Direct contact details are still being verified. No date or time is reserved until staff confirm the arrangements."
        : "Use the request form above to begin a conversation. A verified direct email or telephone channel is not available here yet."}</p>
      <Link href={appointment ? "/contact" : "/collections"} className={`hero-cta hero-secondary-button ${styles.button}`}>
        {appointment ? "Contact & availability" : "Explore the collections"}
      </Link>
    </>}
    <p className={styles.locality}>{businessContact.locality}</p>
  </div>;
}
