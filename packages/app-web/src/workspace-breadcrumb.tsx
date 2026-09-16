import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@suite/ui-web";
import { Link } from "react-router";
import { BrandIcon } from "./brand";

export function WorkspaceBreadcrumb({
  workspaceName,
  page,
}: {
  workspaceName: string;
  page: string;
}) {
  return (
    <Breadcrumb
      className="workspace-breadcrumb"
      aria-label="Workspace navigation"
    >
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            className="breadcrumb-workspace"
            render={<Link to="/overview" />}
          >
            {workspaceName}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{page}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function WorkspaceSwitcher({
  workspaces,
  workspaceId,
  onWorkspace,
  compact = false,
  logoDataUrl,
}: {
  workspaces: { id: string; name: string }[];
  workspaceId: string;
  onWorkspace: (id: string) => void;
  compact?: boolean;
  logoDataUrl?: string;
}) {
  const name =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    "Workspace";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rail-workspace-switch"
        aria-label="Switch workspace"
        title={`Switch workspace (${name})`}
      >
        {logoDataUrl ? (
          <img
            className="brand-icon"
            src={logoDataUrl}
            alt=""
            width={28}
            height={28}
          />
        ) : (
          <BrandIcon />
        )}
        <span>{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "bottom" : "right"}
        align="start"
        sideOffset={8}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={workspaceId}
            onValueChange={onWorkspace}
          >
            {workspaces.map((workspace) => (
              <DropdownMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                closeOnClick
                data-value={workspace.id}
              >
                {workspace.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
