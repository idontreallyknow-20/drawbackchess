"use client";

// The one button.
//
// Buttons carried their material in a global .btn-* class and their geometry in
// a Tailwind string copy-pasted at every call-site, which meant the shape of a
// button was a convention rather than a thing.
//
// Both halves now live here. The material is gone: a button is a flat box in
// one of three roles.
//
//   primary  solid accent fill, white label. One per view region.
//   default  raised surface with a hairline border. Everything else.
//   danger   the same shape carrying red. Resign, delete, leave, decline.
//
// The older tone names (leaf, cta, gold, glass, slab, ghost, quiet) are kept as
// aliases onto those three so no call-site had to be rewritten. They no longer
// select different materials, only the role they always meant.

import Link from "next/link";
import { forwardRef } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/** The three roles, plus the legacy names that map onto them. */
export type ButtonTone =
  | "primary"
  | "default"
  | "danger"
  /** @deprecated alias of "primary" */
  | "leaf"
  /** @deprecated alias of "primary" */
  | "cta"
  /** @deprecated alias of "primary" */
  | "gold"
  /** @deprecated alias of "default" */
  | "ghost"
  /** @deprecated alias of "default" */
  | "glass"
  /** @deprecated alias of "default" */
  | "slab"
  /** @deprecated alias of "default" */
  | "quiet";

export type ButtonSize = "xs" | "sm" | "md" | "lg";

const TONE: Record<ButtonTone, string> = {
  primary: "btn-leaf",
  leaf: "btn-leaf",
  cta: "btn-leaf",
  gold: "btn-leaf",
  default: "btn-ghost",
  ghost: "btn-ghost",
  glass: "btn-ghost",
  slab: "btn-ghost",
  quiet: "btn-ghost",
  danger: "btn-cursed",
};

// Touch first: every size clears a 44px tap target on a phone (the hit-area
// floor in docs/design-system.md §10) and only tightens once there is a
// pointer. `xs` is the exception and is for dense data rows only — it clears
// 36px, never 44, so it is not allowed to be the only way to do something.
//
// "Once there is a pointer" is `(pointer: fine)`, not `sm:`. It used to be
// `sm:`, which reads a WIDTH as a proxy for a mouse and so is wrong for every
// tablet: a 768x1024 iPad is a touch device on the far side of `sm`, and it
// was being handed 40px controls. Measured on that viewport, "Find a match"
// and "Play a bot" both rendered 40px tall against the 44px floor.
const SIZE: Record<ButtonSize, string> = {
  // Lichess's .button is padding .8em 1em at 14px, about 40px tall. That is
  // the floor for anything that is a real control; xs/sm are for dense data
  // rows only and still clear 36px.
  xs: "min-h-[36px] gap-1 px-2.5 py-1 text-[12px]",
  sm: "min-h-[36px] gap-1.5 px-3 py-1.5 text-[13px]",
  md: "min-h-[44px] gap-2 px-[1em] py-[0.8em] text-sm [@media(pointer:fine)]:min-h-[40px]",
  // `lg` is Lichess's lobby button: 52px tall, 16px label, a roomy gap so a
  // leading icon reads as part of the label rather than a decoration.
  lg: "min-h-[52px] gap-3 px-5 py-3 text-[16px]",
};

/** Square, so an icon-only control is a target rather than a sliver. */
const ICON_SIZE: Record<ButtonSize, string> = {
  xs: "min-h-[36px] min-w-[36px] p-1 text-[12px]",
  sm: "min-h-[36px] min-w-[36px] p-1.5 text-[13px]",
  md: "min-h-[44px] min-w-[44px] p-2 text-sm [@media(pointer:fine)]:min-h-[40px] [@media(pointer:fine)]:min-w-[40px]",
  lg: "min-h-[48px] min-w-[48px] p-2.5 text-base",
};

interface Shape {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Fill the container. */
  block?: boolean;
  /** No label — pass an aria-label. */
  iconOnly?: boolean;
  /** `.press` scale physics. Off by default (Lichess buttons brighten, they do
   *  not shrink); opt in for game controls that want the tactile beat. */
  press?: boolean;
  /** Label alignment. Lichess's lobby buttons lead with an icon and set the
   *  label flush left; "start" gives that. Centered otherwise. */
  align?: "center" | "start";
  className?: string;
}

function shapeClass({
  tone = "default",
  size = "md",
  block,
  iconOnly,
  press = false,
  align = "center",
  className,
}: Shape): string {
  return [
    "inline-flex items-center rounded-none font-display transition",
    align === "start" ? "justify-start text-left" : "justify-center",
    "disabled:cursor-not-allowed disabled:opacity-40",
    press ? "press" : "",
    TONE[tone],
    iconOnly ? ICON_SIZE[size] : SIZE[size],
    block ? "w-full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = Shape & {
  /** Shows the shared loader in place of any leading icon and blocks input.
   *  Does not change the label: a control that says "Publish" keeps saying it,
   *  so the button does not resize mid-action. */
  loading?: boolean;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

/** Forwards its ref, because real call-sites need the node: focusing the
 *  primary action when a dialog opens, measuring, scroll-into-view. A button
 *  primitive that swallowed refs would force those back onto a raw <button>
 *  and straight out of the theme contract. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone,
    size,
    block,
    iconOnly,
    press,
    align,
    className,
    loading,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default to "button": a bare <button> inside a <form> submits it, which
      // is almost never what a call-site converted from an onClick handler
      // wants. Pass type="submit" explicitly where it is.
      type="button"
      className={shapeClass({
        tone,
        size,
        block,
        iconOnly,
        press,
        align,
        className: [loading ? "btn-busy" : "", className ?? ""].filter(Boolean).join(" "),
      })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="rune-loader" aria-hidden />}
      {children}
    </button>
  );
});

export type LinkButtonProps = Shape & {
  href: string;
  children?: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">;

/** Navigation that is dressed as a control. Same material and geometry as
 *  Button, but it is a link: it routes, opens in a new tab on middle-click, and
 *  announces as a link. If the thing does not have a destination, it is a
 *  Button. */
export function LinkButton({
  href,
  tone,
  size,
  block,
  iconOnly,
  press,
  align,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={shapeClass({ tone, size, block, iconOnly, press, align, className }) + " no-underline"}
      {...rest}
    >
      {children}
    </Link>
  );
}
