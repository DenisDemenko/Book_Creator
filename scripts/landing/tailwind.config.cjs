/**
 * Конфіг Tailwind для лендінгу Студії (`public/about/index.html`).
 *
 * Це той самий конфіг, який макет Stitch віддавав інлайном скрипту
 * cdn.tailwindcss.com. CDN — це JIT-компілятор у браузері: він не для
 * проду (зайві сотні кілобайт, спалах нестилізованої сторінки, залежність
 * від чужого домену), тож CSS збирається один раз наперед і лежить поруч
 * зі сторінкою готовим файлом.
 *
 * Перезбирання: `npm run build:landing` (Tailwind 3 — саме на ньому
 * малювався макет; версія 4 інакше трактує типові кольори рамок і
 * зсунула б вигляд).
 */
module.exports = {
  content: [__dirname + "/../../public/about/index.html"],
    darkMode: "class",
    theme: {
      extend: {
        "colors": {
          "glass-border": "rgba(255, 255, 255, 0.7)",
          "on-secondary-fixed-variant": "#00468a",
          "glass-surface": "rgba(255, 255, 255, 0.65)",
          "tertiary-fixed": "#79fabf",
          "outline-variant": "#dcc1b8",
          "flame-glow": "rgba(217, 119, 87, 0.35)",
          "on-tertiary": "#ffffff",
          "surface-bright": "#fcf9f4",
          "on-surface-variant": "#56423c",
          "on-tertiary-container": "#f5fff6",
          "secondary-container": "#5a9fff",
          "primary-container": "#ba5836",
          "flame-amber": "#d97757",
          "text-ink": "#0b0b0b",
          "electric-cyan": "#3987e5",
          "surface-container-high": "#ebe8e3",
          "canvas-base": "#f9f9f7",
          "surface-container": "#f1ede9",
          "inverse-primary": "#ffb59d",
          "on-tertiary-fixed": "#002113",
          "background": "#fcf9f4",
          "surface-container-low": "#f6f3ef",
          "text-muted": "#6d6b67",
          "outline": "#89726b",
          "surface": "#fcf9f4",
          "on-primary-fixed-variant": "#7e2c0e",
          "error-container": "#ffdad6",
          "secondary": "#005eb4",
          "on-primary-fixed": "#390b00",
          "tertiary": "#006947",
          "on-tertiary-fixed-variant": "#005236",
          "inverse-on-surface": "#f4f0ec",
          "caustic-spectrum": "linear-gradient(135deg, rgba(230,103,103,0.3) 0%, rgba(217,119,87,0.25) 30%, rgba(57,135,229,0.2) 70%, rgba(27,175,122,0.25) 100%)",
          "glass-border-dark": "rgba(11, 11, 11, 0.08)",
          "on-background": "#1c1c19",
          "glass-specular": "rgba(255, 255, 255, 0.85)",
          "coral-radiance": "#e66767",
          "on-secondary-container": "#00356a",
          "on-secondary-fixed": "#001b3c",
          "primary-fixed-dim": "#ffb59d",
          "surface-dim": "#ddd9d5",
          "on-primary-container": "#fffbff",
          "secondary-fixed": "#d5e3ff",
          "tertiary-fixed-dim": "#5adda4",
          "on-secondary": "#ffffff",
          "primary-fixed": "#ffdbd0",
          "on-primary": "#ffffff",
          "on-error-container": "#93000a",
          "secondary-fixed-dim": "#a8c8ff",
          "surface-variant": "#e5e2de",
          "surface-container-lowest": "#ffffff",
          "error": "#ba1a1a",
          "surface-container-highest": "#e5e2de",
          "canvas-subtle": "#f3f3f0",
          "on-surface": "#1c1c19",
          "tertiary-container": "#00855b",
          "primary": "#9a4021",
          "cyan-caustic": "rgba(57, 135, 229, 0.3)",
          "on-error": "#ffffff",
          "inverse-surface": "#31302e",
          "surface-tint": "#9d4223"
        },
        "borderRadius": {
          "DEFAULT": "1rem",
          "lg": "2rem",
          "xl": "3rem",
          "full": "9999px"
        },
        "spacing": {
          "container-max": "88rem",
          "gap-spacious": "1.25rem",
          "pad-3xl": "3.5rem",
          "pad-xl": "1.5rem",
          "pad-lg": "1rem",
          "pad-xs": "0.375rem",
          "pad-md": "0.75rem",
          "pad-2xs": "0.25rem",
          "pad-sm": "0.5rem",
          "pad-2xl": "2.25rem",
          "gap-default": "0.75rem",
          "gap-dense": "0.375rem",
          "col-gutter": "1rem"
        },
        "fontFamily": {
          "label-pill": ["Inter"],
          "body-prose-lg": ["\"Source Serif 4\""],
          "display-hero-mobile": ["\"Source Serif 4\""],
          "title-card": ["Inter"],
          "headline-lg-mobile": ["\"Source Serif 4\""],
          "headline-sm": ["Inter"],
          "headline-md": ["\"Source Serif 4\""],
          "label-code": ["Inter"],
          "body-md": ["Inter"],
          "display-hero": ["\"Source Serif 4\""],
          "body-sm": ["Inter"],
          "headline-lg": ["\"Source Serif 4\""]
        },
        "fontSize": {
          "label-pill": ["13px", { "lineHeight": "18px", "letterSpacing": "0.01em", "fontWeight": "500" }],
          "body-prose-lg": ["18px", { "lineHeight": "30px", "fontWeight": "400" }],
          "display-hero-mobile": ["32px", { "lineHeight": "40px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
          "title-card": ["15px", { "lineHeight": "20px", "fontWeight": "500" }],
          "headline-lg-mobile": ["24px", { "lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
          "headline-sm": ["16px", { "lineHeight": "22px", "letterSpacing": "-0.005em", "fontWeight": "600" }],
          "headline-md": ["22px", { "lineHeight": "28px", "fontWeight": "500" }],
          "label-code": ["11px", { "lineHeight": "15px", "letterSpacing": "0.04em", "fontWeight": "500" }],
          "body-md": ["13px", { "lineHeight": "19px", "fontWeight": "400" }],
          "display-hero": ["48px", { "lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "600" }],
          "body-sm": ["12px", { "lineHeight": "17px", "fontWeight": "400" }],
          "headline-lg": ["32px", { "lineHeight": "40px", "letterSpacing": "-0.015em", "fontWeight": "600" }]
        }
      }
    }
  };
