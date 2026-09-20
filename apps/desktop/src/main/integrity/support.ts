import type {
  MessageBoxOptions,
  MessageBoxReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from "electron";
import {
  inspectApplication,
  type ApplicationIntegrityOptions,
} from "./startup";
import { exportIntegrityReport, inspectIntegrity } from "./report";
import { repairIntegrity } from "./repair";

export const integrityCommands = [
  "inspect-integrity",
  "export-integrity",
  "repair-integrity",
] as const;
export type IntegrityCommand = (typeof integrityCommands)[number];

/** Startup-only support. No native database, profile activation or renderer is opened. */
export class IntegritySupport {
  constructor(
    private readonly options: () => ApplicationIntegrityOptions,
    private readonly clearSession: () => Promise<void>,
  ) {}
  private async report() {
    const options = this.options();
    return inspectIntegrity(options.profile, await inspectApplication(options));
  }
  async execute(command: IntegrityCommand, destination = "") {
    if (command === "inspect-integrity")
      return JSON.stringify(await this.report(), null, 2);
    if (command === "export-integrity") {
      await exportIntegrityReport(
        this.options().profile,
        destination,
        await this.report(),
      );
      return "Integrity report saved. It contains validated diagnostic metadata, not corrupt file contents or business data.";
    }
    const options = this.options();
    const result = await repairIntegrity({
      profile: options.profile,
      release: options.release,
      inspect: () => inspectApplication(options),
      clearSession: this.clearSession,
    });
    return result.changed
      ? `Integrity records repaired. Original evidence retained in ${result.retained}. Restart Common and sign in again. Saved work was preserved.`
      : "No unreadable integrity records require repair. Saved work was preserved.";
  }
  async showFailure(
    dialog: {
      showMessageBox(
        options: MessageBoxOptions,
      ): Promise<MessageBoxReturnValue>;
      showSaveDialog(
        options: SaveDialogOptions,
      ): Promise<SaveDialogReturnValue>;
    },
    reason: string,
  ) {
    const canRepair =
      reason === "audit-unavailable" || reason === "audit-repair-pending";
    let detail = canRepair
      ? "Integrity records need attention. You can export a diagnostic report or repair the records. Repair keeps the original evidence and saved work, clears the old sign-in session, and requires a verified installation. An interrupted repair can be resumed."
      : "Repair or reinstall Common from your organization's approved release, then restart. Keep the application data folder to preserve saved work. You can export a diagnostic report.";
    while (true) {
      const result = await dialog.showMessageBox({
        type: "error",
        message: "Common could not verify this installation.",
        detail,
        buttons: canRepair
          ? ["Quit", "Export report", "Repair records"]
          : ["Quit", "Export report"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 0) return;
      try {
        if (result.response === 1) {
          const saved = await dialog.showSaveDialog({
            title: "Export integrity report",
            defaultPath: "common-integrity-report.json",
            filters: [{ name: "JSON report", extensions: ["json"] }],
          });
          if (!saved.canceled && saved.filePath)
            detail = await this.execute("export-integrity", saved.filePath);
        } else if (result.response === 2 && canRepair) {
          const message = await this.execute("repair-integrity");
          await dialog.showMessageBox({
            type: "info",
            message,
            buttons: ["Quit"],
            noLink: true,
          });
          return;
        } else return;
      } catch {
        detail =
          "The support operation could not finish. For export, choose a new file outside application data. For repair, restore the approved installation and check profile access, then retry. Keep all original and pending recovery files; saved business data has not been removed.";
      }
    }
  }
}
