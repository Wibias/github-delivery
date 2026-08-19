import { redeemAuthorityBeforeMutation } from "./authority-redemption.mjs";
import { isReadOnlyGitHubCommand } from "./github-retry.mjs";

function sameCommand(command, args, plannedCommand) {
  if (!Array.isArray(plannedCommand) || plannedCommand.length === 0) return false;
  if (command !== plannedCommand[0]) return false;
  const plannedArgs = plannedCommand.slice(1);
  return args.length === plannedArgs.length && args.every((value, index) => value === plannedArgs[index]);
}

function isPreWriteCoordinationMutation(command, args, plannedCommand) {
  if (sameCommand(command, args, plannedCommand)) return true;
  return command === "gh" && !isReadOnlyGitHubCommand(command, args);
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
  let redemptionAttempted = false;
  let writeAttempted = false;

  function redeem() {
    if (!redemptionAttempted) {
      redemptionAttempted = true;
      redemptionReceipt = redeemAuthorityBeforeMutation({
        authority,
        authorityGrant,
        redeemer,
      });
    }
    return redemptionReceipt ? structuredClone(redemptionReceipt) : null;
  }

  return {
    runner(command, args, options) {
      const isPlannedWrite = sameCommand(command, args, plannedCommand);
      if (isPreWriteCoordinationMutation(command, args, plannedCommand)) redeem();
      if (isPlannedWrite) writeAttempted = true;
      return runner(command, args, options);
    },
    redeem,
    redemption() {
      return redemptionReceipt ? structuredClone(redemptionReceipt) : null;
    },
    attempted() {
      return writeAttempted;
    },
  };
}
