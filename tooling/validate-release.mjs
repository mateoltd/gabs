for (const name of [
  "API_ORIGIN",
  "AUTH0_ISSUER",
  "AUTH0_AUDIENCE",
  "DESKTOP_UPDATE_URL",
]) {
  const value = process.env[name];
  if (!value || !value.startsWith("https://") || value.includes(".invalid"))
    throw Error(`A real HTTPS ${name} is required`);
}
if (!process.env.AUTH0_DESKTOP_CLIENT_ID)
  throw Error("A public Auth0 native client ID is required.");
