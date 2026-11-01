// A link to a path that webRoutes built (with its query, like `?hold=H1`). It stays a real anchor (new tab,
// copy link, middle click) and navigates inside the SPA on a plain click.

import { useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

export interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  readonly href: string;
  readonly children?: ReactNode;
}

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function AppLink({ href, onClick, children, ...rest }: AppLinkProps) {
  const router = useRouter();
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !plainClick(event) || rest.target === "_blank") return;
        event.preventDefault();
        router.history.push(href);
      }}
    >
      {children}
    </a>
  );
}
