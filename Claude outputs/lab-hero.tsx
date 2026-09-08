"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LightRays } from "./light-rays";

// Ported from site/index.html's <section class="hero"> (docs/migration-
// plan.md Phase C) — sits above the marketplace's own hero (П1: "стає над
// ним"), keeps the lab's original copy and CTAs (П2: "старим"), not the
// marketplace's. hero-facts (equipment/teachers/address strip) is
// deliberately not ported (П4/C6) — that's about the physical space, not
// the storefront below it.
//
// CTA destinations, updated as later phases landed: "Записатися на
// спільне заняття" now points at the real Phase F2 booking page
// (/schedule) rather than the course catalog it opened against
// provisionally in Phase C. "Переглянути напрямки" still scrolls to the
// category strip on this same homepage — there is no standalone
// "напрямки" page in the plan, so this interim choice stands.
export function LabHero() {
  const t = useTranslations("labHero");
  const sectionRef = useRef<HTMLDivElement>(null);

  // The "dynamic fill" from П3: instead of a fixed left-to-right gradient
  // that washes the whole portrait in brown, the overlay's hotspot follows
  // the pointer, and its own opacity is lower than the original (0.88 max
  // here vs the source's 0.88 uniform) so the right side — where the
  // portrait's face sits — reads clearly even before anyone moves the
  // mouse.
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
  }

  return (
    <section
      ref={sectionRef}
      onPointerMove={handlePointerMove}
      className="relative isolate overflow-hidden bg-[#2b1a10]"
      style={{ "--mx": "30%", "--my": "40%" } as React.CSSProperties}
    >
      <div className="absolute inset-0">
        <picture>
          <source srcSet="/hero-lab.avif" type="image/avif" />
          <source srcSet="/hero-lab.webp" type="image/webp" />
          <img
            src="/hero-lab.webp"
            alt=""
            className="h-full w-full object-cover object-top"
            fetchPriority="high"
          />
        </picture>
        {/* Single wash layer: the same left-to-right gradient as before,
            but masked by a 450px radial spot around the pointer so the
            wash itself goes fully transparent under the cursor and fades
            back in to its normal depth at 450px away. (Previously this was
            two stacked semi-transparent layers — a fixed wash plus a
            separate radial "clearing" on top — which could never actually
            reach 0% under the cursor because the two alphas compounded
            instead of one replacing the other.) */}
        <div
          className="absolute inset-0 transition-[mask-position,-webkit-mask-position] duration-300 ease-out"
          style={{
            background:
              "linear-gradient(to right, rgba(43,26,16,.82) 0%, rgba(43,26,16,.6) var(--mx), rgba(43,26,16,.22) 100%)",
            WebkitMaskImage:
              "radial-gradient(450px circle at var(--mx) var(--my), transparent 0%, black 100%)",
            maskImage:
              "radial-gradient(450px circle at var(--mx) var(--my), transparent 0%, black 100%)",
          }}
        />
      </div>

      <LightRays />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <div className="max-w-xl">
          {/* Великий знак Fusion Lab (метал, F — craft-orange, L — tech-blue)
              над рядком адреси — той самий crop, що й у site-header.tsx,
              лише більший і без обмеження в 9×9: тут це не іконка поруч із
              написом, а самостійний знак секції. */}
          <img
            src="/fusion-lab-mark-hero.png"
            alt=""
            className="h-20 w-auto sm:h-28"
          />
          <p className="mt-4 text-sm font-medium tracking-wide text-[#e7b78f]">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-white sm:text-5xl">
            {t.rich("title", {
              br: () => <br />,
            })}
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#eadfd3] sm:text-lg">
            {t("body")}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/schedule" className="btn-accent">
              {t("ctaBook")}
            </Link>
            <a href="#categories" className="btn-ghost !bg-white/10 !text-white !border-white/25 hover:!bg-white/20">
              {t("ctaDirections")}
            </a>
            <Link href="/login" className="btn-ghost !bg-transparent !text-white !border-white/40 hover:!bg-white/10">
              {t("ctaSignIn")}
            </Link>
            {/* Nova's express wizard (Wisart Book Crealiry.md §3.4). A plain
                <a>, not next-intl's <Link>: /studio is a rewrite to another
                application, not a route of this one, so it must not be
                locale-prefixed — see next.config.ts and middleware's matcher.
                White fill rather than a fourth outline: it is the newest
                offer on this page and the only one that leaves for another
                product, so it should not read as one more secondary link. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                /studio is a rewrite to Nova, not a page here; see comment
                above for why <Link> is wrong for it. */}
            <a
              href="/studio/?create=book"
              className="btn-ghost !border-transparent !bg-white !text-[#2b1a10] hover:!bg-[#f4ece1]"
            >
              {t("ctaCreateBook")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
