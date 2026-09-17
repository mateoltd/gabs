import * as react from "react";
import * as jsx from "react/jsx-runtime";
import * as ui from "@suite/ui-web";
import { describeViewHost } from "@suite/module-sdk/host-ui";
export const viewHost = Object.freeze({
  react,
  jsx,
  ui,
  capabilities: describeViewHost({ react, jsx, ui }),
});
