import { redeemAuthorityBeforeMutation } from "./authority-redemption.mjs";

function sameCommand(command, args, plannedCommand) {
  if (!Array.isArray(plannedCommand) || plannedCommand.length === 0) return false;
  if (command !== plannedCommand[0]) return false;
  const plannedArgs = plannedCommand.slice(1);
  return args.length === plannedArgs.length && args.every((value, index) => value === plannedArgs[index]);
}

export function makeRedemptionRunner({
  plannedCommand,
  authority,
  authorityGrant,
  redeemer = null,
  runner,
} = {}) {
  if (!Array.isArray(plannedCommand) || plannedCommand.length === 0) {
    throw new Error("authority_execution_command_required");
  }
  if (typeof runner !== "function") throw new Error("authority_execution_runner_required");

  let redemptionReceipt = null;
  let attempted = false;

  return {
    runner(command, args, options) {
      if (sameCommand(command, args, plannedCommand) && !attempted) {
        attempted = true;
        redemptionReceipt = redeemAuthorityBeforeMutation({
          authority,
          authorityGrant,
          redeemer,
        });
      }
      return runner(command, args, options);
    },
    redemption() {
      return redemptionReceipt ? structuredClone(redemptionReceipt) : null;
    },
  };
}
