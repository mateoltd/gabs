// Adapted from shadcn/ui base-nova Breadcrumb (MIT). See README.md.
import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ChevronDown } from "../icons";

export function Breadcrumb(props: React.ComponentProps<"nav">) {
  return <nav aria-label="Breadcrumb" data-slot="breadcrumb" {...props} />;
}

export function BreadcrumbList(props: React.ComponentProps<"ol">) {
  return <ol data-slot="breadcrumb-list" {...props} />;
}

export function BreadcrumbItem(props: React.ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" {...props} />;
}

export function BreadcrumbLink({
  render,
  ...props
}: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">({ className: "breadcrumb-link" }, props),
    render,
    state: { slot: "breadcrumb-link" },
  });
}

export function BreadcrumbPage(props: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      {...props}
    />
  );
}

export function BreadcrumbSeparator({
  children,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      {...props}
    >
      {children ?? <ChevronDown size={13} />}
    </li>
  );
}
