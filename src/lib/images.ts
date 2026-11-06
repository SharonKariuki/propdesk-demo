/**
 * Deterministic property imagery from Unsplash source.
 * Given a seed (building name/id), returns the same image every time.
 */
const PROPERTY_IMAGES = [
  "photo-1570129477492-45c003edd2be", // modern apartment
  "photo-1512917774080-9991f1c4c750", // villa
  "photo-1568605114967-8130f3a36994", // townhouse
  "photo-1600585154340-be6161a56a0c", // contemporary home
  "photo-1564013799919-ab600027ffc6", // cozy interior-ext
  "photo-1600596542815-ffad4c1539a9", // brick facade
  "photo-1600607687939-ce8a6c25118c", // airy interior
  "photo-1613553474179-e1eda3ea5734", // apartment block
  "photo-1580587771525-78b9dba3b914", // glass facade
  "photo-1512917774080-9991f1c4c750", // stone villa
  "photo-1582268611958-ebfd161ef9cf", // urban apartments
  "photo-1486406146926-c627a92ad1ab", // residential row
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function propertyImage(seed: string | number, size: "sm" | "md" | "lg" = "md") {
  const w = size === "sm" ? 400 : size === "md" ? 800 : 1400;
  const id = PROPERTY_IMAGES[hash(String(seed)) % PROPERTY_IMAGES.length];
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&q=80&w=${w}`;
}

// Avatars are a quiet grey circle with ink initials (design system: --expected / --fg).
const AVATAR_BACKGROUNDS = ["#e4e4ea"];

/**
 * An initials avatar drawn locally as an SVG data URI. The original called a
 * third-party avatar service with the person's name; drawing it here keeps
 * names in the browser and works offline, with the same look.
 */
export function avatarFor(seed: string | number) {
  const text = String(seed).trim();
  const initials =
    text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("")
      .replace(/[<&>"]/g, "") || "?";
  const bg = AVATAR_BACKGROUNDS[hash(text) % AVATAR_BACKGROUNDS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="36" font-weight="600" fill="#111113">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
