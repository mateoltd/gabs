// First Post Login Action. Scope these actions to the suite's two client IDs.
exports.onExecutePostLogin = async (event, api) => {
  const clients = (event.secrets.SUITE_CLIENT_IDS || "").split(",");
  if (!clients.includes(event.client.client_id)) return;
  if (event.authentication?.methods?.some((m) => m.name === "mfa")) return;
  if (event.user.enrolledFactors?.length)
    api.authentication.challengeWithAny(
      event.user.enrolledFactors.map((f) => ({ type: f.type })),
    );
  else api.authentication.enrollWith({ type: "otp" });
};
