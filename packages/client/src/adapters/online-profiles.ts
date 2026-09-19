import { openDB } from "idb";
import {
  OnlineProfileDirectory,
  type OnlineProfile,
} from "../identity/online-profiles";
const db = () =>
  openDB("suite-online-profiles-v1", 1, {
    upgrade(db) {
      db.createObjectStore("profiles");
    },
  });
const directory = new OnlineProfileDirectory({
  read: async () => (await db()).get("profiles", "directory"),
  write: async (value) => {
    await (await db()).put("profiles", value, "directory");
  },
  exclusive: async (run) =>
    await navigator.locks.request("suite-online-profiles", run),
});
export const listOnlineProfiles = () =>
  window.suiteDesktop ? window.suiteDesktop.onlineProfiles() : directory.list();
export const rememberOnlineProfile = (
  user: Pick<OnlineProfile, "id" | "name" | "email">,
  explicit: boolean,
  current: () => boolean,
) =>
  window.suiteDesktop
    ? window.suiteDesktop.rememberOnlineProfile(explicit)
    : directory.remember(user, explicit, current);
export const forgetOnlineProfile = (id: string) =>
  window.suiteDesktop
    ? window.suiteDesktop.forgetOnlineProfile(id)
    : directory.forget(id);
