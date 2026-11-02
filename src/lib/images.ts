/**
 * Property pictures drawn locally as SVG, one per building and the same every
 * time. The original pulled photos from Unsplash, which broke offline and on
 * restricted office networks and showed broken-image text in the demo.
 */
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Muted facades: stone, sage, clay, slate, sand. Sky stays pale.
const FACADES = [
  ["#d9d4c7", "#b9b19f"], ["#c9d3c5", "#9fb09a"], ["#dcc3b0", "#b9937a"], ["#c5ccd4", "#98a3ae"], ["#e1d6bd", "#bfae88"],
];

export function propertyImage(seed: string | number, size: "sm" | "md" | "lg" = "md") {
  void size;
  const h = hash(String(seed));
  const [face, shade] = FACADES[h % FACADES.length];
  const floors = 3 + (h % 4);
  const cols = 4 + ((h >> 3) % 3);
  const W = 800;
  const H = 500;
  const bw = 120 + cols * 70;
  const bx = (W - bw) / 2 - 40;
  const fh = 58;
  const top = H - 70 - floors * fh;
  let windows = "";
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const x = bx + 40 + c * 70;
      const y = top + 16 + f * fh;
      const lit = (h >> (f + c)) % 5 === 0;
      windows += `<rect x="${x}" y="${y}" width="40" height="30" rx="2" fill="${lit ? "#f2e3b8" : "#5f6b66"}" opacity="${lit ? 0.95 : 0.55}"/>`;
    }
  }
  const side = `<rect x="${bx + bw}" y="${top + 30}" width="90" height="${floors * fh - 30 + 0}" fill="${shade}"/>`;
  const trees = [0, 1, 2].map((i) => {
    const tx = 60 + i * 300 + (h % 40);
    return `<circle cx="${tx}" cy="${H - 92}" r="${26 + ((h >> i) % 10)}" fill="#8fa38a" opacity="0.85"/><rect x="${tx - 3}" y="${H - 80}" width="6" height="16" fill="#6b5d4a"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="#e9eeec"/><rect y="${H - 70}" width="${W}" height="70" fill="#cfd5cc"/>${side}<rect x="${bx}" y="${top}" width="${bw}" height="${floors * fh + 0}" fill="${face}"/><rect x="${bx - 8}" y="${top - 10}" width="${bw + 16}" height="12" fill="${shade}"/>${windows}<rect x="${bx + bw / 2 - 22}" y="${H - 70 - 46}" width="44" height="46" fill="#4d5752"/>${trees}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
