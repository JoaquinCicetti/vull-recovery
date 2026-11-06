import {
  ADDRESS,
  CONTACT_WHATSAPP_NUMBER,
  INSTAGRAM_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

// schema.org description of the business, for Google's local results
// (docs/seo.md). Rendered on the home page only.
//
// Hours and prices are deliberately left out: both live in the database and
// change from the admin, while this page is a build-time snapshot, so they'd
// go stale. Google takes hours from the Business Profile instead.
export function LocalBusinessJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": ["SportsActivityLocation", "HealthAndBeautyBusiness"],
    "@id": `${SITE_URL}/#business`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: `${SITE_URL}/`,
    image: `${SITE_URL}/opengraph-image.jpg`,
    logo: `${SITE_URL}/apple-icon.png`,
    telephone: `+${CONTACT_WHATSAPP_NUMBER}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: `${ADDRESS.street}, ${ADDRESS.place}`,
      addressLocality: ADDRESS.city,
      addressRegion: ADDRESS.region,
      addressCountry: ADDRESS.country,
    },
    areaServed: { "@type": "City", name: ADDRESS.city },
    sameAs: [INSTAGRAM_URL],
  };

  return (
    <script
      type="application/ld+json"
      // Static, trusted constants only; `<` escaped so no string can close the tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
