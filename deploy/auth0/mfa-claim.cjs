// Second Post Login Action, after require-mfa. Never infer MFA from a role or a request parameter.
exports.onExecutePostLogin = async (event, api) => {
  if (
    !(event.secrets.SUITE_CLIENT_IDS || "")
      .split(",")
      .includes(event.client.client_id)
  )
    return;
  const verified =
    event.authentication?.methods?.some((m) => m.name === "mfa") === true;
  const claim = event.secrets.SUITE_MFA_CLAIM || "https://suite.example/mfa";
  api.accessToken.setCustomClaim(claim, verified);
  api.idToken.setCustomClaim(claim, verified);
};
