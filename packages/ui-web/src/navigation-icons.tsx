// Compact filled silhouettes are easier to distinguish in the navigation rail.
// Import individual Phosphor modules so development does not load the full catalog.
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { ShoppingBagOpenIcon } from "@phosphor-icons/react/dist/csr/ShoppingBagOpen";
import { PackageIcon } from "@phosphor-icons/react/dist/csr/Package";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";

import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { KanbanIcon } from "@phosphor-icons/react/dist/csr/Kanban";
import { TreeStructureIcon } from "@phosphor-icons/react/dist/csr/TreeStructure";

export const navigationIcons = {
  overview: SquaresFourIcon,
  orders: ShoppingBagOpenIcon,
  inventory: PackageIcon,
  modules: StackIcon,
  contacts: AddressBookIcon,
  projects: KanbanIcon,
  organization: TreeStructureIcon,
  people: UsersThreeIcon,
  audit: ShieldCheckIcon,
  settings: GearSixIcon,
};
