export const simulationError = (
  status: number,
  code: string,
  message: string,
) => Object.assign(Error(message), { status, code });
